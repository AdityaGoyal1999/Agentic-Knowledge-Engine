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
