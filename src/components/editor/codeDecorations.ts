import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// Full-width background + left rule on each line of a code block; first/last lines add padding so fences aren't glued to the edge.
const codeLineDeco = Decoration.line({ class: 'cm-code-line' });
const codeLineFirstDeco = Decoration.line({ class: 'cm-code-line cm-code-line-first' });
const codeLineLastDeco = Decoration.line({ class: 'cm-code-line cm-code-line-last' });
const codeLineSoloDeco = Decoration.line({ class: 'cm-code-line cm-code-line-first cm-code-line-last' });
// Subtle pill behind inline `code`.
const inlineCodeDeco = Decoration.mark({ class: 'cm-inline-code' });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
          // Clamp to the visible range: RangeSetBuilder needs sorted adds, and multi-range viewports break that otherwise.
          const startLine = doc.lineAt(Math.max(node.from, from)).number;
          const endLine = doc.lineAt(Math.min(node.to, to)).number;
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            const deco =
              startLine === endLine ? codeLineSoloDeco :
              n === startLine ? codeLineFirstDeco :
              n === endLine ? codeLineLastDeco :
              codeLineDeco;
            builder.add(line.from, line.from, deco);
          }
        } else if (node.name === 'InlineCode') {
          builder.add(node.from, node.to, inlineCodeDeco);
        }
      },
    });
  }
  return builder.finish();
}

// View-only: a unified background per code block (per-token backgrounds look ragged). Styling lives in the theme's .cm-code-line rules.
export const codeDecorations = ViewPlugin.fromClass(
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
  },
);
