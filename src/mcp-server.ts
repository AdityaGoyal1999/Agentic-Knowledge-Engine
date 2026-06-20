import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { initLanceDB } from "./lib/lancedb.js";
import { searchScrapedData } from "./lib/search.js";

const MAX_CONTENT_WORDS = 500;

const inputSchema = z.object({
  query: z.string().min(1).describe("Natural-language search query"),
  limit: z.number().int().min(1).max(10).default(5),
});

function truncateContent(content: string, maxWords = MAX_CONTENT_WORDS): string {
  const words = content.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return content;
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function formatResults(
  results: Awaited<ReturnType<typeof searchScrapedData>>,
): string {
  if (results.length === 0) {
    return "No matching chunks found. Run ingest + process first to populate the knowledge base.";
  }

  return results
    .map((result, index) => {
      const titleLine = result.title ? `Title: ${result.title}\n` : "";
      return [
        `--- Result ${index + 1} (similarity: ${result.similarity.toFixed(4)}, distance: ${result.distance.toFixed(4)}) ---`,
        `Source: ${result.sourceUrl}`,
        titleLine + `Chunk: ${result.chunkId}`,
        truncateContent(result.content),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

const server = new McpServer(
  { name: "ake", version: "1.0.0" },
  {
    instructions:
      "Search the local startup case-study knowledge base scraped by AKE. " +
      "Always call search_scraped_data before answering questions about scraped startups, indie hackers, or ingested web content.",
  },
);

server.registerTool(
  "search_scraped_data",
  {
    description:
      "Semantic search over locally scraped startup case studies. Returns ranked text chunks with source URLs and similarity scores. Alias: query_knowledge_base.",
    inputSchema,
  },
  async ({ query, limit }) => {
    try {
      const clampedLimit = Math.min(Math.max(limit ?? 5, 1), 10);
      const results = await searchScrapedData(query, clampedLimit);
      return {
        content: [{ type: "text", text: formatResults(results) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`search_scraped_data failed: ${message}`);
      return {
        content: [{ type: "text", text: `Search failed: ${message}` }],
        isError: true,
      };
    }
  },
);

async function main(): Promise<void> {
  await initLanceDB();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AKE MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
