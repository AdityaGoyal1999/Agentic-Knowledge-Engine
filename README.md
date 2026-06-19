# Agentic Knowledge Engine (AKE)

A local-first RAG pipeline for indie hacker research. Scrape startup case studies from the web, chunk and embed them, then query that knowledge from Cursor or Claude via MCP.

## What the project is

AKE is a personal knowledge engine built for founders and researchers who want AI assistants grounded in real startup stories — not generic training data.

The pipeline works in three stages:

1. **Ingest** — Firecrawl scrapes web pages (single URLs or full site crawls) and stores clean markdown in a local SQLite database.
2. **Process** — Documents are chunked, embedded with OpenAI, and indexed in LanceDB for semantic search. *(planned)*
3. **Query** — An MCP server exposes a search tool so Cursor or Claude can retrieve relevant case-study chunks when you ask questions. *(planned)*

Everything runs locally. Your scraped content, embeddings, and vectors stay on your machine under `data/`.

## Features

### Implemented

- **Single-URL scraping** — Ingest one or more case-study URLs into the `Document` table.
- **Site crawling** — Pass a listing-page seed URL and automatically discover and scrape linked pages (`--crawl` mode).
- **Main-content extraction** — Firecrawl requests markdown with `onlyMainContent: true` to strip nav, footers, and sidebars.
- **Document upsert** — Re-scraping the same URL updates markdown and resets status to `pending` for re-processing.
- **Hybrid storage** — Prisma/SQLite for document and chunk metadata; LanceDB for 1536-dim embedding vectors.
- **Prisma Studio** — Inspect documents and chunks via `npm run studio`.

### Planned

- Markdown-aware chunking (`process` CLI)
- OpenAI embedding pipeline (`text-embedding-3-small`)
- MCP stdio server with `search_scraped_data` tool
- Cursor MCP integration for end-to-end querying

## Project structure

```
GeneralizedKnowledgeEngine/
├── prisma/
│   ├── schema.prisma          # Document + Chunk models (SQLite)
│   └── migrations/            # Database migrations
├── src/
│   ├── lib/
│   │   ├── db.ts              # Prisma client singleton
│   │   ├── firecrawl.ts       # Scrape + crawl wrappers
│   │   └── lancedb.ts         # LanceDB table init + vector helpers
│   ├── ingest.ts              # CLI: scrape URLs or crawl a site
│   └── init.ts                # Bootstrap DB + vector store
├── data/                      # gitignored — local SQLite + LanceDB files
│   ├── ake.db
│   └── lancedb/
├── .env.example               # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

Planned additions:

```
src/
├── lib/
│   ├── chunker.ts             # Markdown-aware text splitting
│   └── embeddings.ts          # OpenAI embed + batch helper
├── process.ts                 # CLI: chunk + embed pending docs
└── mcp-server.ts              # MCP tool: search_scraped_data
```

## Architecture

```mermaid
flowchart LR
  subgraph ingest [Ingestion]
    CLI[ingest CLI]
    FC[Firecrawl API]
    CLI -->|"scrape: explicit URLs"| FC
    CLI -->|"crawl: listing page seed"| FC
    FC --> DocTable[(Prisma SQLite Documents)]
  end

  subgraph process [Processing — planned]
    ProcCLI[process CLI]
    Chunker[Markdown chunker]
    Embed[OpenAI embeddings]
    ChunkTable[(Prisma Chunks)]
    Vectors[(LanceDB vectors)]
    DocTable --> ProcCLI
    ProcCLI --> Chunker --> ChunkTable
    Chunker --> Embed --> Vectors
  end

  subgraph query [MCP Query — planned]
    MCP[MCP stdio server]
    QueryEmbed[Query embedding]
    MCP --> QueryEmbed --> Vectors
    Vectors --> ChunkTable
    ChunkTable --> MCP
  end
