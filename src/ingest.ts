import "dotenv/config";
import { scrapeUrl } from "./lib/firecrawl.js";
import { prisma } from "./lib/db.js";

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

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  console.error("Usage: npm run ingest -- <url> [url2 ...]");
  process.exit(1);
}

let urls: string[];
try {
  urls = parseUrls(rawArgs);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let successCount = 0;
let failureCount = 0;

for (const url of urls) {
  console.error(`Scraping ${url}...`);
  try {
    const { markdown, title } = await scrapeUrl(url);
    await prisma.document.upsert({
      where: { sourceUrl: url },
      create: {
        sourceUrl: url,
        title,
        markdown,
        status: "pending",
        scrapedAt: new Date(),
      },
      update: {
        title,
        markdown,
        status: "pending",
        scrapedAt: new Date(),
        processedAt: null,
      },
    });
    console.error(`Saved ${url}`);
    successCount++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed ${url}: ${message}`);
    failureCount++;
  }
}

console.error(`Ingested ${successCount}/${urls.length} URLs (failures: ${failureCount})`);
await prisma.$disconnect();
process.exit(successCount === 0 ? 1 : 0);
