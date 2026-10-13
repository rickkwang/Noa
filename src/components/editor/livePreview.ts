import { syntaxTree } from '@codemirror/language';
import { EditorState, Range, SelectionRange, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { decodeLinkPath, splitImageSize, TAG_REGEX } from '../../lib/noteUtils';
import { frontmatterEnd } from './hiddenFrontmatter';
import { CheckboxWidget, horizontalRule, ImageWidget, InlineMathWidget, bullet } from './livePreviewWidgets';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

// Obsidian-style Live Preview. The document stays raw Markdown; these decorations only hide markup
// on the lines and spans the selection is not in, so the rendered form is what you see while typing.
// Saves always persist the source, so nothing here can change stored content.

export interface LivePreviewContext {
  isDark: () => boolean;
  /** Object URL for an image reference, or undefined when the reference is not an attachment. */
  resolveImage: (target: string, wiki: boolean) => string | undefined;
}

// Dispatched when something outside the document changes what a widget shows (attachment URLs arriving).
export const livePreviewRefresh = StateEffect.define<null>();

const hideMarkup = Decoration.replace({});
const quoteLine = Decoration.line({ class: 'cm-lp-quote' });
const calloutLine = Decoration.line({ class: 'cm-lp-callout' });
const linkText = Decoration.mark({ class: 'cm-lp-link' });
const wikiLinkText = Decoration.mark({ class: 'cm-lp-wikilink' });
const highlightText = Decoration.mark({ class: 'cm-lp-highlight' });
const tagText = Decoration.mark({ class: 'cm-lp-tag' });
const footnoteText = Decoration.mark({ class: 'cm-lp-footnote' });
const calloutTitle = Decoration.mark({ class: 'cm-lp-callout-title' });

// [[Target]] and [[Target|Alias]]. The lookbehind leaves embeds (![[file]]) to EMBED.
const WIKILINK = /(?<!!)\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
const EMBED = /!\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const HIGHLIGHT = /==([^=\n]+?)==/g;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;
// $x$ with no space just inside the delimiters, and no digit right after the closing $ (so prices stay text).
const INLINE_MATH = /(?<![\\$])\$(?![\s$])([^$\n]*?[^\s$\\])\$(?![\d$])/g;
// Only at the start of a quote line: "> [!note]", not "> see [!note]".
const CALLOUT_MARKER = /(?<=^\s*>\s*)\[![A-Za-z-]+\][+-]?/;
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

const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

// Reference definitions, `[label]: url`. The first definition of a label wins, as in CommonMark.
// Cached per document: the plugin rebuilds on every cursor move, and a document never changes in place.
const definitionsByDoc = new WeakMap<EditorState['doc'], Map<string, string>>();
export function linkDefinitions(doc: EditorState['doc']): Map<string, string> {
  const cached = definitionsByDoc.get(doc);
  if (cached) return cached;
  const defs = new Map<string, string>();
  for (let n = 1; n <= doc.lines; n++) {
    const match = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/.exec(doc.line(n).text);
    if (!match || match[1].startsWith('^')) continue;
    const key = normalizeLabel(match[1]);
    if (!defs.has(key)) defs.set(key, match[2]);
  }
  definitionsByDoc.set(doc, defs);
  return defs;
}

// Markdown `$$` blocks: a `$$` line opens one, the next `$$` line closes it, or a single `$$…$$` line.
// Lines inside code are not math.
export function mathBlocks(state: EditorState, bodyStart: number): { from: number; to: number; tex: string }[] {
  const { doc } = state;
  const blocks: { from: number; to: number; tex: string }[] = [];
  let open: number | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from < bodyStart) continue;
    const text = line.text.trim();
    if (open === null) {
      if (text === '$$' && !isInCode(state, line.from)) {
        open = n;
        continue;
      }
      const single = /^\$\$(.+)\$\$$/.exec(text);
      if (single && !isInCode(state, line.from)) blocks.push({ from: line.from, to: line.to, tex: single[1] });
    } else if (text === '$$') {
      const start = doc.line(open);
      if (line.from - 1 > start.to) {
        blocks.push({ from: start.from, to: line.to, tex: doc.sliceString(start.to + 1, line.from - 1) });
      }
      open = null;
    }
  }
  return blocks;
}

