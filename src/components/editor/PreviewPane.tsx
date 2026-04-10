import React, { useMemo, useRef } from 'react';
import { useScrollingClass } from '../../hooks/useScrollingClass';
import { useIsDark } from '../../hooks/useIsDark';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { visit } from 'unist-util-visit';
import type { Root, Text, Parent, RootContent } from 'mdast';
import { Note, AppSettings } from '../../types';
import { buildTitleToIdsMap } from '../../lib/noteUtils';
import { MermaidBlock } from './MermaidBlock';

const SAFE_HREF_PROTOCOLS = ['http:', 'https:', 'mailto:', 'note-internal:', 'note-attachment:'];

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

interface BacklinkItem {
  id: string;
  title: string;
  content: string;
}

interface PreviewPaneProps {
  note: Note;
  allNotes: Note[];
  settings: AppSettings;
  onNavigateToNoteLegacy: (title: string) => void;
  onNavigateToNoteById: (id: string) => void;
  editorStyle: React.CSSProperties;
  contentMaxWidthStyle: React.CSSProperties;
  objectUrls?: Map<string, string>;
  style?: React.CSSProperties;
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
  WARNING:   { color: '#D97757', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠',  label: 'Warning' },
  WARN:      { color: '#D97757', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠',  label: 'Warning' },
  ATTENTION: { color: '#D97757', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠',  label: 'Attention' },
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
  const firstChild = childArray[0];

  let calloutType: string | null = null;
  let foldable = false;
  let defaultCollapsed = false;
  let customTitle = '';
  let restOfFirst: React.ReactNode = null;
  const restChildren = childArray.slice(1);

  if (React.isValidElement(firstChild)) {
    const firstChildProps = (firstChild as React.ReactElement<{ children?: React.ReactNode }>).props;
    const firstText = extractTextFromNode(firstChildProps.children);
    const match = firstText.match(CALLOUT_HEADER_RE);
    if (match) {
      calloutType = match[1].toUpperCase();
      const foldChar = match[2];
      customTitle = match[3]?.trim() ?? '';
      foldable = foldChar === '+' || foldChar === '-';
      defaultCollapsed = foldChar === '-';

      // Strip [!TYPE]± prefix from first child's children
      const childNodes = React.Children.toArray(firstChildProps.children);
      const prefix = firstText.slice(0, firstText.indexOf(customTitle || foldChar || ']') + (customTitle ? customTitle.length : 1));
      const stripped = childNodes
        .map((c, i) => {
          if (i === 0 && typeof c === 'string') {
            const rest = c.slice(prefix.length).trimStart();
            return rest || null;
          }
          return c;
        })
        .filter(Boolean);
      restOfFirst = stripped.length > 0 ? <p>{stripped}</p> : null;
    }
  }

  // initialise collapsed state from syntax only once
  const initialisedRef = React.useRef(false);
  if (!initialisedRef.current && foldable && defaultCollapsed) {
    initialisedRef.current = true;
    // synchronously set without triggering re-render loop
  }
  React.useEffect(() => {
    if (foldable && defaultCollapsed) setIsCollapsed(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const config = calloutType ? CALLOUT_TYPES[calloutType] : null;

  if (!config) {
    return (
      <blockquote style={{ borderLeft: `3px solid ${isDark ? '#F5F0EB30' : '#2D2D2D40'}`, paddingLeft: '1rem', margin: '0.5rem 0', opacity: 0.8 }}>
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

function cleanDisplayFilename(filename: string): string {
  return filename.replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
}

function getSnippet(content: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(.{0,40})(\\[\\[${escapedTitle}\\]\\])(.{0,40})`, 'i');
  const match = content.match(regex);
  if (match) {
    return (
      <span>
        ...{match[1]}
        <span className="text-[#B89B5E] font-bold bg-[#B89B5E]/10 px-1 rounded">{match[2]}</span>
        {match[3]}...
      </span>
    );
  }
  return content.slice(0, 80) + '...';
}

export const PreviewPane = React.memo(function PreviewPane({
  note,
  allNotes,
  settings,
  onNavigateToNoteLegacy,
  onNavigateToNoteById,
  editorStyle,
  contentMaxWidthStyle,
  objectUrls,
  style,
}: PreviewPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollingClass(scrollRef);
  const isDark = useIsDark(settings.appearance.theme);

  const titleToIds = useMemo(() => buildTitleToIdsMap(allNotes), [allNotes]);

  const previewMarkdown = useMemo(() => {
    const findAttachment = (ref: string) => {
      const exact = (note.attachments ?? []).find((a) => a.filename === ref || a.vaultPath === ref);
      if (exact) return exact;
      const basename = ref.split('/').pop() ?? ref;
      return (note.attachments ?? []).find((a) => a.filename === basename || a.vaultPath === ref);
    };

    // Step 1: rewrite ![[filename]] attachment embeds into safe Markdown image syntax
    // Uses note-attachment://id/<id> scheme — intercepted by the img component below.
    // Missing attachments use note-attachment://missing to render a placeholder.
    const withAttachments = note.content.replace(/!\[\[(.*?)\]\]/g, (_, filename) => {
      const safeFilename = String(filename ?? '').trim();
      const att = findAttachment(safeFilename);
      if (!att) return `![${safeFilename}](note-attachment://missing)`;
      return `![${safeFilename}](note-attachment://id/${encodeURIComponent(att.id)})`;
    });

    // Step 2: rewrite [[title]] and [[title|alias]] wiki-links
    return withAttachments.replace(/\[\[(.*?)\]\]/g, (_, raw) => {
      const safeRaw = String(raw ?? '').trim();
      const pipeIdx = safeRaw.indexOf('|');
      const realTitle = pipeIdx >= 0 ? safeRaw.slice(0, pipeIdx).trim() : safeRaw;
      const rawDisplay = pipeIdx >= 0 ? safeRaw.slice(pipeIdx + 1).trim() : safeRaw;
      // Escape [ and ] so the display text doesn't break Markdown link syntax
      const displayText = rawDisplay.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      const ids = titleToIds.get(realTitle);
      if (ids && ids.length > 0) {
        // When multiple notes share the same title, link to the first one.
        // All of them will appear in the knowledge graph because computeLinkRefs
        // now includes all matching IDs.
        return `[${displayText}](note-internal://id/${ids[0]})`;
      }
      const legacyAttachment = findAttachment(realTitle);
      if (legacyAttachment) {
        return `![${displayText}](note-attachment://id/${encodeURIComponent(legacyAttachment.id)})`;
      }
      const encoded = encodeURIComponent(realTitle);
      return `[${displayText}](note-internal://title/${encoded})`;
    });
  }, [note.content, note.attachments, titleToIds]);

  const markdownComponents = useMemo((): Components => {
    return {
      a: ({ href, children, ...props }) => {
        if (href?.startsWith('note-internal://id/')) {
          const noteId = href.replace('note-internal://id/', '');
          return (
            <span
              className="text-[#B89B5E] cursor-pointer hover:underline font-bold"
              onClick={() => onNavigateToNoteById(noteId)}
            >
              {children}
            </span>
          );
        }
        if (href?.startsWith('note-internal://title/')) {
          const encoded = href.replace('note-internal://title/', '');
          const noteTitle = decodeURIComponent(encoded);
          return (
            <span
              className="text-[#B89B5E] cursor-pointer hover:underline font-bold"
              onClick={() => onNavigateToNoteLegacy(noteTitle)}
            >
              {children}
            </span>
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
        if (!src || src === 'note-attachment://missing') {
          return (
            <span className="text-xs italic px-2 py-1" style={{ color: isDark ? 'rgba(245,240,235,0.35)' : 'rgba(45,45,45,0.4)', border: `1px dashed ${isDark ? 'rgba(245,240,235,0.15)' : 'rgba(45,45,45,0.2)'}` }}>
              [{alt ?? 'Attachment not found'}]
            </span>
          );
        }
        if (src?.startsWith('note-attachment://id/')) {
          const attachmentId = decodeURIComponent(src.replace('note-attachment://id/', ''));
          const url = objectUrls?.get(attachmentId) ?? '';
          if (!url) {
            return <span className="text-xs italic" style={{ color: isDark ? 'rgba(245,240,235,0.35)' : 'rgba(45,45,45,0.4)' }}>[Loading attachment...]</span>;
          }
          return <img src={url} alt={alt ?? ''} loading="lazy" className="max-w-full" style={{ display: 'block' }} />;
        }
        return (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="max-w-full"
            style={{ display: 'block' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        );
      },
      blockquote: ({ children }) => (
        <CalloutBlockquote isDark={isDark}>{children}</CalloutBlockquote>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mark: ({ children }: { children: React.ReactNode }) => (
        <mark style={{
          backgroundColor: isDark ? 'rgba(217,119,87,0.25)' : 'rgba(184,155,94,0.25)',
          color: 'inherit',
          borderRadius: '2px',
          padding: '0 2px',
        }}>{children}</mark>
      ),
      hr: () => (
        <hr style={{ border: 'none', borderTop: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, margin: '1.5rem 0' }} />
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
      del: ({ children }) => (
        <del style={{ textDecoration: 'line-through', opacity: 0.55 }}>{children}</del>
      ),
      // Footnote reference: [^1] inline superscript
      sup: ({ children, ...props }) => (
        <sup style={{ color: isDark ? '#D97757' : '#B89B5E', fontSize: '0.75em', fontWeight: 'bold' }} {...props}>
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
                borderTop: `1px dashed ${isDark ? 'rgba(240,237,230,0.15)' : 'rgba(45,45,45,0.2)'}`,
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
        <tr style={{ borderBottom: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}` }}>{children}</tr>
      ),
      th: ({ children }) => (
        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, borderTop: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, borderBottom: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, borderLeft: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, borderRight: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, color: isDark ? '#F0EDE6' : '#2D2D2D', whiteSpace: 'nowrap' }}>{children}</th>
      ),
      td: ({ children }) => (
        <td style={{ padding: '0.45rem 0.75rem', verticalAlign: 'top', borderTop: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, borderLeft: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, borderRight: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}`, color: isDark ? 'rgba(240,237,230,0.85)' : '#2D2D2D' }}>{children}</td>
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
                border: `1.5px solid ${isDark ? 'rgba(240,237,230,0.4)' : 'rgba(45,45,45,0.35)'}`,
                marginTop: '3px',
                backgroundColor: isChecked ? (isDark ? '#D97757' : '#B89B5E') : 'transparent',
              }}
            >
              {isChecked && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3L3.5 5.5L8 1" stroke={isDark ? '#262624' : '#EAE8E0'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span style={{ opacity: isChecked ? 0.45 : 1, textDecoration: isChecked ? 'line-through' : 'none' }}>{rest}</span>
          </li>
        );
      },
    };
  }, [isDark, objectUrls, onNavigateToNoteById, onNavigateToNoteLegacy]);

  const backlinks: BacklinkItem[] = useMemo(
    () => allNotes.filter((n) =>
      n.id !== note.id &&
      ((n.linkRefs ?? []).includes(note.id) || (n.links ?? []).includes(note.title))
    ),
    [allNotes, note.id, note.title]
  );

  return (
    <div ref={scrollRef} className="flex-1 pt-8 pb-8 pl-8 overflow-y-auto flex flex-col bg-[#EAE8E0]/50" style={{ paddingRight: '2rem', ...style }}>
      <div className="flex-1">
        <div
          className={`w-full h-full prose prose-sm max-w-none prose-headings:font-bold prose-a:no-underline hover:prose-a:underline prose-code:px-1 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none ${
            isDark
              ? 'text-[#F0EDE6] prose-headings:text-[#F0EDE6] prose-p:text-[#F0EDE6] prose-li:text-[#F0EDE6] prose-strong:text-[#F0EDE6] prose-em:text-[#F0EDE6] prose-blockquote:text-[#F0EDE6] prose-ol:text-[#F0EDE6] prose-ul:text-[#F0EDE6] prose-a:text-[#D97757] prose-pre:bg-[#1E1E1C] prose-pre:text-[#F0EDE6] prose-code:text-[#D97757] prose-code:bg-[#3A3A37]/50 prose-hr:border-[#3A3A37] prose-th:text-[#F0EDE6] prose-td:text-[#F0EDE6]'
              : 'text-[#2D2D2D] prose-headings:text-[#2D2D2D] prose-a:text-[#B89B5E] prose-pre:bg-[#DCD9CE] prose-pre:text-[#2D2D2D] prose-pre:border prose-pre:border-[#2D2D2D] prose-code:text-[#B89B5E] prose-code:bg-[#DCD9CE]/50'
          }`}
          style={{ ...editorStyle, ...contentMaxWidthStyle }}
        >
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath, remarkMark]}
            rehypePlugins={[rehypeHighlight, [rehypeKatex, { throwOnError: false, errorColor: '#D97757' }]]}
            components={markdownComponents}
          >
            {previewMarkdown}
          </Markdown>
        </div>
      </div>

      {backlinks.length > 0 && (
        <div className="mt-24 pt-4 font-redaction" style={{ borderTop: `1px dashed ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}` }}>
          <h3 className="text-[10px] mb-3 uppercase tracking-widest flex items-center gap-1.5" style={{ color: isDark ? 'rgba(240,237,230,0.3)' : 'rgba(45,45,45,0.35)' }}>
            <span>{backlinks.length}</span>
            <span>Linked Mentions</span>
          </h3>
          <div className="space-y-1.5">
            {backlinks.map((backlink) => (
              <div
                key={backlink.id}
                className="px-2 py-1.5 cursor-pointer transition-colors group"
                style={{ border: `1px solid ${isDark ? 'rgba(240,237,230,0.5)' : '#2D2D2D'}` }}
                onClick={() => onNavigateToNoteById(backlink.id)}
              >
                <div className="text-xs font-bold transition-colors group-hover:text-[#B89B5E]" style={{ color: isDark ? 'rgba(240,237,230,0.55)' : 'rgba(45,45,45,0.65)' }}>
                  {backlink.title}
                </div>
                <div className="text-[10px] leading-relaxed break-words mt-0.5" style={{ color: isDark ? 'rgba(240,237,230,0.3)' : 'rgba(45,45,45,0.4)' }}>
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
