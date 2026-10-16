import { foldGutter, foldService, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension, type Line, type Text } from '@codemirror/state';
import { GutterMarker, gutterLineClass } from '@codemirror/view';

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

// Obsidian's Live Preview spacing: a heading line gets 1rem above it (.cm-lp-heading), except right after a heading
// and a blank line. With the blank line's own height this matches the Reading view's 2.5rem before a heading.
export const isTightHeading = (doc: Text, lineNumber: number): boolean =>
  lineNumber > 2 && doc.line(lineNumber - 1).text.trim() === '' && /^#{1,6}(\s|$)/.test(doc.line(lineNumber - 2).text);

// The gutter row takes the heading line's top padding too, so the fold marker sits beside the text, not above it.
// A `#` line that isn't a real heading (inside a code block) gets no marker, so the padding there shows nothing.
class HeadingGutterSpace extends GutterMarker {
  override elementClass = 'cm-lp-heading';
}
const headingGutterSpace = new HeadingGutterSpace();
const headingGutterSpacing = gutterLineClass.compute(['doc'], (state) => {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (HEADING.test(line.text) && !isTightHeading(state.doc, n)) builder.add(line.from, line.from, headingGutterSpace);
  }
  return builder.finish();
});

export const livePreviewFolding: Extension = [
  headingFold,
  headingGutterSpacing,
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
