import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

// Matches the CSS animation on .noa-landed-line; the decoration is dropped once it has played out.
const LANDED_MS = 1600;

const setLandedLine = StateEffect.define<number | null>();

export const landedLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setLandedLine)) continue;
      if (effect.value === null) return Decoration.none;
      return Decoration.set([Decoration.line({ class: 'noa-landed-line' }).range(effect.value)]);
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const clearTimers = new WeakMap<EditorView, number>();

/** Flashes the line a jump landed on, so the eye finds it after the scroll. */
export function markLandedLine(view: EditorView, lineFrom: number): void {
  window.clearTimeout(clearTimers.get(view));
  // Clear first so a second jump to the same line restarts the animation on a fresh element.
  view.dispatch({ effects: setLandedLine.of(null) });
  view.dispatch({ effects: setLandedLine.of(lineFrom) });
  clearTimers.set(view, window.setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: setLandedLine.of(null) });
  }, LANDED_MS));
}
