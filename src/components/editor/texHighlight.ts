// Colours LaTeX source the way Obsidian does: its editor runs CodeMirror 5's stex mode inside `$…$` and `$$…$$`.
// These are that mode's math-mode rules; operators, spaces and anything unrecognised stay uncoloured.
export type TexTokenType = 'command' | 'variable' | 'number' | 'bracket' | 'comment';
export type TexToken = { from: number; to: number; type: TexTokenType };

const RULES: [RegExp, TexTokenType | null][] = [
  [/^\\[a-zA-Z@]+/, 'command'],
  [/^[a-zA-Z]+/, 'variable'],
  [/^\\[^a-zA-Z]/, 'command'],
  [/^[\^_&]/, 'command'],
  [/^(\d+\.\d*|\d*\.\d+|\d+)/, 'number'],
  [/^[{}[\]()]/, 'bracket'],
  [/^%.*/, 'comment'],
];

export function texTokens(tex: string): TexToken[] {
  const tokens: TexToken[] = [];
  let pos = 0;
  while (pos < tex.length) {
    const rest = tex.slice(pos);
    let length = 1;
    for (const [pattern, type] of RULES) {
      const match = pattern.exec(rest);
      if (!match) continue;
      length = match[0].length;
      if (type) tokens.push({ from: pos, to: pos + length, type });
      break;
    }
    pos += length;
  }
  return tokens;
}

// `$x$` with no space just inside the delimiters, and no digit right after the closing `$` (so prices stay text).
export const INLINE_MATH = /(?<![\\$])\$(?![\s$])([^$\n]*?[^\s$\\])\$(?![\d$])/g;
