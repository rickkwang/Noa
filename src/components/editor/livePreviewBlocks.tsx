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

// A cell open for editing shows its raw source; it commits back to the document when it loses focus or the user moves on.
type OpenCell = { view: EditorView; cell: HTMLElement; tableStart: number; from: number; text: string };
const cellSources = new WeakMap<HTMLElement, TableCell>();
let openCell: OpenCell | null = null;

// The rendered text shows an escaped pipe as "|", so a rendered offset skips the backslash to reach the source.
function rawOffset(text: string, rendered: number): number {
  let raw = 0;
  for (let i = 0; i < rendered; i++, raw++) {
    if (text[raw] === '\\' && text[raw + 1] === '|') raw++;
  }
  return raw;
}

const cellsOf = (wrap: HTMLElement) => Array.from(wrap.querySelectorAll<HTMLElement>('th, td'));

function openTableCell(view: EditorView, cell: HTMLElement, caret: number) {
  const source = cellSources.get(cell);
  const wrap = cell.closest<HTMLElement>('.cm-lp-table');
  if (!source || !wrap) return;
  const tableStart = view.posAtDOM(wrap);
  openCell = { view, cell, tableStart, from: tableStart + source.offset, text: source.text };
  cell.contentEditable = 'true';
  cell.textContent = source.text;
  cell.focus();
  const range = cell.ownerDocument.createRange();
  const node = cell.firstChild;
  if (node) range.setStart(node, Math.min(caret, node.textContent?.length ?? 0));
  else range.setStart(cell, 0);
  range.collapse(true);
  const selection = cell.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function commitOpenCell() {
  const open = openCell;
  if (!open) return;
  openCell = null;
  open.cell.contentEditable = 'false';
  // A pasted line break would split the row, so it becomes a space; an unescaped pipe would split the cell.
  const edited = (open.cell.textContent ?? '').replace(/\s*\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|');
  // If the document changed under the open cell, drop the edit rather than write it over other text.
  if (edited !== open.text && open.view.state.sliceDoc(open.from, open.from + open.text.length) === open.text) {
    open.view.dispatch({ changes: { from: open.from, to: open.from + open.text.length, insert: edited } });
    return;
  }
  // No document change means no rebuilt table, so the cell renders its source again itself.
  open.cell.textContent = '';
  appendInline(open.cell, open.text.replace(/\\\|/g, '|'));
}

// A commit rebuilds the table, so the target cell is looked up again by the table's position.
function reopenAt(view: EditorView, tableStart: number, index: number, caret: number) {
  for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>('.cm-lp-table')) {
    if (view.posAtDOM(wrap) !== tableStart) continue;
    const target = cellsOf(wrap)[index];
    if (target) openTableCell(view, target, caret);
    return;
  }
}

function onCellMouseDown(event: MouseEvent, view: EditorView, cell: HTMLElement) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || view.state.readOnly) return;
  // Inside the open cell the native caret moves; anywhere else the cell opens.
  if (openCell?.cell === cell) return;
  const source = cellSources.get(cell);
  const wrap = cell.closest<HTMLElement>('.cm-lp-table');
  if (!source || !wrap) return;
  event.preventDefault();
  const caret = rawOffset(source.text, inlineOffsetAtCoords(cell, event));
  const tableStart = view.posAtDOM(wrap);
  const index = cellsOf(wrap).indexOf(cell);
  commitOpenCell();
  reopenAt(view, tableStart, index, caret);
}

function onCellKeyDown(event: KeyboardEvent, view: EditorView, cell: HTMLElement) {
  const open = openCell;
  if (!open || open.cell !== cell) return;
  const wrap = cell.closest<HTMLElement>('.cm-lp-table');
  if (!wrap) return;
  const index = cellsOf(wrap).indexOf(cell);
  const cols = cell.closest('table')!.rows[0].cells.length;
  if (event.key === 'Tab') {
    event.preventDefault();
    commitOpenCell();
    reopenAt(view, open.tableStart, index + (event.shiftKey ? -1 : 1), event.shiftKey ? Infinity : 0);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    commitOpenCell();
    reopenAt(view, open.tableStart, index + cols, 0);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    commitOpenCell();
    view.focus();
  }
}

class TableWidget extends WidgetType {
  constructor(readonly rows: TableCell[][], readonly aligns: Alignment[], readonly length: number) { super(); }
  eq(other: TableWidget) {
    return other.length === this.length && JSON.stringify(other.rows) === JSON.stringify(this.rows) && JSON.stringify(other.aligns) === JSON.stringify(this.aligns);
  }
  // Edits made inside an open cell are not document changes until they commit.
  ignoreMutation() { return true; }
  // CodeMirror scrolls by this estimate until the table is drawn, so a rough row height keeps a restored position close.
  get estimatedHeight() { return this.rows.length * 24 + 20; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-block cm-lp-table';
    // Off the cells, a click puts the caret on the line after the table and the table stays rendered, as in Obsidian.
    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || view.state.readOnly) return;
      if ((event.target as HTMLElement).closest('td, th')) return;
      event.preventDefault();
      const end = view.posAtDOM(wrap) + this.length;
      if (end < view.state.doc.length) {
        view.dispatch({ selection: { anchor: end + 1 }, scrollIntoView: true });
      } else {
        view.dispatch({ changes: { from: end, insert: '\n' }, selection: { anchor: end + 1 }, scrollIntoView: true });
      }
      view.focus();
    });
    const table = document.createElement('table');
    const [header, ...body] = this.rows;
    const addRow = (parent: HTMLElement, cells: TableCell[], cellTag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      cells.forEach((source, i) => {
        const cell = document.createElement(cellTag);
        if (this.aligns[i]) cell.style.textAlign = this.aligns[i]!;
        appendInline(cell, source.text.replace(/\\\|/g, '|'));
        cellSources.set(cell, source);
        cell.addEventListener('mousedown', (event) => onCellMouseDown(event, view, cell));
        cell.addEventListener('keydown', (event) => onCellKeyDown(event, view, cell));
        cell.addEventListener('blur', () => {
          if (openCell?.cell === cell) commitOpenCell();
        });
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
  get estimatedHeight() { return 50; }
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
  get estimatedHeight() { return 200; }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'cm-lp-block cm-lp-mermaid';
    const root = createRoot(el);
    root.render(<MermaidBlock code={this.code} isDark={this.isDark} />);
    mermaidRoots.set(el, root);
    // The block's opening fence reveals the source, as a click on a Mermaid block does in Obsidian.
    editWidgetOnMouseDown(el, view, () => 0);
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
        blockReplace(start.from, end.to, new TableWidget(rows, aligns, end.to - start.from));
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
