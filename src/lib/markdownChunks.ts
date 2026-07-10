/**
 * Splits a markdown document into independently renderable chunks so the
 * preview can render each chunk as its own (memoized) component. React's
 * concurrent renderer yields between components, which turns one long
 * parse-and-render task for a big note into many small ones.
 *
 * Chunks cut only at column-0 ATX heading lines outside fenced code blocks
 * and $$ math blocks — a heading always terminates the preceding block in
 * CommonMark, so parsing each chunk in isolation produces the same output as
 * parsing the whole document. Documents that rely on cross-chunk state
 * (footnote or reference-link definitions) are returned as a single chunk.
 */

export interface ChunkOptions {
  /** Documents shorter than this are returned as a single chunk. */
  threshold?: number;
  /** Sections are merged until a chunk reaches at least this many chars. */
  minChunkChars?: number;
}

const DEFAULT_THRESHOLD = 24_000;
const DEFAULT_MIN_CHUNK_CHARS = 3_000;

const HEADING_RE = /^#{1,6} /;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const MATH_FENCE_RE = /^ {0,3}\$\$[ \t]*$/;
// Raw HTML blocks have more cross-line states than a lightweight splitter can
// safely reproduce. Conservatively keep these uncommon documents as one chunk.
// The post-name delimiter excludes autolinks such as <https://example.com>.
const HTML_BLOCK_START_RE = /^ {0,3}(?:<!--|<\?|<![A-Z]|<!\[CDATA\[|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>|$))/i;
// Footnote ([^id]: …) and reference-link ([id]: …) definitions have
// document-wide scope, so separate Markdown parses would orphan references.
const DEFINITION_RE = /^ {0,3}\[[^\]]*\]:/;

interface FenceState {
  marker: '`' | '~';
  length: number;
}

export function splitMarkdownForChunkedPreview(
  markdown: string,
  options: ChunkOptions = {}
): string[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minChunkChars = options.minChunkChars ?? DEFAULT_MIN_CHUNK_CHARS;
  if (markdown.length < threshold) return [markdown];

  let fence: FenceState | null = null;
  let inMathBlock = false;
  const cutOffsets: number[] = [];

  let offset = 0;
  for (const line of markdown.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;

    if (fence) {
      const close = line.match(FENCE_CLOSE_RE)?.[1];
      if (close && close[0] === fence.marker && close.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (inMathBlock) {
      if (MATH_FENCE_RE.test(line)) inMathBlock = false;
      continue;
    }

    const opener = line.match(FENCE_OPEN_RE);
    if (opener) {
      const run = opener[1];
      const marker = run[0] as FenceState['marker'];
      // CommonMark forbids backticks in a backtick fence's info string.
      if (marker === '~' || !opener[2].includes('`')) {
        fence = { marker, length: run.length };
        continue;
      }
    }
    if (MATH_FENCE_RE.test(line)) {
      inMathBlock = true;
      continue;
    }
    if (HTML_BLOCK_START_RE.test(line) || DEFINITION_RE.test(line)) return [markdown];
    if (lineStart > 0 && HEADING_RE.test(line)) cutOffsets.push(lineStart);
  }

  if (cutOffsets.length === 0) return [markdown];

  const chunks: string[] = [];
  let chunkStart = 0;
  for (const cut of cutOffsets) {
    if (cut - chunkStart < minChunkChars) continue;
    chunks.push(markdown.slice(chunkStart, cut));
    chunkStart = cut;
  }
  chunks.push(markdown.slice(chunkStart));
  return chunks;
}
