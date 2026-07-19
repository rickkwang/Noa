import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/mhchem.min.js';
import type { Root, Text, Parent, RootContent } from 'mdast';
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { Components, Options as MarkdownOptions } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import { useAttachments } from '../../hooks/useAttachments';
import { useIsDark } from '../../hooks/useIsDark';
import { splitMarkdownForChunkedPreview } from '../../lib/markdownChunks';
import { buildLinkIndex, getBacklinks, parseMarkdownLinkTarget, resolveLinkTarget, sliceHeadingSection } from '../../lib/noteUtils';
import { Note, Folder, AppSettings } from '../../types';
import { MermaidBlock } from './MermaidBlock';
import { canReusePreviewContextNotes } from './previewMemo';
import { Copy, Check, FileText } from '@/src/lib/icons';

function CodeBlock({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const handleCopy = useCallback(() => {
    const text = preRef.current?.innerText ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, []);
  return (
    <div style={{ position: 'relative' }}>
      {/* Match the editor's fenced-code treatment (.cm-code-line in
          useCodeMirror.ts): coral tint + coral left rule, same in both panes
          of split view. */}
      <pre
        ref={preRef}
        style={{
          background: isDark ? 'rgba(204,125,94,0.06)' : 'rgba(204,125,94,0.09)',
          borderLeft: `2px solid ${isDark ? 'rgba(204,125,94,0.45)' : 'rgba(204,125,94,0.6)'}`,
        }}
      >{children}</pre>
      <button
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          padding: '4px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.55)',
          cursor: 'pointer',
          opacity: 0.6,
          transition: 'opacity 120ms, color 120ms',
          border: 'none',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function ZoomableImage({ src, alt }: { src: string; alt?: string }) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);
  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="max-w-full"
        style={{ display: 'block', cursor: 'zoom-in' }}
        onClick={() => setZoomed(true)}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
      {zoomed && createPortal(
        <div
          onClick={() => setZoomed(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            padding: '2rem',
          }}
        >
          <img src={src} alt={alt} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }} />
        </div>,
        document.body
      )}
    </>
  );
}

const SAFE_HREF_PROTOCOLS = ['http:', 'https:', 'mailto:', 'note-internal:', 'note-attachment:'];

// react-markdown's default urlTransform strips unknown protocols (href/src become
// ''), which silently kills note-internal:// wikilinks and note-attachment://
// embeds before the custom a/img components ever see them. Let our internal
// schemes through untouched; everything else keeps the default sanitization.
const urlTransform = (url: string): string =>
  url.startsWith('note-internal://') || url.startsWith('note-attachment://') || url.startsWith('note-embed://')
    ? url
    : defaultUrlTransform(url);

function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return SAFE_HREF_PROTOCOLS.includes(url.protocol);
  } catch {
    // Relative URLs (no protocol) are safe
    return !href.includes(':');
  }
}

// Remark plugin: ==text== → custom 'mark' mdast node
// Uses a non-greedy split that avoids empty matches and handles consecutive == pairs correctly.
function remarkMark() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!node.value || !node.value.includes('==') || index == null || !parent) return;
      // Match ==...== where content is at least 1 char and does not contain ==
      const parts = node.value.split(/(==[^=]+(?:=[^=]+)*==)/g);
      if (parts.length === 1) return;
      const children = parts
        .filter((part: string) => part !== '')
        .map((part: string): RootContent => {
          if (part.startsWith('==') && part.endsWith('==') && part.length > 4) {
            const inner = part.slice(2, -2);
            // 'mark' is a custom node type — cast through unknown so TS accepts it
            return { type: 'mark', value: inner, data: { hName: 'mark', hChildren: [{ type: 'text', value: inner }] } } as unknown as RootContent;
          }
          return { type: 'text', value: part };
        });
      parent.children.splice(index, 1, ...children);
    });
  };
}

// Renders inline #tags as styled pills. Only #tag at a word boundary (start or
// after whitespace) and starting with a letter/underscore counts — so headings
// (handled before text nodes), `C#`, and `http://x#frag` are not matched. Visits
// only 'text' nodes, so tags inside code/inline-code are left untouched.
function remarkTag() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!node.value || !node.value.includes('#') || index == null || !parent) return;
      const re = /(?<=^|\s)#[A-Za-z_][\w/-]*/g;
      const value = node.value;
      const children: RootContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(value)) !== null) {
        if (m.index > last) children.push({ type: 'text', value: value.slice(last, m.index) });
        const label = m[0];
        children.push({
          type: 'tag',
          value: label,
          data: { hName: 'span', hProperties: { className: 'noa-tag' }, hChildren: [{ type: 'text', value: label }] },
        } as unknown as RootContent);
        last = m.index + label.length;
      }
      if (children.length === 0) return;
      if (last < value.length) children.push({ type: 'text', value: value.slice(last) });
      parent.children.splice(index, 1, ...children);
    });
  };
}

