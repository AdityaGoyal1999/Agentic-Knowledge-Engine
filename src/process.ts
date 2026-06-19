import "dotenv/config";
import { chunkMarkdown } from "./lib/chunker.js";
import { prisma } from "./lib/db.js";

async function processDocument(document: {
  id: string;
  title: string | null;
  sourceUrl: string;
  markdown: string;
}): Promise<number> {
  const chunks = chunkMarkdown(document.markdown);

  await prisma.chunk.deleteMany({
    where: { documentId: document.id },
  });

  if (chunks.length === 0) {
    console.error(`Skipped ${document.sourceUrl}: no chunks produced`);
    return 0;
  }

  await prisma.chunk.createMany({
    data: chunks.map((chunk) => ({
      documentId: document.id,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenEstimate: chunk.tokenEstimate,
    })),
  });

  const label = document.title ?? document.sourceUrl;
  console.error(`Chunked "${label}": ${chunks.length} chunks`);
  return chunks.length;
}

async function main(): Promise<number> {
  const pendingDocuments = await prisma.document.findMany({
    where: { status: "pending" },
    orderBy: { scrapedAt: "asc" },
  });

  if (pendingDocuments.length === 0) {
    console.error("No pending documents to process.");
    return 0;
  }

  let processedDocuments = 0;
  let totalChunks = 0;
  let failureCount = 0;

  for (const document of pendingDocuments) {
    try {
      const chunkCount = await processDocument(document);
      if (chunkCount > 0) {
        processedDocuments++;
        totalChunks += chunkCount;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed ${document.sourceUrl}: ${message}`);
      failureCount++;
    }
  }

  console.error(
    `Processed ${processedDocuments}/${pendingDocuments.length} documents (${totalChunks} chunks, ${failureCount} failures).`,
  );

  return processedDocuments;
}

const processedCount = await main();
await prisma.$disconnect();
process.exit(processedCount > 0 ? 0 : 1);
