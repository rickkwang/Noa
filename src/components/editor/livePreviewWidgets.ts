import { EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';

// Inline widgets for Live Preview. Each one replaces source text while the cursor is outside it.

class HorizontalRuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-hr';
    return el;
  }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = '•';
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
  toDOM() {
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
    return wrap;
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) { super(); }
  eq(other: InlineMathWidget) { return other.tex === this.tex; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-math';
    // KaTeX escapes its input and marks bad TeX inline instead of throwing.
    el.innerHTML = katex.renderToString(this.tex, { throwOnError: false });
    return el;
  }
}

export const horizontalRule = new HorizontalRuleWidget();
export const bullet = new BulletWidget();

// Inline formatting inside table cells, which Live Preview renders rather than showing as source.
const CELL_TOKEN = /\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|==(.+?)==|\*(.+?)\*|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function appendInline(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const match of text.matchAll(CELL_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parent.appendChild(document.createTextNode(text.slice(last, index)));
    const [, bold, strike, code, highlight, italic, wikiTarget, wikiAlias] = match;
    const el = document.createElement(bold ? 'strong' : strike ? 's' : code ? 'code' : highlight ? 'mark' : italic ? 'em' : 'span');
    if (wikiTarget) el.className = 'cm-lp-wikilink';
    el.textContent = bold ?? strike ?? code ?? highlight ?? italic ?? wikiAlias ?? wikiTarget;
    parent.appendChild(el);
    last = index + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}
