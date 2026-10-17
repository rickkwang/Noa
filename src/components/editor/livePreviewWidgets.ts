import { EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';

// Inline widgets for Live Preview. Each one replaces source text while the cursor is outside it.

class HorizontalRuleWidget extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-lp-hr';
    editWidgetOnMouseDown(el, view, () => 0);
    return el;
  }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = '•';
    editWidgetOnMouseDown(el, view, () => 0);
    return el;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly pos: number, readonly checked: boolean) { super(); }
  eq(other: CheckboxWidget) { return other.pos === this.pos && other.checked === this.checked; }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = this.checked ? 'cm-lp-checkbox cm-lp-checkbox-checked' : 'cm-lp-checkbox';
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', String(this.checked));
    // mousedown, not click: a click would first move the caret into the hidden markup.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      // Only the space or x inside "[ ]" changes; the rest of the line is untouched.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return el;
  }
}

export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly width?: number) { super(); }
  eq(other: ImageWidget) { return other.src === this.src && other.alt === this.alt && other.width === this.width; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    if (this.width) img.style.width = `${this.width}px`;
    // A broken image falls back to its alt text rather than a broken-image icon.
    img.addEventListener('error', () => {
      wrap.textContent = this.alt || 'image';
    });
    wrap.appendChild(img);
    // Inside the "![" puts the caret in the source, which reveals it, as clicking an embed does in Obsidian.
    editWidgetOnMouseDown(wrap, view, () => 1);
    return wrap;
  }
}

// Resolve the current decoration position at click time, since edits can move a reused widget.
export function editWidgetOnMouseDown(element: HTMLElement, view: EditorView, offset: (event: MouseEvent) => number, widgetDOM = element): void {
  element.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || view.state.readOnly) return;
    event.preventDefault();
    const anchor = view.posAtDOM(widgetDOM) + offset(event);
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
  });
}

export class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) { super(); }
  eq(other: InlineMathWidget) { return other.tex === this.tex; }
  toDOM(view?: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-lp-math';
    // KaTeX escapes its input and marks bad TeX inline instead of throwing.
    el.innerHTML = katex.renderToString(this.tex, { throwOnError: false });
    if (view) editWidgetOnMouseDown(el, view, () => 1);
    return el;
  }
}

export const horizontalRule = new HorizontalRuleWidget();
export const bullet = new BulletWidget();

// Inline formatting inside table cells, which Live Preview renders rather than showing as source.
// `$$…$$` and `<br>` in a cell render as the Reading view draws them: math inline, and a line break.
const CELL_TOKEN = /\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|==(.+?)==|\*(.+?)\*|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(?<![\\$])\$(?![\s$])([^$\n]*?[^\s$\\])\$(?![\d$])|\$\$([^$\n]+?)\$\$|<br\s*\/?>/gi;

const inlineSourceOffsets = new WeakMap<Node, { offset: number; math?: boolean }>();

export function inlineOffsetAtCoords(parent: HTMLElement, event: MouseEvent): number {
  const caret = parent.ownerDocument.caretRangeFromPoint(event.clientX, event.clientY);
  if (!caret || !parent.contains(caret.startContainer)) return 0;
  for (let node: Node | null = caret.startContainer; node && node !== parent; node = node.parentNode) {
    const source = inlineSourceOffsets.get(node);
    if (!source) continue;
    if (source.math) return source.offset;
    const range = parent.ownerDocument.createRange();
    range.selectNodeContents(node);
    range.setEnd(caret.startContainer, caret.startOffset);
    return source.offset + range.toString().length;
  }
  return 0;
}

export function appendInline(parent: HTMLElement, text: string, base = 0): void {
  const appendText = (from: number, to: number) => {
    const node = document.createTextNode(text.slice(from, to));
    inlineSourceOffsets.set(node, { offset: base + from });
    parent.appendChild(node);
  };
  let last = 0;
  for (const match of text.matchAll(CELL_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) appendText(last, index);
    const [token, bold, strike, code, highlight, italic, wikiTarget, wikiAlias, inlineMath, displayMath] = match;
    if (token[0] === '<') {
      parent.appendChild(document.createElement('br'));
      last = index + token.length;
      continue;
    }
    const math = inlineMath ?? displayMath;
    const el = math !== undefined
      ? new InlineMathWidget(math).toDOM()
      : document.createElement(bold ? 'strong' : strike ? 's' : code ? 'code' : highlight ? 'mark' : italic ? 'em' : 'span');
    if (wikiTarget) el.className = 'cm-lp-wikilink';
    const prefix = wikiTarget ? (wikiAlias === undefined ? 2 : wikiTarget.length + 3)
      : bold || strike || highlight || displayMath ? 2 : 1;
    // Emphasis can hold math, links or other emphasis (`**mass $M$**`); code and link text stay literal.
    const nested = bold ?? strike ?? highlight ?? italic;
    if (nested !== undefined) appendInline(el, nested, base + index + prefix);
    else if (math === undefined) el.textContent = code ?? wikiAlias ?? wikiTarget;
    inlineSourceOffsets.set(el, { offset: base + index + prefix, math: math !== undefined });
    parent.appendChild(el);
    last = index + match[0].length;
  }
  if (last < text.length) appendText(last, text.length);
}
