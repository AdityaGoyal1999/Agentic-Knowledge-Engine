import Firecrawl from "@mendable/firecrawl-js";

export interface ScrapeResult {
  markdown: string;
  title: string | null;
  sourceUrl: string;
}

function getClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set in environment");
  }
  return new Firecrawl({ apiKey });
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const client = getClient();
  const result = await client.scrape(url, {
    formats: ["markdown"],
    onlyMainContent: true,
  });

  const markdown = result.markdown?.trim();
  if (!markdown) {
    throw new Error("Firecrawl returned empty markdown");
  }

  const title = result.metadata?.title ?? result.title ?? null;

  return { markdown, title, sourceUrl: url };
}