// Module-level so every <Markdown> render (and MarkdownChunk's memo) sees the
// same plugin identities.
const REMARK_PLUGINS: MarkdownOptions['remarkPlugins'] = [remarkGfm, remarkBreaks, remarkMath, remarkEmoji, remarkMark, remarkTag];
const REHYPE_PLUGINS: MarkdownOptions['rehypePlugins'] = [rehypeHighlight, [rehypeKatex, { throwOnError: false, errorColor: '#CC7D5E' }]];

// One chunk of a large note's preview. Memoized so a render pass where the
// chunk text and components are unchanged skips the markdown re-parse, and so
// React's concurrent renderer can yield between chunks instead of parsing the
// whole document in one long task (which froze tab-switch animations).
const MarkdownChunk = React.memo(function MarkdownChunk({ markdown, components }: { markdown: string; components: Components }) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={components}
      urlTransform={urlTransform}
    >
      {markdown}
    </Markdown>
  );
});

// Skips layout/paint for offscreen chunks; the placeholder height only needs
// to be the right order of magnitude for scrollbar stability.
const chunkWrapperStyle = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 600px',
} as React.CSSProperties;

interface BacklinkItem {
  id: string;
  title: string;
  content: string;
}

interface PreviewPaneProps {
  note: Note;
  allNotes: Note[];
  folders?: Folder[];
  settings: AppSettings;
  onNavigateToNoteLegacy: (title: string) => void;
  onNavigateToNoteById: (id: string) => void;
  editorStyle: React.CSSProperties;
  contentMaxWidthStyle: React.CSSProperties;
  objectUrls?: Map<string, string>;
  style?: React.CSSProperties;
  /** PDF export: render as a plain static document — no scroll container, no backlinks. */
  printMode?: boolean;
}

