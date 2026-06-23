import Firecrawl from "@mendable/firecrawl-js";

export interface ScrapeResult {
  markdown: string;
  title: string | null;
  sourceUrl: string;
}

export interface CrawlSiteOptions {
  limit?: number;
  includePaths?: string[];
  excludePaths?: string[];
  maxDiscoveryDepth?: number;
}

export interface CrawlSiteResult {
  pages: ScrapeResult[];
  discovered: number;
  skippedEmpty: number;
}

function getClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set in environment");
  }
  return new Firecrawl({ apiKey });
}

function documentToScrapeResult(
  doc: { markdown?: string; metadata?: { title?: string; url?: string } },
  fallbackUrl?: string,
): ScrapeResult | null {
  const markdown = doc.markdown?.trim();
  if (!markdown) {
    return null;
  }

  const sourceUrl = doc.metadata?.url ?? fallbackUrl;
  if (!sourceUrl) {
    return null;
  }

  const title = doc.metadata?.title ?? null;
  return { markdown, title, sourceUrl };
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const client = getClient();
  const result = await client.scrape(url, {
    formats: ["markdown"],
    onlyMainContent: true,
  });

  const page = documentToScrapeResult(result, url);
  if (!page) {
    throw new Error("Firecrawl returned empty markdown");
  }

  return page;
}

export async function crawlSite(
  seedUrl: string,
  options: CrawlSiteOptions = {},
): Promise<CrawlSiteResult> {
  const client = getClient();

  const job = await client.crawl(seedUrl, {
    limit: options.limit,
    includePaths: options.includePaths,
    excludePaths: options.excludePaths,
    maxDiscoveryDepth: options.maxDiscoveryDepth,
    allowExternalLinks: false,
    scrapeOptions: {
      formats: ["markdown"],
      onlyMainContent: true,
    },
  });

  if (job.status === "failed") {
    throw new Error(`Crawl job failed for ${seedUrl}`);
  }

  const discovered = job.data.length;
  const pages: ScrapeResult[] = [];

  for (const doc of job.data) {
    const page = documentToScrapeResult(doc);
    if (page) {
      pages.push(page);
    }
  }

  return {
    pages,
    discovered,
    skippedEmpty: discovered - pages.length,
  };
}
