import OpenAI from "openai";
import { VECTOR_DIM } from "./lancedb.js";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_BATCH_SIZE = 100;

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function isRateLimitError(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIError &&
    (err.status === 429 || err.code === "rate_limit_exceeded")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const openai = getOpenAIClient();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });

      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      const embeddings = sorted.map((item) => item.embedding);

      for (const vector of embeddings) {
        if (vector.length !== VECTOR_DIM) {
          throw new Error(
            `Expected embedding dimension ${VECTOR_DIM}, got ${vector.length}`,
          );
        }
      }

      return embeddings;
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 4000);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function embedTextsInBatches(
  texts: string[],
  batchSize = EMBEDDING_BATCH_SIZE,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const totalBatches = Math.ceil(texts.length / batchSize);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    console.error(
      `Embedding batch ${batchNumber}/${totalBatches} (${batch.length} texts)...`,
    );
    const embeddings = await embedTexts(batch);
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}
