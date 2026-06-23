import "dotenv/config";
import { crawlSite, scrapeUrl } from "./lib/firecrawl.js";
import { prisma } from "./lib/db.js";

interface CrawlCliOptions {
  seedUrl: string;
  limit?: number;
  includePaths?: string[];
  excludePaths?: string[];
  maxDiscoveryDepth?: number;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function resolveCrawlLimit(requested?: number): number | undefined {
  if (requested !== undefined) {
    return requested;
  }

  const envDefault = process.env.CRAWL_DEFAULT_LIMIT?.trim();
  if (!envDefault) {
    return undefined;
  }

  const parsed = Number.parseInt(envDefault, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid CRAWL_DEFAULT_LIMIT: ${envDefault}`);
  }

  return parsed;
}

function parseUrls(args: string[]): string[] {
  const urls: string[] = [];
  for (const arg of args) {
    try {
      urls.push(new URL(arg).href);
    } catch {
      throw new Error(`Invalid URL: ${arg}`);
    }
  }
  return urls;
}

function parseCrawlArgs(args: string[]): CrawlCliOptions {
  const crawlIndex = args.indexOf("--crawl");
  if (crawlIndex === -1 || crawlIndex === args.length - 1) {
    throw new Error("Missing seed URL after --crawl");
  }

  let seedUrl: string;
  try {
    seedUrl = new URL(args[crawlIndex + 1]).href;
  } catch {
    throw new Error(`Invalid crawl seed URL: ${args[crawlIndex + 1]}`);
  }

  let limit: number | undefined;
  let includePaths: string[] | undefined;
  let excludePaths: string[] | undefined;
  let maxDiscoveryDepth: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (i === crawlIndex || i === crawlIndex + 1) {
      continue;
    }

    const arg = args[i];
    if (arg === "--limit") {
      if (i + 1 >= args.length) {
        throw new Error("Missing value for --limit");
      }
      limit = parsePositiveInt(args[++i], "--limit");
      continue;
    }
    if (arg === "--include") {
      if (i + 1 >= args.length) {
        throw new Error("Missing value for --include");
      }
      includePaths = [...(includePaths ?? []), args[++i]];
      continue;
    }
    if (arg === "--exclude") {
      if (i + 1 >= args.length) {
        throw new Error("Missing value for --exclude");
      }
      excludePaths = [...(excludePaths ?? []), args[++i]];
      continue;
    }
    if (arg === "--depth") {
      if (i + 1 >= args.length) {
        throw new Error("Missing value for --depth");
      }
      maxDiscoveryDepth = parsePositiveInt(args[++i], "--depth");
      continue;
    }

    throw new Error(`Unknown crawl flag: ${arg}`);
  }

  return {
    seedUrl,
    limit: resolveCrawlLimit(limit),
    includePaths,
    excludePaths,
    maxDiscoveryDepth,
  };
}

async function isProcessedDocument(sourceUrl: string): Promise<boolean> {
  const existing = await prisma.document.findUnique({
    where: { sourceUrl },
    select: { status: true },
  });
  return existing?.status === "processed";
}

async function upsertDocument(
  page: {
    sourceUrl: string;
    title: string | null;
    markdown: string;
  },
  force: boolean,
): Promise<"saved" | "skipped"> {
  if (!force && (await isProcessedDocument(page.sourceUrl))) {
    return "skipped";
  }

  await prisma.document.upsert({
    where: { sourceUrl: page.sourceUrl },
    create: {
      sourceUrl: page.sourceUrl,
      title: page.title,
      markdown: page.markdown,
      status: "pending",
      scrapedAt: new Date(),
    },
    update: {
      title: page.title,
      markdown: page.markdown,
      status: "pending",
      scrapedAt: new Date(),
      processedAt: null,
    },
  });

  return "saved";
}

async function ingestScrapeUrls(
  urls: string[],
  force: boolean,
): Promise<{ saved: number; skipped: number; failed: number }> {
  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of urls) {
    if (!force && (await isProcessedDocument(url))) {
      console.error(`Skipped ${url}: already processed (use --force to re-scrape)`);
      skipped++;
      continue;
    }

    console.error(`Scraping ${url}...`);
    try {
      const page = await scrapeUrl(url);
      const result = await upsertDocument(page, force);
      if (result === "skipped") {
        console.error(`Skipped ${page.sourceUrl}: already processed (use --force to re-scrape)`);
        skipped++;
        continue;
      }
      console.error(`Saved ${page.sourceUrl}`);
      saved++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed ${url}: ${message}`);
      failed++;
    }
  }

  console.error(
    `Ingested ${saved}/${urls.length} URLs (skipped: ${skipped}, failures: ${failed})`,
  );
  return { saved, skipped, failed };
}

