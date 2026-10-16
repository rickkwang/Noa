import { syntaxTree } from '@codemirror/language';
import { ChangeSpec, EditorState, Extension, Line, Range, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import { createRoot, type Root } from 'react-dom/client';
import { frontmatterEnd } from './hiddenFrontmatter';
import { livePreviewRefresh, mathBlocks, type LivePreviewContext } from './livePreview';
import { appendInline, editWidgetOnMouseDown, inlineOffsetAtCoords } from './livePreviewWidgets';
import { MermaidBlock } from './MermaidBlock';
import { INLINE_MATH, texTokens, type TexTokenType } from './texHighlight';

// Block widgets (tables, `$$` math, Mermaid) replace whole lines, which CodeMirror only accepts from a
// state field, not a view plugin. They show source again whenever the cursor is inside them.

type Alignment = 'left' | 'center' | 'right' | null;
// @lezer/common's node type, reached through @codemirror/language so no undeclared package is imported.
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];
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

// A cell's text lives in a .cm-lp-cell div (Obsidian's .table-cell-wrapper), which is what opens for editing; the
// th/td around it also holds the row and column handles, which an edit must not wipe.
const cellsOf = (wrap: HTMLElement) => Array.from(wrap.querySelectorAll<HTMLElement>('.cm-lp-cell'));

// An open cell is plain contenteditable text, so its math is coloured with the CSS Custom Highlight API (index.css,
// ::highlight(noa-tex-*)): it paints ranges without touching the DOM, which keeps the caret and IME composition intact.
const TEX_HIGHLIGHTS: (TexTokenType | 'delim')[] = ['delim', 'command', 'variable', 'number', 'bracket', 'comment'];

function textPosition(root: HTMLElement, offset: number): [Node, number] | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return [node, remaining];
    remaining -= length;
  }
  return null;
}

function paintCellMath(cell: HTMLElement | null) {
  const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
  if (!registry) return;
  const groups = new Map<string, globalThis.Range[]>();
  const add = (type: string, from: number, to: number) => {
    if (!cell) return;
    const start = textPosition(cell, from);
    const end = textPosition(cell, to);
    if (!start || !end) return;
    const range = cell.ownerDocument.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    groups.set(type, [...(groups.get(type) ?? []), range]);
  };
  for (const match of (cell?.textContent ?? '').matchAll(INLINE_MATH)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    add('delim', start, start + 1);
    add('delim', end - 1, end);
    for (const token of texTokens(match[1])) add(token.type, start + 1 + token.from, start + 1 + token.to);
  }
  for (const type of TEX_HIGHLIGHTS) registry.set(`noa-tex-${type}`, new Highlight(...(groups.get(type) ?? [])));
}

function openTableCell(view: EditorView, cell: HTMLElement, caret: number) {
  const source = cellSources.get(cell);
  const wrap = cell.closest<HTMLElement>('.cm-lp-table');
  if (!source || !wrap) return;
  const tableStart = view.posAtDOM(wrap);
  openCell = { view, cell, tableStart, from: tableStart + source.offset, text: source.text };
  cell.contentEditable = 'true';
  cell.textContent = source.text;
  paintCellMath(cell);
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
  paintCellMath(null);
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

type TableSource = { delimiter: Line; rows: { line: Line; cells: { from: number; text: string }[] }[] };

// Cells come from the parse tree, so a table inside a quote or list has no "> " prefix in its first cell.
// `rows` holds the header first; `from` is where a cell's trimmed text starts.
function readTable(doc: Text, node: SyntaxNode): TableSource {
  const rows: TableSource['rows'] = [];
  let delimiter = doc.lineAt(node.from);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') delimiter = doc.lineAt(child.from);
    if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;
    const cells: TableSource['rows'][number]['cells'] = [];
    const addCell = (from: number, to: number) => {
      const raw = doc.sliceString(from, to);
      // An empty cell starts one space in, so text typed into it lands as `| text |`, not against the closing pipe.
      const lead = raw.trim() ? raw.length - raw.trimStart().length : Math.min(1, raw.length);
      cells.push({ from: from + lead, text: raw.trim() });
    };
    let cellFrom = child.from;
    for (let part = child.firstChild; part; part = part.nextSibling) {
      if (part.name !== 'TableDelimiter') continue;
      if (part.from !== child.from) addCell(cellFrom, part.from);
      cellFrom = part.to;
    }
    if (doc.sliceString(cellFrom, child.to).trim()) addCell(cellFrom, child.to);
    rows.push({ line: doc.lineAt(child.from), cells });
  }
  return { delimiter, rows };
}

