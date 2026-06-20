import "dotenv/config";
import { countVectorRows, getVectorTable } from "./lib/lancedb.js";

const table = await getVectorTable();
const total = await countVectorRows();

console.error(`\nLanceDB chunk_vectors table`);
console.error(`Total vectors (excluding __init__): ${total}\n`);

const sample = await table.query().select(["chunkId", "documentId", "sourceUrl"]).limit(10).toArray();

console.error("Sample rows:");
for (const row of sample) {
  if (row.chunkId === "__init__") continue;
  console.error(`  chunkId: ${row.chunkId}`);
  console.error(`  documentId: ${row.documentId}`);
  console.error(`  sourceUrl: ${row.sourceUrl}`);
  console.error("");
}

const vectorSample = await table.query().select(["chunkId", "vector"]).limit(1).toArray();
for (const row of vectorSample) {
  if (row.chunkId === "__init__") continue;
  const vec = row.vector as number[];
  console.error(`Vector sample for ${row.chunkId}:`);
  console.error(`  dimensions: ${vec.length}`);
  console.error(`  first 5 values: [${vec.slice(0, 5).map((v) => v.toFixed(6)).join(", ")}...]`);
}
