import "dotenv/config";
import { crawlSite, CRAWL_DEV_MAX_LIMIT, scrapeUrl } from "./lib/firecrawl.js";
import { prisma } from "./lib/db.js";

interface CrawlCliOptions {
  seedUrl: string;
  limit: number;
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

function resolveCrawlLimit(requested?: number): number {
  const envDefault = Number.parseInt(process.env.CRAWL_DEFAULT_LIMIT ?? "50", 10);
  const defaultLimit = Number.isFinite(envDefault) && envDefault > 0 ? envDefault : 50;
  const limit = requested ?? defaultLimit;

  if (limit > CRAWL_DEV_MAX_LIMIT) {
    console.error(
      `Crawl limit capped at ${CRAWL_DEV_MAX_LIMIT} during development (requested ${limit}).`,
    );
    return CRAWL_DEV_MAX_LIMIT;
  }

  return limit;
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

async function upsertDocument(page: {
  sourceUrl: string;
  title: string | null;
  markdown: string;
}): Promise<void> {
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
}

async function ingestScrapeUrls(urls: string[]): Promise<number> {
  let successCount = 0;

  for (const url of urls) {
    console.error(`Scraping ${url}...`);
    try {
      const page = await scrapeUrl(url);
      await upsertDocument(page);
      console.error(`Saved ${url}`);
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed ${url}: ${message}`);
    }
  }

  console.error(`Ingested ${successCount}/${urls.length} URLs (failures: ${urls.length - successCount})`);
  return successCount;
}

async function ingestCrawl(options: CrawlCliOptions): Promise<number> {
  console.error(`Crawling ${options.seedUrl} (limit ${options.limit})...`);

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
    return 0;
  }

  let savedCount = 0;
  for (const page of crawlResult.pages) {
    try {
      await upsertDocument(page);
      savedCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to save ${page.sourceUrl}: ${message}`);
    }
  }

  console.error(
    `Crawling ${options.seedUrl}... discovered ${crawlResult.discovered} pages, saved ${savedCount} documents (skipped ${crawlResult.skippedEmpty} empty).`,
  );

  return savedCount;
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  npm run ingest -- <url> [url2 ...]");
  console.error(
    "  npm run ingest -- --crawl <seed-url> [--limit N] [--include pattern] [--exclude pattern] [--depth N]",
  );
}

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  printUsage();
  process.exit(1);
}

const isCrawlMode = rawArgs.includes("--crawl");
let exitCode = 1;

try {
  if (isCrawlMode) {
    const crawlOptions = parseCrawlArgs(rawArgs);
    const savedCount = await ingestCrawl(crawlOptions);
    exitCode = savedCount > 0 ? 0 : 1;
  } else {
    const urls = parseUrls(rawArgs);
    const successCount = await ingestScrapeUrls(urls);
    exitCode = successCount > 0 ? 0 : 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  printUsage();
  exitCode = 1;
}

await prisma.$disconnect();
process.exit(exitCode);