// The table whose widget starts at `lineStart`, read from the current document (a cell commit may have just changed it).
function tableAt(state: EditorState, lineStart: number): TableSource | null {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    from: lineStart,
    to: state.doc.lineAt(lineStart).to,
    enter: (node) => {
      if (found) return false;
      if (node.name === 'Table' && state.doc.lineAt(node.from).from === lineStart) found = node.node;
    },
  });
  return found ? readTable(state.doc, found) : null;
}

// Obsidian's "Add row below": an empty row after the last one, with its first cell open.
function addTableRow(view: EditorView, tableStart: number) {
  const table = tableAt(view.state, tableStart);
  if (!table) return;
  const columns = table.rows[0].cells.length;
  const last = table.rows[table.rows.length - 1].line;
  // A table in a quote or an indented list item repeats that line's prefix.
  const prefix = /^[\s>]*/.exec(last.text)?.[0] ?? '';
  view.dispatch({ changes: { from: last.to, insert: `\n${prefix}|${'   |'.repeat(columns)}` } });
  reopenAt(view, tableStart, table.rows.reduce((count, row) => count + row.cells.length, 0), 0);
}

// Obsidian's "Add column to the right": an empty column after the header's last one, with its header cell open.
// Short rows are padded first so the new cell lands in the new column.
function addTableColumn(view: EditorView, tableStart: number) {
  const table = tableAt(view.state, tableStart);
  if (!table) return;
  const { doc } = view.state;
  const columns = table.rows[0].cells.length;
  const changes: ChangeSpec[] = [];
  for (const { line, cells } of table.rows) {
    const kept = Math.min(cells.length, columns);
    if (kept === 0) continue;
    const after = cells[kept - 1].from + cells[kept - 1].text.length;
    const added = '   |'.repeat(columns - kept + 1);
    const pipe = /^\s*\|/.exec(doc.sliceString(after, line.to));
    changes.push(pipe ? { from: after + pipe[0].length, insert: added } : { from: line.to, insert: ` |${added}` });
  }
  const delimiter = table.delimiter.text.trimEnd();
  changes.push({ from: table.delimiter.from + delimiter.length, insert: delimiter.endsWith('|') ? ' --- |' : ' | --- |' });
  view.dispatch({ changes });
  reopenAt(view, tableStart, columns, 0);
}

// A table line's cell boundaries: its unescaped pipes, after any quote or indent prefix. A row written without a
// leading pipe gets a stand-in boundary just before its first cell.
function cellBounds(line: Line): { bounds: number[]; leading: boolean } {
  const prefix = /^[\s>]*/.exec(line.text)?.[0].length ?? 0;
  const body = line.text.slice(prefix);
  const pipes = [...body.matchAll(/(?<!\\)\|/g)].map((match) => line.from + prefix + (match.index ?? 0));
  const leading = body.startsWith('|');
  return { bounds: leading ? pipes : [line.from + prefix - 1, ...pipes], leading };
}

// Obsidian's "Delete row" for a selected body row (the header row has no handle).
function deleteTableRow(view: EditorView, tableStart: number, row: number) {
  const table = tableAt(view.state, tableStart);
  const line = table?.rows[row]?.line;
  if (!line || row === 0) return;
  view.dispatch({ changes: { from: line.from - 1, to: line.to } });
}

