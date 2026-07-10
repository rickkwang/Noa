import { describe, it, expect } from 'vitest';
import { splitMarkdownForChunkedPreview } from '../../src/lib/markdownChunks';

// Small options so tests don't need megabyte fixtures. Production defaults are
// larger; the splitting logic is identical.
const opts = { threshold: 200, minChunkChars: 50 };

const section = (title: string, lines = 4) =>
  `## ${title}\n\n` + `Some paragraph text for ${title}.\n`.repeat(lines) + '\n';

describe('splitMarkdownForChunkedPreview', () => {
  it('returns the original string as a single chunk for short documents', () => {
    const md = '# Title\n\nhello world';
    expect(splitMarkdownForChunkedPreview(md, opts)).toEqual([md]);
  });

  it('splits a long document at heading boundaries and re-joins losslessly', () => {
    const md = section('One') + section('Two') + section('Three') + section('Four');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(md);
  });

  it('starts every chunk after the first with an ATX heading line', () => {
    const md = 'intro paragraph\n\n' + section('One') + section('Two') + section('Three');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(1)) {
      expect(chunk).toMatch(/^#{1,6} /);
    }
  });

  it('does not split at heading-looking lines inside fenced code blocks', () => {
    const fenced = '```\n# not a heading\n## also not\n```\n';
    const md = section('One') + fenced + 'text\n'.repeat(20) + section('Two');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.join('')).toBe(md);
    for (const chunk of chunks) {
      // A fence must never be torn apart: fences per chunk are balanced.
      const fences = (chunk.match(/^```/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it('respects ~~~ fences as well', () => {
    const fenced = '~~~\n# not a heading\n~~~\n';
    const md = section('One') + fenced + section('Two');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.join('')).toBe(md);
    for (const chunk of chunks) {
      const fences = (chunk.match(/^~~~/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it('does not split a four-backtick fence at nested triple backticks', () => {
    const fenced = '````md\n```\n' + 'inside\n'.repeat(12) + '# still code\n```\n````\n';
    const md = fenced + section('Real heading') + section('Another heading');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.join('')).toBe(md);
    expect(chunks.some((chunk) => chunk.startsWith('# still code'))).toBe(false);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('does not close a fence with a shorter marker run or trailing info', () => {
    const fenced = '````md\n``` not-a-close\n' + 'inside\n'.repeat(12) + '# still code\n````\n';
    const md = fenced + section('Real heading') + section('Another heading');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.join('')).toBe(md);
    expect(chunks.some((chunk) => chunk.startsWith('# still code'))).toBe(false);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('does not split at heading-looking lines inside an HTML block', () => {
    const html = '<div>\n' + 'raw html\n'.repeat(12) + '# still html\n</div>\n\n';
    const md = html + section('Real heading') + section('Another heading');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks).toEqual([md]);
  });

  it('keeps an HTML block with an incomplete opening tag on one chunk', () => {
    const html = '<div\n' + 'raw html\n'.repeat(12) + '# still html\n</div>\n\n';
    const md = html + section('Real heading') + section('Another heading');
    expect(splitMarkdownForChunkedPreview(md, opts)).toEqual([md]);
  });

  it('does not mistake a Markdown autolink for an HTML block', () => {
    const md = '<https://example.com>\n\n' + section('One') + section('Two') + section('Three');
    expect(splitMarkdownForChunkedPreview(md, opts).length).toBeGreaterThan(1);
  });

  it('does not split inside $$ math blocks', () => {
    const math = '$$\n# 1 + 2\nx = y\n$$\n';
    const md = section('One') + math + section('Two');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.join('')).toBe(md);
    for (const chunk of chunks) {
      const fences = (chunk.match(/^\$\$/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it('bails to a single chunk when footnote definitions are present', () => {
    const md = section('One') + section('Two') + 'Uses a note[^1].\n\n[^1]: the definition\n';
    expect(splitMarkdownForChunkedPreview(md, opts)).toEqual([md]);
  });

  it('bails to a single chunk when reference-style link definitions are present', () => {
    const md = section('One') + section('Two') + 'See [docs][ref].\n\n[ref]: https://example.com\n';
    expect(splitMarkdownForChunkedPreview(md, opts)).toEqual([md]);
  });

  it('does not treat link definitions inside code fences as a bail reason', () => {
    const md = section('One') + '```\n[ref]: https://example.com\n```\n' + section('Two');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('merges tiny sections so chunks meet the minimum size', () => {
    const tiny = (t: string) => `## ${t}\n\na\n\n`;
    const md = tiny('A') + tiny('B') + tiny('C') + tiny('D') + tiny('E') +
      tiny('F') + tiny('G') + tiny('H') + tiny('I') + tiny('J') +
      tiny('K') + tiny('L') + tiny('M') + tiny('N') + tiny('O') +
      tiny('P') + tiny('Q') + tiny('R') + tiny('S') + tiny('T') +
      tiny('U') + tiny('V') + tiny('W') + tiny('X') + tiny('Y') + tiny('Z');
    const chunks = splitMarkdownForChunkedPreview(md, opts);
    expect(chunks.join('')).toBe(md);
    // All but the last chunk should have reached the minimum size.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeGreaterThanOrEqual(opts.minChunkChars);
    }
    expect(chunks.length).toBeLessThan(26);
  });

  it('returns a single chunk for large documents with no headings', () => {
    const md = 'plain text line\n'.repeat(50);
    expect(splitMarkdownForChunkedPreview(md, opts)).toEqual([md]);
  });
});
