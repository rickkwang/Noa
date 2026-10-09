import { Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

// Obsidian-style inline title as a block widget before line 1. Lives inside CodeMirror so it scrolls with the
// content (.cm-scroller is the real viewport) and shares the content column. Renames use a StateEffect, not a rebuild.
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

// The init value matters on rebuilds (note switch, theme toggle): the rename effect doesn't re-fire there.
export const inlineTitle = (title: string): Extension => [
  inlineTitleField,
  inlineTitleField.init(() => titleDecorations(title)),
];