// Obsidian's "Delete column": the cell and its leading pipe go from every line; the last column takes the table with it.
function deleteTableColumn(view: EditorView, tableStart: number, column: number) {
  const table = tableAt(view.state, tableStart);
  if (!table) return;
  const first = table.rows[0].line;
  if (table.rows[0].cells.length <= 1) {
    view.dispatch({ changes: { from: first.from, to: table.rows[table.rows.length - 1].line.to } });
    return;
  }
  const changes: ChangeSpec[] = [];
  for (const line of [...table.rows.map((row) => row.line), table.delimiter]) {
    const { bounds, leading } = cellBounds(line);
    const from = bounds[column];
    if (from === undefined) continue;
    const next = bounds[column + 1];
    // A trailing pipe closes the row; nothing after it is a cell.
    if (next === undefined && !line.text.slice(from - line.from + 1).trim()) continue;
    if (column === 0 && !leading) {
      // The next cell becomes the first, so the space after the removed pipe goes too.
      const to = next === undefined ? line.to : next + 1 + (/^ */.exec(line.text.slice(next + 1 - line.from))?.[0].length ?? 0);
      changes.push({ from: from + 1, to });
    } else {
      changes.push({ from, to: next ?? line.to });
    }
  }
  view.dispatch({ changes });
}

// Row and column operations from the handle menu and dragging rewrite the whole table from a cell grid, as Obsidian
// does: every row padded to the header's width, written `| a | b |` under the first line's quote or indent prefix.
type TableModel = { cells: string[][]; aligns: Alignment[] };

function rewriteTable(view: EditorView, tableStart: number, edit: (model: TableModel) => void) {
  const table = tableAt(view.state, tableStart);
  if (!table) return;
  const width = table.rows[0].cells.length;
  const prefix = /^[\s>]*/.exec(table.rows[0].line.text)?.[0] ?? '';
  const delimiterAligns = splitRow(table.delimiter.text.slice(prefix.length)).map(alignmentOf);
  const model: TableModel = {
    cells: table.rows.map((row) => Array.from({ length: width }, (_, i) => row.cells[i]?.text ?? '')),
    aligns: Array.from({ length: width }, (_, i) => delimiterAligns[i] ?? null),
  };
  edit(model);
  const line = (cells: string[]) => `${prefix}| ${cells.join(' | ')} |`;
  const marker = (align: Alignment) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---');
  const [header, ...body] = model.cells;
  const text = [line(header), line(model.aligns.map(marker)), ...body.map(line)].join('\n');
  view.dispatch({ changes: { from: table.rows[0].line.from, to: table.rows[table.rows.length - 1].line.to, insert: text } });
}

function moveItem<T>(items: T[], from: number, to: number) {
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

// Each drawn table registers how to pick a row or column, so an operation can keep the moved one selected after the
// table redraws.
const tableSelectors = new WeakMap<HTMLElement, (kind: 'row' | 'column', index: number) => void>();
function reselect(view: EditorView, tableStart: number, kind: 'row' | 'column', index: number) {
  for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>('.cm-lp-table')) {
    if (view.posAtDOM(wrap) === tableStart) tableSelectors.get(wrap)?.(kind, index);
  }
}

// Same look as the sidebar's context menu (FileNode.tsx).
const MENU_CLASS = 'fixed z-[90] w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-panel bg-[var(--surface-page,#F9F9F7)] p-1 font-ui noa-floating-panel';
const MENU_ITEM_CLASS = 'noa-sidebar-hover-surface flex h-8 w-full items-center rounded-lg px-2.5 text-left text-body text-[var(--text-primary,#2D2D2B)]';
let tableMenu: HTMLElement | null = null;
const closeTableMenu = () => {
  tableMenu?.remove();
  tableMenu = null;
};

