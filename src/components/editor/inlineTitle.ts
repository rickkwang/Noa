import { Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

// Obsidian-style inline title: the note's file name rendered as a block widget
// ahead of the document's first line. It must live inside CodeMirror because
// .cm-scroller is the real scroll viewport — a header rendered by React above
// the editor would stay fixed instead of scrolling away with the content, and
// couldn't share the max-width content column the widget inherits for free.
// Title changes ride a StateEffect so renaming the open note refreshes the
// widget without rebuilding the editor (a rebuild drops cursor + undo history).
export const setInlineTitle = StateEffect.define<string>();

class InlineTitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }

  override eq(other: InlineTitleWidget): boolean {
    return other.title === this.title;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-noa-inline-title';
    el.textContent = this.title;
    return el;
  }
}

// side: -1 keeps the widget anchored before any text inserted at position 0.
const titleDecorations = (title: string): DecorationSet =>
  Decoration.set([
    Decoration.widget({ widget: new InlineTitleWidget(title), side: -1, block: true }).range(0),
  ]);

const inlineTitleField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setInlineTitle)) next = titleDecorations(effect.value);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Bundles the field with its initial value for a fresh EditorState. The init
// matters on editor rebuilds (note switch, theme toggle), where the rename
// effect in useCodeMirror doesn't re-fire and a bare field would render nothing.
export const inlineTitle = (title: string): Extension => [
  inlineTitleField,
  inlineTitleField.init(() => titleDecorations(title)),
];
