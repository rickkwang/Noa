import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// Full-width line background + left rule for every line a code block spans.
// First/last lines carry extra classes that add top/bottom padding so the
// opening/closing fence isn't glued to the block's edge.
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
          // Clamp to the visible range so multi-range viewports never add
          // line decorations out of order (RangeSetBuilder requires sorted adds).
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

// View-only: paints a unified background behind fenced/indented code blocks
// (per-token highlight backgrounds leave ragged bars) and a rounded pill behind
// inline code. Visual styling lives in the light/dark theme's .cm-code-line /
// .cm-inline-code rules.
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
