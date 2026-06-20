import { prisma } from "./db.js";
import { embedTexts } from "./embeddings.js";
import { searchVectors } from "./lancedb.js";

export interface SearchResult {
  chunkId: string;
  sourceUrl: string;
  title: string | null;
  content: string;
  chunkIndex: number;
  distance: number;
  similarity: number;
}

export async function searchScrapedData(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const [queryVector] = await embedTexts([query]);
  const hits = await searchVectors(queryVector, limit);

  if (hits.length === 0) {
    return [];
  }

  const chunks = await prisma.chunk.findMany({
    where: { id: { in: hits.map((hit) => hit.chunkId) } },
    include: { document: { select: { sourceUrl: true, title: true } } },
  });

  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return hits.flatMap((hit) => {
    const chunk = byId.get(hit.chunkId);
    if (!chunk) {
      return [];
    }

    return [
      {
        chunkId: hit.chunkId,
        sourceUrl: chunk.document.sourceUrl,
        title: chunk.document.title,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        distance: hit.distance,
        similarity: 1 - hit.distance,
      },
    ];
  });
}