async function ingestCrawl(
  options: CrawlCliOptions,
  force: boolean,
): Promise<{ saved: number; skippedProcessed: number; saveFailed: number }> {
  const limitLabel =
    options.limit === undefined ? "no limit" : `limit ${options.limit}`;
  console.error(`Crawling ${options.seedUrl} (${limitLabel})...`);

  let crawlResult;
  try {
    crawlResult = await crawlSite(options.seedUrl, {
      limit: options.limit,
      includePaths: options.includePaths,
      excludePaths: options.excludePaths,
      maxDiscoveryDepth: options.maxDiscoveryDepth,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Crawl failed for ${options.seedUrl}: ${message}`);
    return { saved: 0, skippedProcessed: 0, saveFailed: 0 };
  }

  let saved = 0;
  let skippedProcessed = 0;
  let saveFailed = 0;
  for (const page of crawlResult.pages) {
    try {
      const result = await upsertDocument(page, force);
      if (result === "skipped") {
        skippedProcessed++;
        continue;
      }
      saved++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to save ${page.sourceUrl}: ${message}`);
      saveFailed++;
    }
  }

  console.error(
    `Crawling ${options.seedUrl}... discovered ${crawlResult.discovered} pages, saved ${saved} documents (skipped ${crawlResult.skippedEmpty} empty, skipped ${skippedProcessed} processed, save failures: ${saveFailed}).`,
  );

  return { saved, skippedProcessed, saveFailed };
}

function isScrapeIngestSuccessful(result: {
  saved: number;
  skipped: number;
  failed: number;
}): boolean {
  return result.failed === 0 && (result.saved > 0 || result.skipped > 0);
}

function isCrawlIngestSuccessful(result: {
  saved: number;
  skippedProcessed: number;
  saveFailed: number;
}): boolean {
  return result.saveFailed === 0 && (result.saved > 0 || result.skippedProcessed > 0);
}

function stripForceFlag(args: string[]): { args: string[]; force: boolean } {
  const force = args.includes("--force");
  return {
    args: args.filter((arg) => arg !== "--force"),
    force,
  };
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  npm run ingest -- <url> [url2 ...] [--force]");
  console.error(
    "  npm run ingest -- --crawl <seed-url> [--limit N] [--include pattern] [--exclude pattern] [--depth N] [--force]",
  );
}

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  printUsage();
  process.exit(1);
}

const { args: cliArgs, force } = stripForceFlag(rawArgs);
if (cliArgs.length === 0) {
  printUsage();
  process.exit(1);
}

const isCrawlMode = cliArgs.includes("--crawl");
let exitCode = 1;

try {
  if (isCrawlMode) {
    const crawlOptions = parseCrawlArgs(cliArgs);
    const crawlResult = await ingestCrawl(crawlOptions, force);
    exitCode = isCrawlIngestSuccessful(crawlResult) ? 0 : 1;
  } else {
    const urls = parseUrls(cliArgs);
    const scrapeResult = await ingestScrapeUrls(urls, force);
    exitCode = isScrapeIngestSuccessful(scrapeResult) ? 0 : 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  printUsage();
  exitCode = 1;
}

await prisma.$disconnect();
process.exit(exitCode);