// Obsidian's row and column menus (labels from its i18n). `null` draws a separator; `false` is an item that doesn't apply.
type TableMenuItem = [label: string, run: () => void] | null | false;
function tableMenuItems(view: EditorView, tableStart: number, kind: 'row' | 'column', index: number, rows: number, columns: number): TableMenuItem[] {
  const edit = (change: (model: TableModel) => void, after: () => void) => () => {
    rewriteTable(view, tableStart, change);
    after();
  };
  const select = (next: number) => () => reselect(view, tableStart, kind, next);
  const open = (cell: number) => () => reopenAt(view, tableStart, cell, 0);
  const blank = () => Array.from({ length: columns }, () => '');
  if (kind === 'row') {
    return [
      ['Add row above', edit((m) => m.cells.splice(index, 0, blank()), open(index * columns))],
      ['Add row below', edit((m) => m.cells.splice(index + 1, 0, blank()), open((index + 1) * columns))],
      null,
      index > 1 && ['Move row up', edit((m) => moveItem(m.cells, index, index - 1), select(index - 1))],
      index < rows - 1 && ['Move row down', edit((m) => moveItem(m.cells, index, index + 1), select(index + 1))],
      ['Duplicate row', edit((m) => m.cells.splice(index + 1, 0, [...m.cells[index]]), select(index + 1))],
      null,
      // The table redraws without the element that held focus, so focus goes back to the editor.
      ['Delete row', () => { deleteTableRow(view, tableStart, index); view.focus(); }],
    ];
  }
  const sort = (direction: 1 | -1) => edit((m) => {
    const body = m.cells.slice(1).sort((a, b) => direction * a[index].localeCompare(b[index], undefined, { numeric: true }));
    m.cells.splice(1, body.length, ...body);
  }, select(index));
  const align = (value: Alignment) => edit((m) => { m.aligns[index] = value; }, select(index));
  const insert = (at: number) => edit((m) => {
    for (const row of m.cells) row.splice(at, 0, '');
    m.aligns.splice(at, 0, null);
  }, open(at));
  const move = (to: number) => edit((m) => {
    for (const row of m.cells) moveItem(row, index, to);
    moveItem(m.aligns, index, to);
  }, select(to));
  return [
    ['Add column to the left', insert(index)],
    ['Add column to the right', insert(index + 1)],
    null,
    index > 0 && ['Move column left', move(index - 1)],
    index < columns - 1 && ['Move column right', move(index + 1)],
    ['Duplicate column', edit((m) => {
      for (const row of m.cells) row.splice(index + 1, 0, row[index]);
      m.aligns.splice(index + 1, 0, m.aligns[index]);
    }, select(index + 1))],
    null,
    ['Align left', align('left')],
    ['Align center', align('center')],
    ['Align right', align('right')],
    null,
    ['Sort by column (A to Z)', sort(1)],
    ['Sort by column (Z to A)', sort(-1)],
    null,
    ['Delete column', () => { deleteTableColumn(view, tableStart, index); view.focus(); }],
  ];
}

function openTableMenu(anchor: HTMLElement, items: TableMenuItem[]) {
  closeTableMenu();
  const menu = document.createElement('div');
  menu.className = MENU_CLASS;
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === false) continue;
    if (item === null) {
      if (menu.lastElementChild?.tagName === 'BUTTON') menu.insertAdjacentHTML('beforeend', '<div class="mx-1 my-1 h-[0.5px] bg-[var(--divider-subtle)]"></div>');
      continue;
    }
    const [label, run] = item;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = MENU_ITEM_CLASS;
    button.textContent = label;
    // Focus stays on the table, so its Backspace / Delete / Escape keys and its focus-out still apply.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      closeTableMenu();
      // A table redrawn while the menu was open (a vault sync, say) no longer matches the row or column it was opened for.
      if (anchor.isConnected) run();
    });
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  tableMenu = menu;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
}