// Callout type config — matches Obsidian's full callout spec
// https://help.obsidian.md/Editing+and+formatting/Callouts
const CALLOUT_TYPES: Record<string, { color: string; darkBg: string; lightBg: string; icon: string; label: string }> = {
  NOTE:      { color: '#5B9BD5', darkBg: '#1E2733', lightBg: '#EFF6FF', icon: 'ℹ',  label: 'Note' },
  INFO:      { color: '#5B9BD5', darkBg: '#1E2733', lightBg: '#EFF6FF', icon: 'ℹ',  label: 'Info' },
  TIP:       { color: '#4CAF8A', darkBg: '#182820', lightBg: '#ECFDF5', icon: '💡', label: 'Tip' },
  HINT:      { color: '#4CAF8A', darkBg: '#182820', lightBg: '#ECFDF5', icon: '💡', label: 'Hint' },
  SUCCESS:   { color: '#4CAF8A', darkBg: '#182820', lightBg: '#ECFDF5', icon: '✅', label: 'Success' },
  CHECK:     { color: '#4CAF8A', darkBg: '#182820', lightBg: '#ECFDF5', icon: '✅', label: 'Check' },
  DONE:      { color: '#4CAF8A', darkBg: '#182820', lightBg: '#ECFDF5', icon: '✅', label: 'Done' },
  WARNING:   { color: '#CC7D5E', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠',  label: 'Warning' },
  WARN:      { color: '#CC7D5E', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠',  label: 'Warning' },
  ATTENTION: { color: '#CC7D5E', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠',  label: 'Attention' },
  IMPORTANT: { color: '#9B7FD4', darkBg: '#221830', lightBg: '#F5F3FF', icon: '❗', label: 'Important' },
  CAUTION:   { color: '#D45555', darkBg: '#2C1515', lightBg: '#FEF2F2', icon: '🔥', label: 'Caution' },
  DANGER:    { color: '#D45555', darkBg: '#2C1515', lightBg: '#FEF2F2', icon: '⚡', label: 'Danger' },
  ERROR:     { color: '#D45555', darkBg: '#2C1515', lightBg: '#FEF2F2', icon: '✖',  label: 'Error' },
  BUG:       { color: '#D45555', darkBg: '#2C1515', lightBg: '#FEF2F2', icon: '🐛', label: 'Bug' },
  EXAMPLE:   { color: '#7C6FCD', darkBg: '#1E1A30', lightBg: '#F5F3FF', icon: '📋', label: 'Example' },
  QUOTE:     { color: '#9E9E9E', darkBg: '#1E1E1E', lightBg: '#F5F5F5', icon: '❝',  label: 'Quote' },
  CITE:      { color: '#9E9E9E', darkBg: '#1E1E1E', lightBg: '#F5F5F5', icon: '❝',  label: 'Cite' },
  QUESTION:  { color: '#EC9A3C', darkBg: '#2A1D0A', lightBg: '#FFF7ED', icon: '❓', label: 'Question' },
  FAQ:       { color: '#EC9A3C', darkBg: '#2A1D0A', lightBg: '#FFF7ED', icon: '❓', label: 'FAQ' },
  HELP:      { color: '#EC9A3C', darkBg: '#2A1D0A', lightBg: '#FFF7ED', icon: '❓', label: 'Help' },
  ABSTRACT:  { color: '#00B4D8', darkBg: '#001A22', lightBg: '#E0F7FA', icon: '📄', label: 'Abstract' },
  SUMMARY:   { color: '#00B4D8', darkBg: '#001A22', lightBg: '#E0F7FA', icon: '📄', label: 'Summary' },
  TLDR:      { color: '#00B4D8', darkBg: '#001A22', lightBg: '#E0F7FA', icon: '📄', label: 'TL;DR' },
  TODO:      { color: '#5B9BD5', darkBg: '#1E2733', lightBg: '#EFF6FF', icon: '☑',  label: 'Todo' },
};

function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('');
  if (React.isValidElement(node)) return extractTextFromNode((node.props as Record<string, React.ReactNode>).children);
  return '';
}

// Matches: [!TYPE], [!TYPE]-, [!TYPE]+, [!TYPE]- Custom Title, [!TYPE]+ Custom Title
const CALLOUT_HEADER_RE = /^\[!([A-Za-z]+)\]([+-]?)\s*(.*)?$/;

function CalloutBlockquote({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const childArray = React.Children.toArray(children);
  // react-markdown emits "\n" whitespace text nodes between a blockquote's block
  // children, so childArray[0] is a newline string, not the header paragraph.
  // Filter those out before locating the header, or callout detection never runs
  // and every callout silently degrades to a plain blockquote.
  const elementChildren = childArray.filter((c) => !(typeof c === 'string' && c.trim() === ''));
  const firstChild = elementChildren[0];

  let calloutType: string | null = null;
  let foldable = false;
  let defaultCollapsed = false;
  let customTitle = '';
  let restOfFirst: React.ReactNode = null;
  const restChildren = elementChildren.slice(1);

  if (React.isValidElement(firstChild)) {
    const firstChildProps = (firstChild as React.ReactElement<{ children?: React.ReactNode }>).props;
    const firstText = extractTextFromNode(firstChildProps.children);
    // remark-breaks renders each soft break as <br> + "\n" text, so for a
    // multi-line callout firstText spans every line of the paragraph. Match
    // the header against the first line only — against the full text,
    // "[!TYPE] Title\n…" never matches ($ cannot cross the newline) and
    // "[!TYPE]\n…" swallows the body line into the title (\s* eats the "\n").
    const match = firstText.split('\n')[0].match(CALLOUT_HEADER_RE);
    if (match) {
      calloutType = match[1].toUpperCase();
      const foldChar = match[2];
      customTitle = match[3]?.trim() ?? '';
      foldable = foldChar === '+' || foldChar === '-';
      defaultCollapsed = foldChar === '-';

      // Strip the whole "[!TYPE]± title" header from the first child — the title
      // is rendered separately in the callout chrome, so none of the matched
      // header line should leak into the body. match[0] is exactly the header
      // line (the regex ran against the first line only). Using its length
      // (rather than indexOf on the title text) is robust even when the title
      // duplicates a substring of the type, e.g. "[!NOTE]+ NOTE".
      const childNodes = React.Children.toArray(firstChildProps.children);
      const prefixLen = match[0].length;
      const stripped = childNodes
        .map((c, i) => {
          if (i === 0 && typeof c === 'string') {
            const rest = c.slice(prefixLen).trimStart();
            return rest || null;
          }
          return c;
        })
        .filter(Boolean);
      // Drop the <br> (and its "\n" text twin) that separated the header line
      // from the body, so the body doesn't open with a blank line.
      while (stripped.length > 0) {
        const head = stripped[0];
        if (React.isValidElement(head) && head.type === 'br') {
          stripped.shift();
          continue;
        }
        if (typeof head === 'string') {
          const trimmed = head.trimStart();
          if (!trimmed) {
            stripped.shift();
            continue;
          }
          if (trimmed !== head) stripped[0] = trimmed;
        }
        break;
      }
      restOfFirst = stripped.length > 0 ? <p>{stripped}</p> : null;
    }
  }

  React.useEffect(() => {
    if (foldable && defaultCollapsed) setIsCollapsed(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const config = calloutType ? CALLOUT_TYPES[calloutType] : null;

  if (!config) {
    return (
      <blockquote style={{ borderLeft: `3px solid ${isDark ? '#F9F9F730' : '#2D2D2B40'}`, paddingLeft: '1rem', margin: '0.5rem 0', opacity: 0.8 }}>
        {children}
      </blockquote>
    );
  }

  const hasBody = restOfFirst || restChildren.length > 0;
  const titleText = customTitle || config.label;

  return (
    <div style={{
      borderLeft: `3px solid ${config.color}`,
      background: isDark ? config.darkBg : config.lightBg,
      borderRadius: '0 4px 4px 0',
      margin: '0.75rem 0',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={foldable ? () => setIsCollapsed(v => !v) : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.55rem 1rem',
          fontWeight: 'bold',
          color: config.color,
          fontSize: '0.85em',
          cursor: foldable ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <span>{config.icon}</span>
        <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{titleText}</span>
        {foldable && (
          <span style={{ fontSize: '0.75em', opacity: 0.7 }}>
            {isCollapsed ? '▶' : '▼'}
          </span>
        )}
      </div>

      {/* Body — hidden when collapsed */}
      {!isCollapsed && hasBody && (
        <div style={{ padding: '0 1rem 0.75rem' }}>
          {restOfFirst && <div style={{ margin: 0 }}>{restOfFirst}</div>}
          {restChildren}
        </div>
      )}
    </div>
  );
}

function getSnippet(content: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(.{0,40})(\\[\\[${escapedTitle}\\]\\])(.{0,40})`, 'i');
  const match = content.match(regex);
  if (match) {
    return (
      <span>
        ...{match[1]}
        <span className="text-[#CC7D5E] font-bold bg-[#CC7D5E]/10 px-1 rounded">{match[2]}</span>
        {match[3]}...
      </span>
    );
  }
  return content.slice(0, 80) + '...';
}

// Note embeds (![[Note]]) render recursively; cap nesting and detect cycles.
const MAX_EMBED_DEPTH = 3;

interface NoteMarkdownBodyProps {
  note: Note;
  allNotes: Note[];
  folders?: Folder[];
  isDark: boolean;
  objectUrls?: Map<string, string>;
  onNavigateToNoteLegacy: (title: string) => void;
  onNavigateToNoteById: (id: string) => void;
  /** Scroll container for in-document anchors; embeds fall back to document. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** Embed nesting depth: 0 for the top-level note. */
  depth: number;
  /** Note ids along the current embed chain (incl. the top-level note). */
  visitedIds: ReadonlySet<string>;
  /** Print rendering: keep chunking but skip content-visibility (Chromium can
   *  omit content-visibility:auto subtrees from the printed page). */
  printMode?: boolean;
}

const NoteMarkdownBody = React.memo(function NoteMarkdownBody({
  note,
  allNotes,
  folders,
  isDark,
  objectUrls,
  onNavigateToNoteLegacy,
  onNavigateToNoteById,
  scrollContainerRef,
  depth,
  visitedIds,
  printMode,
}: NoteMarkdownBodyProps) {
  const componentNotesRef = useRef(allNotes);
  const componentNotes = canReusePreviewContextNotes(componentNotesRef.current, allNotes, note.id)
    ? componentNotesRef.current
    : allNotes;
  useEffect(() => {
    componentNotesRef.current = componentNotes;
  }, [componentNotes]);
  const linkIndex = useMemo(() => buildLinkIndex(componentNotes, folders ?? []), [componentNotes, folders]);

  const previewMarkdown = useMemo(() => {
    const findAttachment = (ref: string) => {
      const exact = (note.attachments ?? []).find((a) => a.filename === ref || a.vaultPath === ref);
      if (exact) return exact;
      const basename = ref.split('/').pop() ?? ref;
      return (note.attachments ?? []).find((a) => a.filename === basename || a.vaultPath === ref);
    };

    // Step 0: strip %%comments%% (Obsidian comments) so they never render. Done at
    // the string level to match Obsidian's pre-parse behavior; the rare case of a
    // literal %% inside a fenced code block is not special-cased.
    const withoutComments = note.content.replace(/%%[\s\S]*?%%/g, '');

    // Steps 1–2 must not touch code: a literal [[x]] inside a fenced block or
    // inline code span is code, not a link. Split on code segments (odd indices
    // after a capturing split) and only rewrite the prose in between.
    const CODE_SEGMENT_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|``[^`]*``|`[^`\n]*`)/g;
    const transformProse = (src: string, transform: (segment: string) => string): string =>
      src.split(CODE_SEGMENT_RE).map((part, i) => (i % 2 === 1 ? part : transform(part))).join('');

    // Step 1: rewrite ![[...]] embeds into safe Markdown image syntax.
    // Resolution order: attachment (note-attachment://id/<id>, existing behavior)
    // → note title (note-embed://id/<id>#anchor, rendered as a transclusion by the
    // img component below) → missing placeholder.
    const withAttachments = transformProse(withoutComments, (seg) => seg.replace(/!\[\[(.*?)\]\]/g, (_, rawTarget) => {
      const raw = String(rawTarget ?? '').trim();
      // Strip alias: ![[Target|alias]] → Target (tolerate table-escaped \|)
      const pipeIdx = raw.indexOf('|');
      const target = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).replace(/\\+$/, '').trim();
      const att = findAttachment(target);
      if (att) return `![${target}](note-attachment://id/${encodeURIComponent(att.id)})`;
      // Note transclusion: ![[Title]] or ![[Title#Heading]]
      const hashIdx = target.indexOf('#');
      const embedTitle = hashIdx >= 0 ? target.slice(0, hashIdx).trim() : target;
      const embedAnchor = hashIdx >= 0 ? target.slice(hashIdx + 1).trim() : '';
      const embedId = resolveLinkTarget(embedTitle, linkIndex, note.folder ?? '');
      if (embedId) {
        return `![${target}](note-embed://id/${embedId}${embedAnchor ? `#${encodeURIComponent(embedAnchor)}` : ''})`;
      }
      return `![${target}](note-attachment://missing)`;
    }));

    // Step 2: rewrite [[title]] and [[title|alias]] wiki-links
    return transformProse(withAttachments, (seg) => seg.replace(/\[\[(.*?)\]\]/g, (_, raw) => {
      const safeRaw = String(raw ?? '').trim();
      const pipeIdx = safeRaw.indexOf('|');
      // Tolerate table-escaped pipes: [[Note\|display]] → target "Note".
      const target = (pipeIdx >= 0 ? safeRaw.slice(0, pipeIdx) : safeRaw).replace(/\\+$/, '').trim();
      const rawDisplay = pipeIdx >= 0 ? safeRaw.slice(pipeIdx + 1).trim() : safeRaw;
      // Escape [ and ] so the display text doesn't break Markdown link syntax
      const displayText = rawDisplay.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      // Split off a heading / block anchor: [[Note#heading]] or [[Note#^blockId]].
      // The anchor is preserved in the href (so a future scroll-to-anchor step can
      // use it) but stripped before resolving the note by title.
      const hashIdx = target.indexOf('#');
      const realTitle = hashIdx >= 0 ? target.slice(0, hashIdx).trim() : target;
      const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1).trim() : '';
      const anchorSuffix = anchor ? `#${encodeURIComponent(anchor)}` : '';
      // Same-note anchor: [[#heading]] points within the current note.
      if (realTitle === '' && anchor) {
        return `[${displayText}](note-internal://id/${note.id}${anchorSuffix})`;
      }
      const targetId = resolveLinkTarget(realTitle, linkIndex, note.folder ?? '');
      if (targetId) {
        // Obsidian-aligned resolution: one target per link (case-insensitive,
        // .md-tolerant, path-aware) — matches the knowledge graph's edges.
        return `[${displayText}](note-internal://id/${targetId}${anchorSuffix})`;
      }
      const legacyAttachment = findAttachment(realTitle);
      if (legacyAttachment) {
        return `![${displayText}](note-attachment://id/${encodeURIComponent(legacyAttachment.id)})`;
      }
      const encoded = encodeURIComponent(realTitle);
      return `[${displayText}](note-internal://title/${encoded}${anchorSuffix})`;
    }));
  }, [note.id, note.folder, note.content, note.attachments, linkIndex]);

  const markdownComponents = useMemo((): Components => {
    return {
      a: ({ href, children, ...props }) => {
        if (href?.startsWith('note-internal://id/')) {
          // Strip any #heading / #^block anchor — note resolution only needs the id.
          const noteId = href.replace('note-internal://id/', '').split('#')[0];
          return (
            <span
              className={`${isDark ? 'text-[#CC7D5E]' : 'text-[#CC7D5E]'} cursor-pointer hover:underline font-bold`}
              onClick={() => onNavigateToNoteById(noteId)}
            >
              {children}
            </span>
          );
        }
        if (href?.startsWith('note-internal://title/')) {
          const encoded = href.replace('note-internal://title/', '').split('#')[0];
          const noteTitle = decodeURIComponent(encoded);
          return (
            <span
              className={`${isDark ? 'text-[#CC7D5E]' : 'text-[#CC7D5E]'} cursor-pointer hover:underline font-bold`}
              onClick={() => onNavigateToNoteLegacy(noteTitle)}
            >
              {children}
            </span>
          );
        }
        // Markdown-style internal link ([text](path/Note.md)) — resolve like
        // Obsidian and navigate in-app instead of letting the browser follow a
        // relative URL that goes nowhere.
        const mdTarget = href ? parseMarkdownLinkTarget(href) : null;
        if (mdTarget) {
          const mdTargetId = resolveLinkTarget(mdTarget, linkIndex, note.folder ?? '');
          if (mdTargetId) {
            return (
              <span
                className="text-[#CC7D5E] cursor-pointer hover:underline font-bold"
                onClick={() => onNavigateToNoteById(mdTargetId)}
              >
                {children}
              </span>
            );
          }
          // Unresolved note link: render inert instead of a dead browser nav.
          return (
            <span style={{ color: isDark ? 'rgba(249,249,247,0.45)' : 'rgba(45,45,43,0.5)' }} title={`Unresolved link: ${mdTarget}`}>
              {children}
            </span>
          );
        }
        // In-document anchor (footnote ref/backref, [text](#heading)) — scroll
        // within the preview instead of opening a new browser tab. The footnote
        // ref/def ids match (fn-N ↔ fnref-N), so a plain anchor scroll resolves
        // both directions; target="_blank" was breaking that.
        if (href?.startsWith('#')) {
          return (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                const id = decodeURIComponent(href.slice(1));
                const root = scrollContainerRef?.current ?? document;
                const el = id ? root.querySelector(`#${CSS.escape(id)}`) : null;
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              {...props}
            >
              {children}
            </a>
          );
        }
        // XSS guard: only allow safe protocols for external links
        if (!isSafeHref(href)) {
          return <span {...props}>{children}</span>;
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => {
        if (src?.startsWith('note-embed://id/')) {
          const rest = src.replace('note-embed://id/', '');
          const hashIdx = rest.indexOf('#');
          const embedNoteId = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
          const embedAnchor = hashIdx >= 0 ? decodeURIComponent(rest.slice(hashIdx + 1)) : undefined;
          return (
            <NoteEmbed
              noteId={embedNoteId}
              anchor={embedAnchor}
              allNotes={componentNotes}
              folders={folders}
              isDark={isDark}
              onNavigateToNoteLegacy={onNavigateToNoteLegacy}
              onNavigateToNoteById={onNavigateToNoteById}
              depth={depth}
              visitedIds={visitedIds}
            />
          );
        }
        if (!src || src === 'note-attachment://missing') {
          return (
            <span className="text-xs italic px-2 py-1" style={{ color: isDark ? 'rgba(249,249,247,0.35)' : 'rgba(45,45,43,0.4)', border: `1px dashed ${isDark ? 'rgba(249,249,247,0.15)' : 'rgba(45,45,43,0.2)'}` }}>
              [{alt ?? 'Attachment not found'}]
            </span>
          );
        }
        if (src?.startsWith('note-attachment://id/')) {
          const attachmentId = decodeURIComponent(src.replace('note-attachment://id/', ''));
          const url = objectUrls?.get(attachmentId) ?? '';
          if (!url) {
            return <span className="text-xs italic" style={{ color: isDark ? 'rgba(249,249,247,0.35)' : 'rgba(45,45,43,0.4)' }}>[Loading attachment...]</span>;
          }
          return <ZoomableImage src={url} alt={alt ?? ''} />;
        }
        return <ZoomableImage src={src} alt={alt} />;
      },
      blockquote: ({ children }) => (
        <CalloutBlockquote isDark={isDark}>{children}</CalloutBlockquote>
      ),

      mark: ({ children }: { children?: React.ReactNode }) => (
        <mark style={{
          backgroundColor: 'rgba(204,125,94,0.25)',
          color: 'inherit',
          borderRadius: '2px',
          padding: '0 2px',
        }}>{children}</mark>
      ),
      hr: () => (
        <hr style={{ border: 'none', borderTop: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, margin: '1.5rem 0' }} />
      ),
      code: ({ className, children }) => {
        const language = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
        const codeText = String(children ?? '').replace(/\n$/, '');
        if (language === 'mermaid') {
          return <MermaidBlock code={codeText} isDark={isDark} />;
        }
        return (
          <code className={className}>{children}</code>
        );
      },
      pre: ({ children }) => {
        // If the pre wraps a mermaid code block, render it directly without the CodeBlock chrome
        const childArray = React.Children.toArray(children);
        const codeChild = childArray.find(
          (c): c is React.ReactElement<{ className?: string }> =>
            React.isValidElement(c) && (c as React.ReactElement<{ className?: string }>).props?.className?.includes('language-mermaid') === true
        );
        if (codeChild) return <>{children}</>;
        return <CodeBlock isDark={isDark}>{children}</CodeBlock>;
      },
      del: ({ children }) => (
        <del style={{ textDecoration: 'line-through', opacity: 0.55 }}>{children}</del>
      ),
      // Footnote reference: [^1] inline superscript
      sup: ({ children, ...props }) => (
        <sup style={{ color: isDark ? '#CC7D5E' : '#CC7D5E', fontSize: '0.75em', fontWeight: 'bold', verticalAlign: 'super' }} {...props}>
          {children}
        </sup>
      ),
      // Footnote definition section at bottom of note
      section: ({ children, ...props }) => {
        const dataFootnotes = (props as Record<string, unknown>)['data-footnotes'];
        if (dataFootnotes) {
          return (
            <section
              style={{
                borderTop: `1px dashed ${isDark ? 'rgba(249,249,247,0.12)' : 'rgba(45,45,43,0.2)'}`,
                marginTop: '2rem',
                paddingTop: '0.75rem',
                fontSize: '0.8em',
                opacity: 0.7,
              }}
              {...props}
            >
              {children}
            </section>
          );
        }
        return <section {...props}>{children}</section>;
      },
      table: ({ children }) => (
        <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' }}>{children}</table>
        </div>
      ),
      thead: ({ children }) => (
        <thead>{children}</thead>
      ),
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => (
        <tr style={{ borderBottom: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}` }}>{children}</tr>
      ),
      th: ({ children }) => (
        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, borderTop: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, borderBottom: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, borderLeft: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, borderRight: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, color: isDark ? '#F9F9F7' : '#2D2D2B', whiteSpace: 'nowrap' }}>{children}</th>
      ),
      td: ({ children }) => (
        <td style={{ padding: '0.45rem 0.75rem', verticalAlign: 'top', borderTop: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, borderLeft: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, borderRight: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}`, color: isDark ? '#F9F9F7' : '#2D2D2B' }}>{children}</td>
      ),
      li: ({ children, className, ...props }) => {
        const isTask = className?.includes('task-list-item');
        if (!isTask) return <li className={className} {...props}>{children}</li>;
        // Extract checked state from the first child input element
        const childArray = React.Children.toArray(children);
        const inputEl = childArray.find(
          (c): c is React.ReactElement<{ checked?: boolean }> =>
            React.isValidElement(c) && (c as React.ReactElement<{ type?: string }>).props?.type === 'checkbox'
        );
        const isChecked = inputEl?.props?.checked ?? false;
        const rest = childArray.filter(c => c !== inputEl);
        return (
          <li className={className} style={{ listStyle: 'none', display: 'flex', alignItems: 'flex-start', gap: '8px', marginLeft: '-1.25rem' }} {...props}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '14px',
                height: '14px',
                minWidth: '14px',
                border: `1.5px solid ${isDark ? 'rgba(249,249,247,0.4)' : 'rgba(45,45,43,0.35)'}`,
                marginTop: '3px',
                backgroundColor: isChecked ? (isDark ? '#CC7D5E' : '#CC7D5E') : 'transparent',
              }}
            >
              {isChecked && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3L3.5 5.5L8 1" stroke={isDark ? '#2D2D2B' : '#F9F9F7'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span style={{ opacity: isChecked ? 0.45 : 1, textDecoration: isChecked ? 'line-through' : 'none' }}>{rest}</span>
          </li>
        );
      },
    };
  }, [isDark, objectUrls, onNavigateToNoteById, onNavigateToNoteLegacy, componentNotes, folders, linkIndex, note.folder, depth, visitedIds, scrollContainerRef]);

  // Chunk only the top-level note: embeds render inside a <span> (see
  // NoteEmbed), where block wrappers would be invalid, and embedded sections
  // are small anyway.
  const chunks = useMemo(
    () => (depth === 0 ? splitMarkdownForChunkedPreview(previewMarkdown) : [previewMarkdown]),
    [depth, previewMarkdown]
  );

  if (chunks.length === 1) {
    return <MarkdownChunk markdown={previewMarkdown} components={markdownComponents} />;
  }
  return (
    <>
      {chunks.map((chunk, i) => (
        <div
          key={i}
          style={printMode ? undefined : chunkWrapperStyle}
          // Replicate the typography plugin's `.prose > :first-child { mt-0 }`,
          // which the wrapper div would otherwise absorb.
          className={i === 0 ? '[&>:first-child]:mt-0' : undefined}
        >
          <MarkdownChunk markdown={chunk} components={markdownComponents} />
        </div>
      ))}
    </>
  );
});

interface NoteEmbedProps {
  noteId: string;
  anchor?: string;
  allNotes: Note[];
  folders?: Folder[];
  isDark: boolean;
  onNavigateToNoteLegacy: (title: string) => void;
  onNavigateToNoteById: (id: string) => void;
  depth: number;
  visitedIds: ReadonlySet<string>;
}

// Renders ![[Note]] / ![[Note#Heading]] as an embedded block. Uses spans with
// display:block because react-markdown mounts it where an <img> would sit
// (inside a <p>), where a <div> would be invalid HTML.
function NoteEmbed({
  noteId,
  anchor,
  allNotes,
  folders,
  isDark,
  onNavigateToNoteLegacy,
  onNavigateToNoteById,
  depth,
  visitedIds,
}: NoteEmbedProps) {
  const target = useMemo(() => allNotes.find((n) => n.id === noteId) ?? null, [allNotes, noteId]);
  const handleNoteUpdate = useCallback(() => {}, []);
  // Loads (and revokes on unmount) object URLs for the embedded note's own attachments.
  const { objectUrls } = useAttachments(target, handleNoteUpdate);

  const embeddedNote = useMemo(() => {
    if (!target) return null;
    if (!anchor || anchor.startsWith('^')) return target; // block refs (^id) fall back to whole note
    const sliced = sliceHeadingSection(target.content, anchor);
    return sliced === null ? target : { ...target, content: sliced };
  }, [target, anchor]);

  const nextVisited = useMemo(() => {
    const next = new Set(visitedIds);
    next.add(noteId);
    return next;
  }, [visitedIds, noteId]);

  const mutedColor = isDark ? 'rgba(249,249,247,0.4)' : 'rgba(45,45,43,0.45)';
  const borderColor = isDark ? 'rgba(249,249,247,0.15)' : 'rgba(45,45,43,0.2)';

  if (!target || !embeddedNote) {
    return (
      <span className="text-xs italic px-2 py-1" style={{ color: mutedColor, border: `1px dashed ${borderColor}` }}>
        [Note not found{anchor ? `: #${anchor}` : ''}]
      </span>
    );
  }

  const blocked = visitedIds.has(noteId)
    ? 'Circular embed'
    : depth >= MAX_EMBED_DEPTH
      ? 'Max embed depth reached'
      : null;

  return (
    <span
      className="noa-note-embed"
      style={{
        display: 'block',
        borderLeft: '2px solid rgba(204,125,94,0.55)',
        background: isDark ? 'rgba(204,125,94,0.05)' : 'rgba(204,125,94,0.07)',
        margin: '0.75rem 0',
        padding: '0.4rem 0.9rem 0.5rem',
      }}
    >
      <span
        onClick={() => onNavigateToNoteById(noteId)}
        className="cursor-pointer hover:underline"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.75em',
          fontWeight: 700,
          color: '#CC7D5E',
          userSelect: 'none',
        }}
        title="Open note"
      >
        <FileText size={12} />
        <span>{target.title || 'Untitled'}{anchor && !anchor.startsWith('^') ? ` › ${anchor}` : ''}</span>
      </span>
      {blocked ? (
        <span className="text-xs italic" style={{ color: mutedColor, display: 'block', marginTop: '0.25rem' }}>
          [{blocked}]
        </span>
      ) : (
        <NoteMarkdownBody
          note={embeddedNote}
          allNotes={allNotes}
          folders={folders}
          isDark={isDark}
          objectUrls={objectUrls}
          onNavigateToNoteLegacy={onNavigateToNoteLegacy}
          onNavigateToNoteById={onNavigateToNoteById}
          depth={depth + 1}
          visitedIds={nextVisited}
        />
      )}
    </span>
  );
}