```



**Design choice:** Prisma/SQLite owns document and chunk text/metadata. LanceDB owns vectors keyed by `chunkId`. The two stores are linked by chunk ID — Prisma handles relational tracking; LanceDB handles fast similarity search.

## Data model


| Model                     | Key fields                                          | Purpose                        |
| ------------------------- | --------------------------------------------------- | ------------------------------ |
| `Document`                | `sourceUrl`, `title`, `markdown`, `status`          | Scraped page content           |
| `Chunk`                   | `documentId`, `content`, `chunkIndex`, `embeddedAt` | Text segments for embedding    |
| `chunk_vectors` (LanceDB) | `chunkId`, `documentId`, `sourceUrl`, `vector`      | 1536-dim embeddings for search |


Document status flow: `pending` → `processed` (or `failed`).

## Prerequisites

- **Node.js 22+** (required by `@mendable/firecrawl-js`)
- **[Firecrawl](https://firecrawl.dev) API key** — free tier is sufficient for development (~1 credit per page)
- **[OpenAI](https://platform.openai.com) API key** — for `text-embedding-3-small` (needed once processing is implemented)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and add your API keys
npx prisma migrate dev
npm run init
```

## Usage

### Scrape individual URLs

```bash
npm run ingest -- https://www.indiehackers.com/post/example https://www.starterstory.com/stories/example
```

### Crawl a listing page

Discover and scrape linked case-study pages from a seed URL:

```bash
npm run ingest -- --crawl https://www.indiehackers.com/group/tech --limit 20
```

Crawl options:


| Flag                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `--limit N`         | Max pages to scrape (default: 50, hard-capped during development) |
| `--include pattern` | Only follow URLs matching this path pattern (repeatable)          |
| `--exclude pattern` | Skip URLs matching this path pattern (repeatable)                 |
| `--depth N`         | Max link-discovery depth from the seed URL                        |


Re-scraping the same URL updates the markdown and resets `status` to `pending`.

### Inspect the database

```bash
npm run studio
```

Opens Prisma Studio in the browser. For long markdown fields, export via SQLite CLI:

```bash
sqlite3 data/ake.db "SELECT markdown FROM Document LIMIT 1;" > preview.md
```

### Initialize storage

```bash
npm run init
```

Connects to SQLite and creates the LanceDB vector table if it does not exist.

## Environment variables


| Variable              | Description                                      | Default               |
| --------------------- | ------------------------------------------------ | --------------------- |
| `FIRECRAWL_API_KEY`   | Firecrawl API key for web scraping               | —                     |
| `OPENAI_API_KEY`      | OpenAI API key for embeddings                    | —                     |
| `DATABASE_URL`        | SQLite path (relative to `prisma/schema.prisma`) | `file:../data/ake.db` |
| `LANCEDB_PATH`        | LanceDB storage directory                        | `./data/lancedb`      |
| `CRAWL_DEFAULT_LIMIT` | Default page limit when `--limit` is omitted     | `50`                  |


## Tech stack


| Layer      | Package                                        |
| ---------- | ---------------------------------------------- |
| Runtime    | Node.js, TypeScript, `tsx`                     |
| ORM        | Prisma + SQLite                                |
| Vectors    | `@lancedb/lancedb`                             |
| Scraping   | `@mendable/firecrawl-js`                       |
| Embeddings | `openai` (`text-embedding-3-small`, 1536 dims) |
| MCP        | `@modelcontextprotocol/server` + `zod`         |
| Config     | `dotenv`                                       |


## Roadmap

- [x] Phase 1 — Project scaffold, Prisma schema, LanceDB init, env template
- [x] Phase 2 — Firecrawl ingestion CLI (scrape + crawl)
- [ ] Phase 3 — Markdown-aware chunker and `process` CLI
- [ ] Phase 4 — OpenAI embedding pipeline and LanceDB vector writes
- [ ] Phase 5 — MCP stdio server with semantic search tool
- [ ] Phase 6 — Cursor MCP config and end-to-end testing