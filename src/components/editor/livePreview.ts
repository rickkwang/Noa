import { syntaxTree } from '@codemirror/language';
import { EditorState, Range, SelectionRange } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { frontmatterEnd } from './hiddenFrontmatter';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

// Obsidian-style Live Preview. The document stays raw Markdown; these decorations only hide markup
// on the lines and spans the selection is not in, so the rendered form is what you see while typing.
// Saves always persist the source, so nothing here can change stored content.

const hideMarkup = Decoration.replace({});
const quoteLine = Decoration.line({ class: 'cm-lp-quote' });
const wikiLinkText = Decoration.mark({ class: 'cm-lp-wikilink' });

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

class CheckboxWidget extends WidgetType {
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

const horizontalRule = new HorizontalRuleWidget();
const bullet = new BulletWidget();

// [[Target]] and [[Target|Alias]]. The lookbehind leaves embeds (![[file]]) as source.
const WIKILINK = /(?<!!)\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);
const INLINE_MARKS: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark',
};
const LINK_MARKUP = ['LinkMark', 'URL', 'LinkTitle'];

function childrenNamed(node: SyntaxNode, names: string[]): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (names.includes(child.name)) out.push(child);
  }
  return out;
}

function isInCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true;
  }
  return false;
}

function build(view: EditorView, bodyStart: number): { decorations: DecorationSet; atomic: DecorationSet } {
  const { state } = view;
  const { doc, selection } = state;
  if (view.visibleRanges.length === 0) return { decorations: Decoration.none, atomic: Decoration.none };
  const from = view.visibleRanges[0].from;
  const to = view.visibleRanges[view.visibleRanges.length - 1].to;

  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const hide = (start: number, end: number) => {
    // A replace decoration may not cross a line break when supplied by a plugin (CodeMirror throws), e.g. a multi-line link title.
    if (end <= start || doc.lineAt(start).number !== doc.lineAt(end).number) return;
    const deco = hideMarkup.range(start, end);
    all.push(deco);
    atomic.push(deco);
  };
  const replaceWith = (start: number, end: number, widget: WidgetType) => {
    const deco = Decoration.replace({ widget }).range(start, end);
    all.push(deco);
    atomic.push(deco);
  };

  // Block markup reveals per line: the line the cursor (or any part of the selection) sits on.
  const touchesLine = (pos: number) => {
    const line = doc.lineAt(pos);
    return selection.ranges.some((r: SelectionRange) => r.from <= line.to && r.to >= line.from);
  };
  // Inline markup reveals only while the cursor is inside the span, so typing past a closing ** hides it again.
  const touchesSpan = (start: number, end: number) =>
    selection.ranges.some((r: SelectionRange) => r.from < end && r.to > start);
  const trailingSpace = (end: number) => (doc.sliceString(end, end + 1) === ' ' ? 1 : 0);

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.from < bodyStart) return;
      const { name } = node;

      if (/^ATXHeading[1-6]$/.test(name)) {
        if (touchesLine(node.from)) return;
        const [mark] = childrenNamed(node.node, ['HeaderMark']);
        if (mark) hide(mark.from, mark.to + trailingSpace(mark.to));
      } else if (name in INLINE_MARKS) {
        if (touchesSpan(node.from, node.to)) return;
        for (const mark of childrenNamed(node.node, [INLINE_MARKS[name]])) hide(mark.from, mark.to);
      } else if (name === 'Link') {
        // Inline links only ([text](url)). Reference and shortcut links keep their source.
        if (childrenNamed(node.node, ['URL']).length === 0 || touchesSpan(node.from, node.to)) return;
        for (const child of childrenNamed(node.node, LINK_MARKUP)) hide(child.from, child.to);
      } else if (name === 'Blockquote') {
        const startLine = doc.lineAt(Math.max(node.from, from)).number;
        const endLine = doc.lineAt(Math.min(node.to, to)).number;
        for (let n = startLine; n <= endLine; n++) all.push(quoteLine.range(doc.line(n).from));
        for (const mark of childrenNamed(node.node, ['QuoteMark'])) {
          if (touchesLine(mark.from)) continue;
          hide(mark.from, mark.to + trailingSpace(mark.to));
        }
      } else if (name === 'ListItem') {
        const [listMark] = childrenNamed(node.node, ['ListMark']);
        if (!listMark || touchesLine(listMark.from)) return;
        const [task] = childrenNamed(node.node, ['Task']);
        const [taskMarker] = task ? childrenNamed(task, ['TaskMarker']) : [];
        const isBullet = /^[-*+]$/.test(doc.sliceString(listMark.from, listMark.to));
        if (taskMarker) {
          // Bullets fold into the checkbox; ordered markers ("1.") stay visible, as in Obsidian.
          const checked = doc.sliceString(taskMarker.from, taskMarker.to) !== '[ ]';
          replaceWith(isBullet ? listMark.from : taskMarker.from, taskMarker.to, new CheckboxWidget(taskMarker.from, checked));
        } else if (isBullet) {
          replaceWith(listMark.from, listMark.to, bullet);
        }
      } else if (name === 'HorizontalRule') {
        if (touchesLine(node.from)) return;
        replaceWith(node.from, node.to, horizontalRule);
      }
    },
  });

  // [[wikilinks]] are plain text to the Markdown parser, so they are matched line by line.
  const firstLine = doc.lineAt(Math.max(from, bodyStart)).number;
  const lastLine = doc.lineAt(to).number;
  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n);
    for (const match of line.text.matchAll(WIKILINK)) {
      const start = line.from + match.index;
      const end = start + match[0].length;
      if (isInCode(state, start)) continue;
      const [, target, alias] = match;
      // The alias form hides "[[Target|" and shows only the alias; the plain form shows the target.
      const textFrom = alias === undefined ? start + 2 : start + 3 + target.length;
      const textTo = end - 2;
      if (!touchesSpan(start, end)) {
        hide(start, textFrom);
        hide(textTo, end);
      }
      all.push(wikiLinkText.range(textFrom, textTo));
    }
  }

  return {
    decorations: Decoration.set(all, true),
    atomic: Decoration.set(atomic, true),
  };
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    // Frontmatter's end depends only on the document, so it is not rescanned on cursor moves.
    bodyStart: number;
    constructor(view: EditorView) {
      this.bodyStart = frontmatterEnd(view.state) ?? 0;
      ({ decorations: this.decorations, atomic: this.atomic } = build(view, this.bodyStart));
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.bodyStart = frontmatterEnd(update.state) ?? 0;
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        ({ decorations: this.decorations, atomic: this.atomic } = build(update.view, this.bodyStart));
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // The cursor skips hidden markup, so arrow keys never stop on characters that are not drawn.
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

export type OpenableLink = { kind: 'wiki'; target: string } | { kind: 'url'; href: string };

// The link under a position, resolved the way the Reading view resolves it: wikilinks by text, inline links by the syntax tree.
export function linkAt(state: EditorState, pos: number): OpenableLink | null {
  const line = state.doc.lineAt(pos);
  for (const match of line.text.matchAll(WIKILINK)) {
    const start = line.from + match.index;
    const end = start + match[0].length;
    if (pos < start || pos > end) continue;
    return isInCode(state, start) ? null : { kind: 'wiki', target: match[1] };
  }
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== 'Link') continue;
    const [url] = childrenNamed(node, ['URL']);
    return url ? { kind: 'url', href: state.doc.sliceString(url.from, url.to) } : null;
  }
  return null;
}

// Cmd (Ctrl off macOS) + click follows a link in place, as in Obsidian; a plain click still places the caret.
export const followLinkOnClick = (getOpen: () => ((link: OpenableLink) => void) | undefined) =>
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (event.button !== 0 || !(isMac ? event.metaKey : event.ctrlKey)) return false;
      const open = getOpen();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (!open || pos === null) return false;
      const link = linkAt(view.state, pos);
      if (!link) return false;
      event.preventDefault();
      open(link);
      return true;
    },
  });
