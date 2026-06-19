export interface ChunkResult {
  content: string;
  chunkIndex: number;
  tokenEstimate?: number;
}

export interface ChunkMarkdownOptions {
  targetWords?: number;
  maxWords?: number;
}

type BlockType = "heading" | "paragraph" | "code";

interface MarkdownBlock {
  type: BlockType;
  content: string;
}

const DEFAULT_TARGET_WORDS = 450;
const DEFAULT_MAX_WORDS = 550;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function estimateTokens(wordCount: number): number {
  return Math.ceil(wordCount * 1.3);
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().startsWith("```")) {
      const codeLines = [line];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) {
        codeLines.push(lines[index]);
        index++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    if (/^#{2,3}\s/.test(line)) {
      blocks.push({ type: "heading", content: line });
      index++;
      continue;
    }

    if (line.trim() === "") {
      index++;
      continue;
    }

    const paragraphLines = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].trim().startsWith("```") &&
      !/^#{2,3}\s/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index++;
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join("\n") });
  }

  return blocks;
}

function splitLongParagraph(text: string, maxWords: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return [text.trim()];
  }

  const parts: string[] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    currentWords.push(word);
    if (currentWords.length >= maxWords) {
      parts.push(currentWords.join(" "));
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    parts.push(currentWords.join(" "));
  }

  return parts;
}

function expandBlocks(blocks: MarkdownBlock[], maxWords: number): MarkdownBlock[] {
  const expanded: MarkdownBlock[] = [];

  for (const block of blocks) {
    if (block.type === "paragraph" && countWords(block.content) > maxWords) {
      for (const part of splitLongParagraph(block.content, maxWords)) {
        expanded.push({ type: "paragraph", content: part });
      }
      continue;
    }
    expanded.push(block);
  }

  return expanded;
}

function flushChunk(parts: string[], chunks: string[]): void {
  const content = parts.join("\n\n").trim();
  if (content) {
    chunks.push(content);
  }
}

function chunkBlocks(
  blocks: MarkdownBlock[],
  targetWords: number,
  maxWords: number,
): string[] {
  const chunks: string[] = [];
  let currentParts: string[] = [];
  let currentWords = 0;

  for (const block of blocks) {
    const blockWords = countWords(block.content);
    const isStrongBoundary = block.type === "heading" || block.type === "code";

    if (
      currentParts.length > 0 &&
      currentWords + blockWords > maxWords &&
      currentWords >= targetWords
    ) {
      flushChunk(currentParts, chunks);
      currentParts = [];
      currentWords = 0;
    }

    if (
      currentParts.length > 0 &&
      isStrongBoundary &&
      currentWords >= targetWords * 0.5
    ) {
      flushChunk(currentParts, chunks);
      currentParts = [];
      currentWords = 0;
    }

    currentParts.push(block.content);
    currentWords += blockWords;
  }

  flushChunk(currentParts, chunks);
  return chunks;
}

export function chunkMarkdown(
  markdown: string,
  options: ChunkMarkdownOptions = {},
): ChunkResult[] {
  const targetWords = options.targetWords ?? DEFAULT_TARGET_WORDS;
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;

  const trimmed = markdown.trim();
  if (!trimmed) {
    return [];
  }

  const blocks = expandBlocks(parseMarkdownBlocks(trimmed), maxWords);
  const chunkContents = chunkBlocks(blocks, targetWords, maxWords);

  return chunkContents.map((content, chunkIndex) => {
    const wordCount = countWords(content);
    return {
      content,
      chunkIndex,
      tokenEstimate: estimateTokens(wordCount),
    };
  });
}
