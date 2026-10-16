import { Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

// Obsidian-style inline title as a block widget before line 1. Lives inside CodeMirror so it scrolls with the
// content (.cm-scroller is the real viewport) and shares the content column. Renames use a StateEffect, not a rebuild.
export const setInlineTitle = StateEffect.define<string>();

// CodeMirror sizes a block widget by the height it measured when drawn. Two things change that height without
// CodeMirror knowing: the Properties UI renders after mount, and the editor may be drawn while hidden (reading view),
// when every height reads 0. Re-creating the widget is the only way to make CodeMirror measure it again.
const remeasureInlineTitle = StateEffect.define<null>();

const heightObservers = new WeakMap<HTMLElement, { disconnect(): void }>();
const settledSlots = new WeakSet<HTMLElement>();
// The height CodeMirror currently has for the title, per slot (one slot per editor). Used to decide when to re-measure.
const measuredHeights = new WeakMap<HTMLElement, number>();
// The last height seen while visible, per slot. Used as the estimate for when the title is out of view.
const knownHeights = new WeakMap<HTMLElement, number>();

class InlineTitleWidget extends WidgetType {
  constructor(readonly title: string, readonly slot: HTMLElement | undefined, readonly version: number) {
    super();
  }

  override eq(other: InlineTitleWidget): boolean {
    return other.title === this.title && other.slot === this.slot && other.version === this.version;
  }

  // Out of view the title is never drawn, so CodeMirror sizes it by this estimate.
  override get estimatedHeight(): number {
    return (this.slot && knownHeights.get(this.slot)) || 60;
  }

  override toDOM(view: EditorView): HTMLElement {
    const title = document.createElement('div');
    title.className = 'cm-noa-inline-title';
    title.textContent = this.title;
    if (!this.slot) return title;
    // The slot is one persistent element React portals the Properties UI into;
    // re-appending it on a rename moves it rather than losing the portal.
    const wrapper = document.createElement('div');
    // flow-root keeps the Properties UI's own bottom margin inside the box; a collapsed margin is invisible to CodeMirror.
    wrapper.style.display = 'flow-root';
    wrapper.append(title, this.slot);
    observeHeight(wrapper, this.slot, view);
    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    heightObservers.get(dom)?.disconnect();
    heightObservers.delete(dom);
  }
}

function observeHeight(wrapper: HTMLElement, slot: HTMLElement, view: EditorView): void {
  const remeasure = () => {
    if (!wrapper.isConnected) return;
    // Moving the slot would drop focus from a property being edited, so wait until focus leaves it.
    if (slot.contains(document.activeElement)) {
      slot.addEventListener('focusout', () => setTimeout(remeasure, 0), { once: true });
      return;
    }
    const height = wrapper.offsetHeight;
    if (height > 0) knownHeights.set(slot, height);
    measuredHeights.set(slot, height);
    view.dispatch({ effects: remeasureInlineTitle.of(null) });
  };
  // The Properties UI commits after the widget is drawn, so its DOM changes are the reliable signal.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      remeasure();
    });
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(slot, { childList: true, subtree: true, characterData: true });
  // The Properties UI may already be in the slot when the widget is drawn, with no mutation left to observe.
  if (!settledSlots.has(slot)) {
    settledSlots.add(slot);
    schedule();
  }
  // Size changes without a DOM change, such as the window narrowing a row, and the first real layout after a hidden
  // mount. A visible height that differs from CodeMirror's is the cue to re-measure; zero means hidden.
  const resizes = new ResizeObserver(() => {
    const height = wrapper.offsetHeight;
    if (height <= 0) return;
    knownHeights.set(slot, height);
    if (height !== measuredHeights.get(slot)) schedule();
  });
  resizes.observe(wrapper);
  heightObservers.set(wrapper, {
    disconnect() {
      mutations.disconnect();
      resizes.disconnect();
    },
  });
}

// Called when the editor is shown again: the title may have been drawn while hidden, when every height reads as 0.
export const remeasureTitle = (view: EditorView): void => {
  view.dispatch({ effects: remeasureInlineTitle.of(null) });
};

// side: -1 keeps the widget anchored before any text inserted at position 0.
const titleDecorations = (title: string, slot: HTMLElement | undefined, version: number): DecorationSet =>
  Decoration.set([
    Decoration.widget({ widget: new InlineTitleWidget(title, slot, version), side: -1, block: true }).range(0),
  ]);

// The init value matters on rebuilds (note switch, theme toggle): the rename effect doesn't re-fire there.
export const inlineTitle = (title: string, slot?: HTMLElement): Extension => {
  let current = title;
  let version = 0;
  const field = StateField.define<DecorationSet>({
    create: () => titleDecorations(title, slot, version),
    update: (deco, tr) => {
      let next = deco.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(setInlineTitle)) {
          current = effect.value;
          next = titleDecorations(current, slot, version);
        }
        if (effect.is(remeasureInlineTitle)) next = titleDecorations(current, slot, ++version);
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return field;
};
