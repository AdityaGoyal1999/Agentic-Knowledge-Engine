-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT,
    "markdown" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenEstimate" INTEGER,
    "embeddedAt" DATETIME,
    CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourceUrl_key" ON "Document"("sourceUrl");

-- CreateIndex
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");
