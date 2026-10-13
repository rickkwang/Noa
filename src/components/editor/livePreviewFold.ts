import { foldGutter, foldService, syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Line } from '@codemirror/state';

// A heading folds the lines under it, up to the next heading of the same or a higher level.
const HEADING = /^(#{1,6})\s/;

// Only a real heading, not a `#` line inside a code block.
const headingLevel = (state: EditorState, line: Line): number | null => {
  const match = HEADING.exec(line.text);
  if (!match || !syntaxTree(state).resolveInner(line.from, 1).parent?.name.startsWith('ATXHeading')) return null;
  return match[1].length;
};

const headingFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const level = headingLevel(state, line);
  if (level === null) return null;
  let end = line.to;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n);
    const nextLevel = headingLevel(state, next);
    if (nextLevel !== null && nextLevel <= level) break;
    end = next.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

export const livePreviewFolding: Extension = [
  headingFold,
  foldGutter({
    markerDOM: (open) => {
      const el = document.createElement('span');
      el.className = open ? 'cm-lp-fold' : 'cm-lp-fold cm-lp-fold-closed';
      el.setAttribute('aria-label', open ? 'Fold heading' : 'Unfold heading');
      el.textContent = open ? '▾' : '▸';
      return el;
    },
  }),
];
