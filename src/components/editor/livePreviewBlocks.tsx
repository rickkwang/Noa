import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Range, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import { createRoot, type Root } from 'react-dom/client';
import { frontmatterEnd } from './hiddenFrontmatter';
import { livePreviewRefresh, mathBlocks, type LivePreviewContext } from './livePreview';
import { appendInline, editWidgetOnMouseDown, inlineOffsetAtCoords } from './livePreviewWidgets';
import { MermaidBlock } from './MermaidBlock';

// Block widgets (tables, `$$` math, Mermaid) replace whole lines, which CodeMirror only accepts from a
// state field, not a view plugin. They show source again whenever the cursor is inside them.

type Alignment = 'left' | 'center' | 'right' | null;
type TableCell = { text: string; offset: number };

class TableWidget extends WidgetType {
  constructor(readonly rows: TableCell[][], readonly aligns: Alignment[]) { super(); }
  eq(other: TableWidget) { return JSON.stringify(other.rows) === JSON.stringify(this.rows) && JSON.stringify(other.aligns) === JSON.stringify(this.aligns); }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-block cm-lp-table';
    const table = document.createElement('table');
    const [header, ...body] = this.rows;
    const addRow = (parent: HTMLElement, cells: TableCell[], cellTag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      cells.forEach(({ text, offset }, i) => {
        const cell = document.createElement(cellTag);
        if (this.aligns[i]) cell.style.textAlign = this.aligns[i]!;
        appendInline(cell, text.replace(/\\\|/g, '|'));
        editWidgetOnMouseDown(cell, view, (event) => {
          const visibleOffset = inlineOffsetAtCoords(cell, event);
          let sourceOffset = 0;
          for (let visible = 0; visible < visibleOffset; visible++, sourceOffset++) {
            if (text[sourceOffset] === '\\' && text[sourceOffset + 1] === '|') sourceOffset++;
          }
          return offset + sourceOffset;
        }, wrap);
        tr.appendChild(cell);
      });
      parent.appendChild(tr);
    };
    const thead = document.createElement('thead');
    addRow(thead, header ?? [], 'th');
    const tbody = document.createElement('tbody');
    for (const row of body) addRow(tbody, row, 'td');
    table.append(thead, tbody);
    wrap.appendChild(table);
    return wrap;
  }
}

class MathBlockWidget extends WidgetType {
  constructor(readonly tex: string, readonly contentOffset: number) { super(); }
  eq(other: MathBlockWidget) { return other.tex === this.tex && other.contentOffset === this.contentOffset; }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'cm-lp-block cm-lp-math-block';
    el.innerHTML = katex.renderToString(this.tex, { displayMode: true, throwOnError: false });
    editWidgetOnMouseDown(el, view, () => this.contentOffset);
    return el;
  }
}

// Mermaid renders through the same component the Reading view uses, so the diagram and its theme match.
const mermaidRoots = new WeakMap<HTMLElement, Root>();
class MermaidWidget extends WidgetType {
  constructor(readonly code: string, readonly isDark: boolean) { super(); }
  eq(other: MermaidWidget) { return other.code === this.code && other.isDark === this.isDark; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-lp-block cm-lp-mermaid';
    const root = createRoot(el);
    root.render(<MermaidBlock code={this.code} isDark={this.isDark} />);
    mermaidRoots.set(el, root);
    return el;
  }
  destroy(dom: HTMLElement) {
    mermaidRoots.get(dom)?.unmount();
    mermaidRoots.delete(dom);
  }
  ignoreEvent() { return true; }
}

// Table rows split on unescaped pipes; leading and trailing pipes are optional.
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function build(state: EditorState, getContext: () => LivePreviewContext): DecorationSet {
  const { doc, selection } = state;
  const bodyStart = frontmatterEnd(state) ?? 0;
  const touches = (from: number, to: number) => selection.ranges.some((r) => r.from <= to && r.to >= from);
  const decos: Range<Decoration>[] = [];
  const blockReplace = (from: number, to: number, widget: WidgetType) => {
    decos.push(Decoration.replace({ widget, block: true }).range(from, to));
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from < bodyStart) return;
      if (node.name === 'Table') {
        const start = doc.lineAt(node.from);
        const end = doc.lineAt(node.to);
        if (touches(start.from, end.to)) return false;
        // Cells come from the parse tree, so a table inside a quote or list has no "> " prefix in its first cell.
        const rows: TableCell[][] = [];
        let delimiter = '';
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === 'TableDelimiter') delimiter = doc.sliceString(child.from, child.to);
          if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;
          const cells: TableCell[] = [];
          const addCell = (from: number, to: number) => {
            const raw = doc.sliceString(from, to);
            cells.push({ text: raw.trim(), offset: from - start.from + raw.length - raw.trimStart().length });
          };
          let cellFrom = child.from;
          for (let part = child.firstChild; part; part = part.nextSibling) {
            if (part.name !== 'TableDelimiter') continue;
            if (part.from !== child.from) addCell(cellFrom, part.from);
            cellFrom = part.to;
          }
          if (doc.sliceString(cellFrom, child.to).trim()) addCell(cellFrom, child.to);
          rows.push(cells);
        }
        const aligns = splitRow(delimiter).map(alignmentOf);
        blockReplace(start.from, end.to, new TableWidget(rows, aligns));
        return false;
      }
      if (node.name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo');
        if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== 'mermaid') return false;
        const open = doc.lineAt(node.from);
        const close = doc.lineAt(node.to);
        // An unclosed fence runs to the end of the document; there is no closing line to match.
        if (close.number === open.number || !/^\s*(`{3,}|~{3,})\s*$/.test(close.text)) return false;
        if (touches(open.from, close.to)) return false;
        const code = doc.sliceString(open.to + 1, close.from - 1);
        blockReplace(open.from, close.to, new MermaidWidget(code, getContext().isDark()));
        return false;
      }
    },
  });

  for (const block of mathBlocks(state, bodyStart)) {
    if (touches(block.from, block.to)) continue;
    const openingLine = doc.lineAt(block.from);
    const contentOffset = openingLine.text.trim() === '$$'
      ? openingLine.to + 1 - block.from
      : openingLine.text.indexOf('$$') + 2;
    blockReplace(block.from, block.to, new MathBlockWidget(block.tex, contentOffset));
  }

  return Decoration.set(decos, true);
}

export function livePreviewBlocks(getContext: () => LivePreviewContext): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, getContext),
    update: (deco, tr) =>
      tr.docChanged || tr.selection || tr.effects.some((e) => e.is(livePreviewRefresh)) ? build(tr.state, getContext) : deco,
    provide: (field) => EditorView.decorations.from(field),
  });
}