export const PreviewPane = React.memo(function PreviewPane({
  note,
  allNotes,
  folders,
  settings,
  onNavigateToNoteLegacy,
  onNavigateToNoteById,
  editorStyle,
  contentMaxWidthStyle,
  objectUrls,
  style,
  printMode,
}: PreviewPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark(settings.appearance.theme);

  const backlinks: BacklinkItem[] = useMemo(
    () => getBacklinks(note, allNotes),
    [allNotes, note]
  );

  const visitedIds = useMemo(() => new Set([note.id]), [note.id]);

  return (
    <div
      ref={scrollRef}
      className={printMode ? 'noa-selectable block' : 'noa-selectable flex-1 pt-8 pb-8 pl-8 overflow-y-auto [scrollbar-gutter:stable] flex flex-col bg-[#F9F9F7]/50'}
      style={printMode ? style : {
        paddingRight: '2rem',
        // Preview mode has no toolbar below the tab bar, so scrolled content
        // would butt right against it. Fade the top edge via mask (theme-agnostic
        // — works over any background, unlike a colored gradient overlay).
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 16px)',
        maskImage: 'linear-gradient(to bottom, transparent 0, black 16px)',
        ...style,
      }}
    >
      <div className="flex-1">
        <div
          className={`w-full h-full prose prose-sm max-w-none prose-headings:font-bold prose-a:no-underline hover:prose-a:underline prose-code:px-1 prose-code:rounded-sm prose-pre:rounded-none prose-code:before:content-none prose-code:after:content-none ${
            isDark
              ? 'text-[#F9F9F7] prose-headings:text-[#F9F9F7] prose-p:text-[#F9F9F7] prose-li:text-[#F9F9F7] prose-strong:text-[#F9F9F7] prose-em:text-[#F9F9F7] prose-blockquote:text-[#F9F9F7] prose-ol:text-[#F9F9F7] prose-ul:text-[#F9F9F7] prose-a:text-[#CC7D5E] prose-pre:text-[#F9F9F7] prose-code:text-[#CC7D5E] prose-code:bg-[#CC7D5E]/10 prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:text-[#F9F9F7] prose-hr:border-[#3A3A37] prose-th:text-[#F9F9F7] prose-td:text-[#F9F9F7]'
              : 'text-[#2D2D2B] prose-headings:text-[#2D2D2B] prose-a:text-[#CC7D5E] prose-pre:text-[#2D2D2B] prose-code:text-[#CC7D5E] prose-code:bg-[#CC7D5E]/15 prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:text-[#2D2D2B]'
          }`}
          style={{ ...editorStyle, ...contentMaxWidthStyle }}
        >
          <NoteMarkdownBody
            note={note}
            allNotes={allNotes}
            folders={folders}
            isDark={isDark}
            objectUrls={objectUrls}
            onNavigateToNoteLegacy={onNavigateToNoteLegacy}
            onNavigateToNoteById={onNavigateToNoteById}
            scrollContainerRef={scrollRef}
            depth={0}
            visitedIds={visitedIds}
            printMode={printMode}
          />
        </div>
      </div>

      {!printMode && backlinks.length > 0 && (
        <div className="mt-24 pt-4 font-redaction" style={{ borderTop: `1px dashed ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}` }}>
          <h3 className="text-[10px] mb-3 uppercase tracking-widest flex items-center gap-1.5" style={{ color: isDark ? 'rgba(249,249,247,0.3)' : 'rgba(45,45,43,0.35)' }}>
            <span>{backlinks.length}</span>
            <span>Linked Mentions</span>
          </h3>
          <div className="space-y-1.5">
            {backlinks.map((backlink) => (
              <div
                key={backlink.id}
                className="px-2 py-1.5 cursor-pointer transition-colors group"
                style={{ border: `1px solid ${isDark ? 'rgba(249,249,247,0.5)' : '#2D2D2B'}` }}
                onClick={() => onNavigateToNoteById(backlink.id)}
              >
                <div className="text-xs font-bold transition-colors group-hover:text-[#CC7D5E]" style={{ color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.65)' }}>
                  {backlink.title}
                </div>
                <div className="text-[10px] leading-relaxed break-words mt-0.5" style={{ color: isDark ? 'rgba(249,249,247,0.3)' : 'rgba(45,45,43,0.4)' }}>
                  {getSnippet(backlink.content, note.title)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
