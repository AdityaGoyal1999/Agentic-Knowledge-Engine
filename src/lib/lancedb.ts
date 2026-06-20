import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";

export const VECTOR_DIM = 1536;
export const VECTOR_TABLE = "chunk_vectors";

function getLanceDbPath(): string {
  return process.env.LANCEDB_PATH ?? "./data/lancedb";
}

function zeroVector(): number[] {
  return Array.from({ length: VECTOR_DIM }, () => 0);
}

let connection: Connection | null = null;

async function getConnection(): Promise<Connection> {
  if (!connection) {
    connection = await lancedb.connect(getLanceDbPath());
  }
  return connection;
}

export async function initLanceDB(): Promise<Table> {
  const db = await getConnection();
  const tables = await db.tableNames();

  if (tables.includes(VECTOR_TABLE)) {
    return db.openTable(VECTOR_TABLE);
  }

  return db.createTable(VECTOR_TABLE, [
    {
      chunkId: "__init__",
      documentId: "__init__",
      sourceUrl: "__init__",
      vector: zeroVector(),
    },
  ]);
}

export async function getVectorTable(): Promise<Table> {
  const db = await getConnection();
  return db.openTable(VECTOR_TABLE);
}

export interface ChunkVectorRow {
  chunkId: string;
  documentId: string;
  sourceUrl: string;
  vector: number[];
}

export async function insertVectors(rows: ChunkVectorRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    if (row.vector.length !== VECTOR_DIM) {
      throw new Error(
        `Vector for chunk ${row.chunkId} has dimension ${row.vector.length}, expected ${VECTOR_DIM}`,
      );
    }
  }

  const table = await getVectorTable();
  await table.add(rows as unknown as Record<string, unknown>[]);
}

export async function deleteVectorsByDocumentId(
  documentId: string,
): Promise<void> {
  const table = await getVectorTable();
  await table.delete(`documentId = '${documentId}'`);
}

export async function countVectorRows(): Promise<number> {
  const table = await getVectorTable();
  return table.countRows("chunkId != '__init__'");
}

export interface VectorSearchHit {
  chunkId: string;
  documentId: string;
  sourceUrl: string;
  distance: number;
}

export async function searchVectors(
  queryVector: number[],
  limit: number,
): Promise<VectorSearchHit[]> {
  if (queryVector.length !== VECTOR_DIM) {
    throw new Error(
      `Query vector has dimension ${queryVector.length}, expected ${VECTOR_DIM}`,
    );
  }

  const table = await getVectorTable();
  const rows = await table
    .query()
    .nearestTo(queryVector)
    .distanceType("cosine")
    .where("chunkId != '__init__'")
    .limit(limit)
    .select(["chunkId", "documentId", "sourceUrl", "_distance"])
    .toArray();

  return rows.map((row) => ({
    chunkId: row.chunkId as string,
    documentId: row.documentId as string,
    sourceUrl: row.sourceUrl as string,
    distance: row._distance as number,
  }));
}