function build(view: EditorView, bodyStart: number, context: LivePreviewContext): { decorations: DecorationSet; atomic: DecorationSet } {
  const { state } = view;
  const { doc, selection } = state;
  if (view.visibleRanges.length === 0) return { decorations: Decoration.none, atomic: Decoration.none };
  const from = view.visibleRanges[0].from;
  const to = view.visibleRanges[view.visibleRanges.length - 1].to;

  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const hide = (start: number, end: number) => {
    if (end <= start) return;
    // A plugin-supplied replace may not cross a line break (CodeMirror throws), so a multi-line range is hidden line by line.
    for (let n = doc.lineAt(start).number; n <= doc.lineAt(end).number; n++) {
      const line = doc.line(n);
      const s = Math.max(start, line.from);
      const e = Math.min(end, line.to);
      if (e <= s) continue;
      const deco = hideMarkup.range(s, e);
      all.push(deco);
      atomic.push(deco);
    }
  };
  // Math and images stay non-atomic: the cursor can step into them, which is how their source is revealed.
  const replaceWith = (start: number, end: number, widget: WidgetType, stepInto = false) => {
    const deco = Decoration.replace({ widget }).range(start, end);
    all.push(deco);
    if (!stepInto) atomic.push(deco);
  };
  const mark = (start: number, end: number, deco: Decoration) => {
    if (end > start) all.push(deco.range(start, end));
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

  const defs = linkDefinitions(doc);
  const mathLines = mathBlocks(state, bodyStart);
  const inMathBlock = (line: { from: number; to: number }) =>
    mathLines.some((block) => line.from >= block.from && line.to <= block.to);
  // A `src` that resolves to something displayable: a web image, or an attachment's object URL.
  const imageSource = (src: string, wiki: boolean) =>
    /^https?:\/\//i.test(src) ? src : context.resolveImage(src, wiki);

  // The label a reference or shortcut link looks up: `[text][label]`, `[label][]`, or `[text]`.
  const referenceLabel = (node: SyntaxNode): string | null => {
    const [labelNode] = childrenNamed(node, ['LinkLabel']);
    if (labelNode) {
      const inner = doc.sliceString(labelNode.from + 1, labelNode.to - 1);
      if (inner.trim()) return normalizeLabel(inner);
    }
    const [open, close] = childrenNamed(node, ['LinkMark']);
    return open && close ? normalizeLabel(doc.sliceString(open.to, close.from)) : null;
  };

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
        for (const markNode of childrenNamed(node.node, [INLINE_MARKS[name]])) hide(markNode.from, markNode.to);
      } else if (name === 'Link') {
        if (childrenNamed(node.node, ['URL']).length > 0) {
          // Inline link: [text](url). Its label is styled by the highlight style; the syntax is hidden off the cursor.
          if (touchesSpan(node.from, node.to)) return;
          for (const child of childrenNamed(node.node, LINK_MARKUP)) hide(child.from, child.to);
          return;
        }
        // Reference or shortcut link: a link only when its label has a definition. Footnote refs are handled below.
        const label = referenceLabel(node.node);
        if (!label || !defs.has(label)) return;
        mark(node.from, node.to, linkText);
        if (touchesSpan(node.from, node.to)) return;
        for (const child of childrenNamed(node.node, ['LinkMark', 'LinkLabel'])) hide(child.from, child.to);
      } else if (name === 'Autolink') {
        // <https://example.com>: the angle brackets hide off the cursor.
        mark(node.from, node.to, linkText);
        if (touchesSpan(node.from, node.to)) return;
        for (const child of childrenNamed(node.node, ['LinkMark'])) hide(child.from, child.to);
      } else if (name === 'URL') {
        // A bare URL is a link too; URLs inside a link, image or autolink belong to that node.
        const parent = node.node.parent?.name;
        if (parent !== 'Link' && parent !== 'Image' && parent !== 'Autolink') mark(node.from, node.to, linkText);
      } else if (name === 'Image') {
        const [url] = childrenNamed(node.node, ['URL']);
        // An image split across lines stays as source: a plugin replace may not cover a line break.
        if (!url || touchesSpan(node.from, node.to) || doc.lineAt(node.from).number !== doc.lineAt(node.to).number) return;
        const [open, close] = childrenNamed(node.node, ['LinkMark']);
        const alt = open && close ? doc.sliceString(open.to, close.from) : '';
        // Same destination handling as the Reading view: angle brackets dropped, percent escapes decoded for local files.
        const raw = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
        const src = imageSource(/^https?:\/\//i.test(raw) ? raw : decodeLinkPath(raw), false);
        if (src) replaceWith(node.from, node.to, new ImageWidget(src, alt), true);
      } else if (name === 'Blockquote') {
        const startLine = doc.lineAt(Math.max(node.from, from)).number;
        const endLine = doc.lineAt(Math.min(node.to, to)).number;
        const first = doc.lineAt(node.from);
        const callout = CALLOUT_MARKER.exec(first.text);
        for (let n = startLine; n <= endLine; n++) {
          all.push((callout ? calloutLine : quoteLine).range(doc.line(n).from));
        }
        if (callout && callout.index !== undefined) {
          const markerFrom = first.from + callout.index;
          const markerTo = markerFrom + callout[0].length;
          if (!touchesLine(first.from)) hide(markerFrom, markerTo + trailingSpace(markerTo));
          const titleFrom = markerTo + trailingSpace(markerTo);
          mark(Math.min(titleFrom, first.to), first.to, calloutTitle);
        }
      } else if (name === 'QuoteMark') {
        // Lazy continuation lines keep their ">" inside the paragraph, not directly under the blockquote.
        if (touchesLine(node.from)) return;
        hide(node.from, node.to + trailingSpace(node.to));
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

  // Plain-text syntax the GFM parser does not produce (wikilinks, embeds, highlights, tags, footnotes, math) is matched line by line.
  const firstLine = doc.lineAt(Math.max(from, bodyStart)).number;
  const lastLine = doc.lineAt(to).number;
  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n);
    if (inMathBlock(line)) continue;

    for (const match of line.text.matchAll(WIKILINK)) {
      const start = line.from + (match.index ?? 0);
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

    for (const match of line.text.matchAll(EMBED)) {
      const start = line.from + (match.index ?? 0);
      const end = start + match[0].length;
      if (isInCode(state, start) || touchesSpan(start, end)) continue;
      const [, target, size] = match;
      if (!IMAGE_FILE.test(target)) continue;
      const src = imageSource(target, true);
      if (!src) continue;
      const { width } = splitImageSize(size ?? '');
      replaceWith(start, end, new ImageWidget(src, target, width), true);
    }

    for (const match of line.text.matchAll(HIGHLIGHT)) {
      const start = line.from + (match.index ?? 0);
      const end = start + match[0].length;
      if (isInCode(state, start)) continue;
      mark(start + 2, end - 2, highlightText);
      if (!touchesSpan(start, end)) {
        hide(start, start + 2);
        hide(end - 2, end);
      }
    }

    for (const match of line.text.matchAll(FOOTNOTE_REF)) {
      const start = line.from + (match.index ?? 0);
      const end = start + match[0].length;
      if (isInCode(state, start)) continue;
      mark(start + 2, end - 1, footnoteText);
      if (!touchesSpan(start, end)) {
        hide(start, start + 2);
        hide(end - 1, end);
      }
    }

    for (const match of line.text.matchAll(TAG_REGEX)) {
      const start = line.from + (match.index ?? 0);
      if (isInCode(state, start)) continue;
      mark(start, start + match[0].length, tagText);
    }

    for (const match of line.text.matchAll(INLINE_MATH)) {
      const start = line.from + (match.index ?? 0);
      const end = start + match[0].length;
      if (isInCode(state, start) || touchesSpan(start, end)) continue;
      replaceWith(start, end, new InlineMathWidget(match[1]), true);
    }
  }

  return {
    decorations: Decoration.set(all, true),
    atomic: Decoration.set(atomic, true),
  };
}

export const livePreview = (getContext: () => LivePreviewContext) => ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    // Frontmatter's end depends only on the document, so it is not rescanned on cursor moves.
    bodyStart: number;
    constructor(view: EditorView) {
      this.bodyStart = frontmatterEnd(view.state) ?? 0;
      ({ decorations: this.decorations, atomic: this.atomic } = build(view, this.bodyStart, getContext()));
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.bodyStart = frontmatterEnd(update.state) ?? 0;
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(livePreviewRefresh)));
      if (update.docChanged || update.viewportChanged || update.selectionSet || refresh) {
        ({ decorations: this.decorations, atomic: this.atomic } = build(update.view, this.bodyStart, getContext()));
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // The cursor skips hidden markup, so arrow keys never stop on characters that are not drawn.
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

export type OpenableLink =
  | { kind: 'wiki'; target: string }
  | { kind: 'url'; href: string }
  | { kind: 'anchor'; anchor: string };

// The link under a position, resolved the way the Reading view resolves it: wikilinks by text, inline and
// reference links by the syntax tree and their definitions, bare URLs and autolinks by their text.
export function linkAt(state: EditorState, pos: number): OpenableLink | null {
  const line = state.doc.lineAt(pos);
  for (const match of line.text.matchAll(WIKILINK)) {
    const start = line.from + (match.index ?? 0);
    const end = start + match[0].length;
    if (pos < start || pos > end) continue;
    if (isInCode(state, start)) return null;
    const target = match[1];
    return target.startsWith('#') ? { kind: 'anchor', anchor: target.slice(1).trim() } : { kind: 'wiki', target };
  }
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'URL' && node.parent?.name !== 'Link' && node.parent?.name !== 'Image') {
      return hrefLink(state.doc.sliceString(node.from, node.to));
    }
    if (node.name === 'Link') {
      const [url] = childrenNamed(node, ['URL']);
      if (url) return hrefLink(state.doc.sliceString(url.from, url.to));
      const [labelNode] = childrenNamed(node, ['LinkLabel']);
      const inner = labelNode ? state.doc.sliceString(labelNode.from + 1, labelNode.to - 1) : '';
      const label = inner.trim() ? normalizeLabel(inner) : normalizeLabel(state.doc.sliceString(node.from + 1, node.to - 1).replace(/\[[^\]]*\]$/, ''));
      const href = linkDefinitions(state.doc).get(label);
      return href ? hrefLink(href) : null;
    }
    if (node.name === 'Autolink') {
      const [url] = childrenNamed(node, ['URL']);
      return url ? hrefLink(state.doc.sliceString(url.from, url.to)) : null;
    }
  }
  return null;
}

function hrefLink(href: string): OpenableLink {
  if (!href.startsWith('#')) return { kind: 'url', href };
  let anchor = href.slice(1);
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    // A malformed escape is kept as written.
  }
  return { kind: 'anchor', anchor };
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