const svgIcon = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const dots = (points: [number, number][]) => points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1"/>`).join('');
// Lucide plus, grip-vertical and grip-horizontal, as Obsidian uses.
const PLUS_ICON = svgIcon('<path d="M5 12h14"/><path d="M12 5v14"/>');
const ROW_GRIP_ICON = svgIcon(dots([[9, 12], [9, 5], [9, 19], [15, 12], [15, 5], [15, 19]]));
const COLUMN_GRIP_ICON = svgIcon(dots([[12, 9], [19, 9], [5, 9], [12, 15], [19, 15], [5, 15]]));

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
      // A cell that opened has already handled the click, and swapped out the element that was hit, so `closest`
      // would no longer find the cell.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || view.state.readOnly) return;
      if ((event.target as HTMLElement).closest('td, th, .cm-lp-table-btn, .cm-lp-table-handle')) return;
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
    const editable = !view.state.readOnly;
    // A row or column picked with its handle, as in Obsidian; Backspace or Delete removes it, Escape lets go.
    let selected: { kind: 'row' | 'column'; index: number; handle: HTMLElement } | null = null;
    const paintSelection = () => {
      for (const el of Array.from(table.querySelectorAll('.cm-lp-table-handle'))) {
        el.classList.toggle('cm-lp-table-handle-active', el === selected?.handle);
      }
      for (const tr of Array.from(table.rows)) {
        for (const td of Array.from(tr.cells)) {
          const on = selected !== null && (selected.kind === 'row' ? tr.rowIndex === selected.index : td.cellIndex === selected.index);
          td.classList.toggle('cm-lp-table-selected', on);
        }
      }
    };
    const handle = (kind: 'row' | 'column', index: number) => {
      const el = document.createElement('div');
      el.className = `cm-lp-table-handle cm-lp-table-${kind}-handle`;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', kind === 'row' ? 'Select row' : 'Select column');
      el.innerHTML = kind === 'row' ? ROW_GRIP_ICON : COLUMN_GRIP_ICON;
      el.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button !== 0 || view.state.readOnly) return;
        // A pending cell edit commits first; if that redrew the table, this one is gone and the click is spent.
        commitOpenCell();
        if (!wrap.isConnected) return;
        closeTableMenu();
        selected = { kind, index, handle: el };
        paintSelection();
        wrap.focus({ preventScroll: true });
        dragOrMenu(event, kind, index, el);
      });
      return el;
    };
    // Rows (body only) or columns, in table order, to find where a drag is pointing.
    const lanes = (kind: 'row' | 'column') => (kind === 'row' ? Array.from(table.rows).slice(1) : Array.from(table.rows[0]?.cells ?? []));
    const paintDrop = (kind: 'row' | 'column', target: number | null) => {
      for (const tr of Array.from(table.rows)) {
        for (const td of Array.from(tr.cells)) {
          td.classList.toggle('cm-lp-table-drop', target !== null && (kind === 'row' ? tr.rowIndex === target : td.cellIndex === target));
        }
      }
    };
    // As in Obsidian, a handle dragged past a few pixels moves its row or column; a plain click opens its menu.
    const dragOrMenu = (start: MouseEvent, kind: 'row' | 'column', index: number, el: HTMLElement) => {
      let target: number | null = null;
      const move = (event: MouseEvent) => {
        if (target === null && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 4) return;
        const items = lanes(kind);
        const found = items.findIndex((item) => {
          const rect = item.getBoundingClientRect();
          return kind === 'row' ? event.clientY < rect.bottom : event.clientX < rect.right;
        });
        target = (found === -1 ? items.length - 1 : found) + (kind === 'row' ? 1 : 0);
        paintDrop(kind, target);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        paintDrop(kind, null);
        if (!wrap.isConnected) return;
        const tableStart = view.posAtDOM(wrap);
        if (target === null) {
          openTableMenu(el, tableMenuItems(view, tableStart, kind, index, table.rows.length, table.rows[0]?.cells.length ?? 0));
          return;
        }
        if (target === index) return;
        const to = target;
        rewriteTable(view, tableStart, (m) => {
          if (kind === 'row') moveItem(m.cells, index, to);
          else {
            for (const row of m.cells) moveItem(row, index, to);
            moveItem(m.aligns, index, to);
          }
        });
        reselect(view, tableStart, kind, to);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    if (editable) {
      wrap.tabIndex = -1;
      wrap.addEventListener('keydown', (event) => {
        if (!selected || event.target !== wrap) return;
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          closeTableMenu();
          const { kind, index } = selected;
          const tableStart = view.posAtDOM(wrap);
          selected = null;
          if (kind === 'row') deleteTableRow(view, tableStart, index);
          else deleteTableColumn(view, tableStart, index);
          view.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeTableMenu();
          selected = null;
          paintSelection();
          view.focus();
        }
      });
      wrap.addEventListener('focusout', () => {
        closeTableMenu();
        selected = null;
        paintSelection();
      });
      tableSelectors.set(wrap, (kind, index) => {
        const handles = table.querySelectorAll<HTMLElement>(`.cm-lp-table-${kind}-handle`);
        const el = handles[kind === 'row' ? index - 1 : index];
        if (!el) return;
        selected = { kind, index, handle: el };
        paintSelection();
        wrap.focus({ preventScroll: true });
      });
    }
    const [header, ...body] = this.rows;
    const addRow = (parent: HTMLElement, cells: TableCell[], cellTag: 'th' | 'td', rowIndex: number) => {
      const tr = document.createElement('tr');
      cells.forEach((source, i) => {
        const td = document.createElement(cellTag);
        if (this.aligns[i]) td.style.textAlign = this.aligns[i]!;
        const cell = document.createElement('div');
        cell.className = 'cm-lp-cell';
        td.appendChild(cell);
        if (editable && rowIndex === 0) td.appendChild(handle('column', i));
        if (editable && rowIndex > 0 && i === 0) td.appendChild(handle('row', rowIndex));
        appendInline(cell, source.text.replace(/\\\|/g, '|'));
        cellSources.set(cell, source);
        cell.addEventListener('mousedown', (event) => onCellMouseDown(event, view, cell));
        cell.addEventListener('keydown', (event) => onCellKeyDown(event, view, cell));
        cell.addEventListener('input', () => {
          if (openCell?.cell === cell) paintCellMath(cell);
        });
        cell.addEventListener('blur', () => {
          if (openCell?.cell === cell) commitOpenCell();
        });
        tr.appendChild(td);
      });
      parent.appendChild(tr);
    };
    const thead = document.createElement('thead');
    addRow(thead, header ?? [], 'th', 0);
    const tbody = document.createElement('tbody');
    body.forEach((row, i) => addRow(tbody, row, 'td', i + 1));
    table.append(thead, tbody);
    // The add buttons and the handles sit outside the table's edges, in the wrapper's padding; hovering shows them.
    const inner = document.createElement('div');
    inner.className = 'cm-lp-table-inner';
    inner.appendChild(table);
    if (editable) {
      const addButton = (className: string, label: string, add: (view: EditorView, tableStart: number) => void) => {
        const button = document.createElement('div');
        button.className = `cm-lp-table-btn ${className}`;
        button.title = label;
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', label);
        button.innerHTML = PLUS_ICON;
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
          if (event.button !== 0 || view.state.readOnly) return;
          // Read before a pending cell edit commits: the commit redraws the table and detaches this wrapper.
          const tableStart = view.posAtDOM(wrap);
          commitOpenCell();
          add(view, tableStart);
        });
        inner.appendChild(button);
      };
      addButton('cm-lp-table-add-row', 'Add row below', addTableRow);
      addButton('cm-lp-table-add-column', 'Add column to the right', addTableColumn);
    }
    wrap.appendChild(inner);
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
        const table = readTable(doc, node.node);
        const rows: TableCell[][] = table.rows.map((row) => row.cells.map((cell) => ({ text: cell.text, offset: cell.from - start.from })));
        // The delimiter line read whole would carry a quote's "> " into its first cell; the row's own node does not.
        const delimiterNode = node.node.getChild('TableDelimiter');
        const delimiter = delimiterNode ? doc.sliceString(delimiterNode.from, delimiterNode.to) : '';
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
