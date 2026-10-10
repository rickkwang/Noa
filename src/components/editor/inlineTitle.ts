import { Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

// Obsidian-style inline title as a block widget before line 1. Lives inside CodeMirror so it scrolls with the
// content (.cm-scroller is the real viewport) and shares the content column. Renames use a StateEffect, not a rebuild.
export const setInlineTitle = StateEffect.define<string>();

class InlineTitleWidget extends WidgetType {
  constructor(readonly title: string, readonly slot?: HTMLElement) {
    super();
  }

  override eq(other: InlineTitleWidget): boolean {
    return other.title === this.title && other.slot === this.slot;
  }

  override toDOM(): HTMLElement {
    const title = document.createElement('div');
    title.className = 'cm-noa-inline-title';
    title.textContent = this.title;
    if (!this.slot) return title;
    // The slot is one persistent element React portals the Properties UI into;
    // re-appending it on a rename moves it rather than losing the portal.
    const wrapper = document.createElement('div');
    wrapper.append(title, this.slot);
    return wrapper;
  }
}

// side: -1 keeps the widget anchored before any text inserted at position 0.
const titleDecorations = (title: string, slot?: HTMLElement): DecorationSet =>
  Decoration.set([
    Decoration.widget({ widget: new InlineTitleWidget(title, slot), side: -1, block: true }).range(0),
  ]);

// The init value matters on rebuilds (note switch, theme toggle): the rename effect doesn't re-fire there.
export const inlineTitle = (title: string, slot?: HTMLElement): Extension => {
  const field = StateField.define<DecorationSet>({
    create: () => titleDecorations(title, slot),
    update: (deco, tr) => {
      let next = deco.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(setInlineTitle)) next = titleDecorations(effect.value, slot);
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return field;
};
