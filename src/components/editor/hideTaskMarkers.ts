import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// Matches the `<!-- noa-task:UUID -->` marker that the task panel injects, plus
// the single space that precedes it, so the task line reads cleanly once hidden.
const NOA_TASK_MARKER = /[ \t]*<!--\s*noa-task:[A-Za-z0-9_-]+\s*-->/g;

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    NOA_TASK_MARKER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NOA_TASK_MARKER.exec(text)) !== null) {
      const start = from + match.index;
      builder.add(start, start + match[0].length, Decoration.replace({}));
    }
  }
  return builder.finish();
}

// View-only: hides the noa-task tracking comment from the editor without
// touching the underlying document (so saving still persists the marker).
export const hideTaskMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);
