# Agentic Knowledge Engine

Local-first RAG pipeline for indie hacker research: scrape web content, chunk and embed it, then query it from Cursor or Claude via MCP.

## Prerequisites

- Node.js 22+ (required by `@mendable/firecrawl-js`)
- [Firecrawl](https://firecrawl.dev) API key (free tier is sufficient for development)
- [OpenAI](https://platform.openai.com) API key (for `text-embedding-3-small`)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and add your API keys
npx prisma migrate dev
npm run init
```

## Verify

1. **Prisma Studio** — open the database and confirm empty tables:

   ```bash
   npm run studio
   ```

   You should see `Document` and `Chunk` tables with 0 records.

2. **LanceDB** — after `npm run init`, confirm the vector store directory exists:

   ```bash
   ls data/lancedb
   ```

## Ingestion

Scrape one or more URLs into the `Document` table. Requires `FIRECRAWL_API_KEY` in `.env`.

```bash
npm run ingest -- https://www.indiehackers.com/post/example https://www.starterstory.com/stories/example
```

Re-scraping the same URL updates the markdown and resets `status` to `pending` (clears `processedAt`).

## Environment variables

| Variable | Description |
|----------|-------------|
| `FIRECRAWL_API_KEY` | Firecrawl API key for web scraping |
| `OPENAI_API_KEY` | OpenAI API key for embeddings |
| `DATABASE_URL` | SQLite path (default: `file:../data/ake.db`, relative to `prisma/schema.prisma`) |
| `LANCEDB_PATH` | LanceDB storage path (default: `./data/lancedb`) |
