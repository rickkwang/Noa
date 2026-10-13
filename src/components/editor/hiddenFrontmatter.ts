import { EditorState, Extension, RangeSet, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { splitFrontmatter } from '../../lib/frontmatter';

// Obsidian-style: a leading --- block is shown as the Properties UI under the
// inline title, so its source lines are hidden and protected from typing.
const FRONTMATTER_SCAN_LIMIT = 20_000;

export function frontmatterEnd(state: EditorState): number | null {
  if (state.doc.sliceString(0, 3) !== '---') return null;
  // Runs on every keystroke: scan only the head of the doc, not the whole note.
  // A frontmatter block longer than this simply stays visible as source.
  const text = state.doc.sliceString(0, FRONTMATTER_SCAN_LIMIT);
  const { body, eol } = splitFrontmatter(text);
  if (!eol) return null;
  // End of the closing --- line, excluding its line break (block replaces must cover whole lines).
  const bodyStart = text.length - body.length;
  return text.startsWith(eol, bodyStart - eol.length) ? bodyStart - eol.length : bodyStart;
}

const build = (state: EditorState): DecorationSet => {
  const end = frontmatterEnd(state);
  return end === null ? Decoration.none : Decoration.set([Decoration.replace({ block: true }).range(0, end)]);
};

const hiddenFrontmatterField = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field) as RangeSet<Decoration>),
  ],
});

/** `allowChange` lets property edits (external content syncs) rewrite the hidden block. */
export const hiddenFrontmatter = (allowChange: (tr: Transaction) => boolean): Extension => [
  hiddenFrontmatterField,
  EditorState.changeFilter.of((tr) => {
    if (allowChange(tr)) return true;
    const end = frontmatterEnd(tr.startState);
    return end === null ? true : [0, end];
  }),
];
