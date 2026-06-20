import "dotenv/config";
import { chunkMarkdown } from "./lib/chunker.js";
import { prisma } from "./lib/db.js";
import { EMBEDDING_BATCH_SIZE, embedTexts } from "./lib/embeddings.js";
import {
  countVectorRows,
  deleteVectorsByDocumentId,
  initLanceDB,
  insertVectors,
} from "./lib/lancedb.js";

interface SavedChunk {
  id: string;
  content: string;
  embeddedAt: Date | null;
}

async function embedDocumentChunks(
  document: {
    id: string;
    title: string | null;
    sourceUrl: string;
  },
  savedChunks: SavedChunk[],
): Promise<number> {
  const chunksToEmbed = savedChunks.filter((chunk) => chunk.embeddedAt === null);
  if (chunksToEmbed.length === 0) {
    return 0;
  }

  const label = document.title ?? document.sourceUrl;
  const totalBatches = Math.ceil(chunksToEmbed.length / EMBEDDING_BATCH_SIZE);
  let embeddedCount = 0;

  for (let i = 0; i < chunksToEmbed.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunksToEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchNumber = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
    const texts = batch.map((chunk) => chunk.content);
    const embeddings = await embedTexts(texts);

    const rows = batch.map((chunk, index) => ({
      chunkId: chunk.id,
      documentId: document.id,
      sourceUrl: document.sourceUrl,
      vector: embeddings[index],
    }));

    await insertVectors(rows);

    const batchIds = batch.map((chunk) => chunk.id);
    await prisma.chunk.updateMany({
      where: { id: { in: batchIds } },
      data: { embeddedAt: new Date() },
    });

    embeddedCount += batch.length;
    console.error(
      `Embedded batch ${batchNumber}/${totalBatches} for "${label}" (${batch.length} chunks)`,
    );
  }

  await prisma.document.update({
    where: { id: document.id },
    data: { status: "processed", processedAt: new Date() },
  });

  return embeddedCount;
}

async function processDocument(document: {
  id: string;
  title: string | null;
  sourceUrl: string;
  markdown: string;
}): Promise<number> {
  const chunks = chunkMarkdown(document.markdown);

  await deleteVectorsByDocumentId(document.id);

  await prisma.chunk.deleteMany({
    where: { documentId: document.id },
  });

  if (chunks.length === 0) {
    console.error(`Skipped ${document.sourceUrl}: no chunks produced`);
    return 0;
  }

  const savedChunks = await prisma.chunk.createManyAndReturn({
    data: chunks.map((chunk) => ({
      documentId: document.id,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenEstimate: chunk.tokenEstimate,
    })),
  });

  const label = document.title ?? document.sourceUrl;
  console.error(`Chunked "${label}": ${savedChunks.length} chunks`);

  const embeddedCount = await embedDocumentChunks(document, savedChunks);
  console.error(`Embedded "${label}": ${embeddedCount} chunks`);
  return embeddedCount;
}

async function main(): Promise<number> {
  await initLanceDB();

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
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "failed" },
      });
      failureCount++;
    }
  }

  const vectorCount = await countVectorRows();
  console.error(
    `Processed ${processedDocuments}/${pendingDocuments.length} documents (${totalChunks} chunks embedded, ${failureCount} failures). LanceDB vectors: ${vectorCount}`,
  );

  return processedDocuments;
}

const processedCount = await main();
await prisma.$disconnect();
process.exit(processedCount > 0 ? 0 : 1);
