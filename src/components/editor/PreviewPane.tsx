import React, { useMemo, useRef } from 'react';
import { useScrollingClass } from '../../hooks/useScrollingClass';
import { useIsDark } from '../../hooks/useIsDark';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Note, AppSettings } from '../../types';
import { buildTitleToIdsMap } from '../../lib/noteUtils';

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

// Callout type config
const CALLOUT_TYPES: Record<string, { color: string; darkBg: string; lightBg: string; icon: string; label: string }> = {
  NOTE:      { color: '#5B9BD5', darkBg: '#1E2733', lightBg: '#EFF6FF', icon: 'ℹ', label: 'Note' },
  TIP:       { color: '#4CAF8A', darkBg: '#182820', lightBg: '#ECFDF5', icon: '💡', label: 'Tip' },
  WARNING:   { color: '#D97757', darkBg: '#2C1F15', lightBg: '#FFFBEB', icon: '⚠', label: 'Warning' },
  IMPORTANT: { color: '#9B7FD4', darkBg: '#221830', lightBg: '#F5F3FF', icon: '❗', label: 'Important' },
  CAUTION:   { color: '#D45555', darkBg: '#2C1515', lightBg: '#FEF2F2', icon: '🔥', label: 'Caution' },
};

function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('');
  if (React.isValidElement(node)) return extractTextFromNode((node.props as any).children);
  return '';
}

function CalloutBlockquote({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  const childArray = React.Children.toArray(children);
  const firstChild = childArray[0];

  // Extract text from the first <p> element to detect callout type
  let calloutType: string | null = null;
  let restOfFirst: React.ReactNode = firstChild;
  const restChildren = childArray.slice(1);

  if (React.isValidElement(firstChild) && (firstChild.type === 'p' || firstChild.props)) {
    const firstText = extractTextFromNode((firstChild as React.ReactElement<{ children?: React.ReactNode }>).props.children);
    const match = firstText.match(/^\[!([A-Z]+)\]\s*/i);
    if (match) {
      calloutType = match[1].toUpperCase();
      // Strip the [!TYPE] prefix from the first child's text
      const stripped = firstText.replace(/^\[![A-Z]+\]\s*/i, '');
      if (stripped) {
        restOfFirst = <p>{stripped}</p>;
      } else {
        restOfFirst = null;
      }
    }
  }

  const config = calloutType ? CALLOUT_TYPES[calloutType] : null;

  if (!config) {
    // Fallback: plain blockquote
    return (
      <blockquote style={{ borderLeft: `3px solid ${isDark ? '#F5F0EB30' : '#2D2D2D40'}`, paddingLeft: '1rem', margin: '0.5rem 0', opacity: 0.8 }}>
        {children}
      </blockquote>
    );
  }

  return (
    <div style={{
      borderLeft: `3px solid ${config.color}`,
      background: isDark ? config.darkBg : config.lightBg,
      borderRadius: '0 4px 4px 0',
      padding: '0.75rem 1rem',
      margin: '0.75rem 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: restOfFirst || restChildren.length ? '0.4rem' : 0, fontWeight: 'bold', color: config.color, fontSize: '0.85em' }}>
        <span>{config.icon}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{config.label}</span>
      </div>
      {restOfFirst && <div style={{ margin: 0 }}>{restOfFirst}</div>}
      {restChildren}
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

export function PreviewPane({
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
      const displayText = pipeIdx >= 0 ? safeRaw.slice(pipeIdx + 1).trim() : safeRaw;
      const ids = titleToIds.get(realTitle);
      if (ids && ids.length === 1) {
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

  const markdownComponents = useMemo(() => {
    const components: any = {
      a: ({ href, children, ...props }: any) => {
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
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
      img: ({ src, alt }: any) => {
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
          />
        );
      },
      blockquote: ({ children }: any) => (
        <CalloutBlockquote isDark={isDark}>{children}</CalloutBlockquote>
      ),
    };
    return components;
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
          className={`w-full h-full prose prose-sm max-w-none prose-headings:font-bold prose-a:no-underline hover:prose-a:underline prose-code:px-1 prose-code:rounded-sm ${
            isDark
              ? 'text-[#FAF9F5] prose-headings:text-[#FAF9F5] prose-p:text-[#FAF9F5] prose-li:text-[#FAF9F5] prose-strong:text-[#FAF9F5] prose-em:text-[#FAF9F5] prose-blockquote:text-[#FAF9F5] prose-ol:text-[#FAF9F5] prose-ul:text-[#FAF9F5] prose-a:text-[#D97757] prose-pre:bg-[#2A2A2D] prose-pre:text-[#FAF9F5] prose-code:text-[#D97757] prose-code:bg-[#3D3D40]/50 prose-hr:border-[#3D3D40] prose-th:text-[#FAF9F5] prose-td:text-[#FAF9F5]'
              : 'text-[#2D2D2D] prose-headings:text-[#2D2D2D] prose-a:text-[#B89B5E] prose-pre:bg-[#DCD9CE] prose-pre:text-[#2D2D2D] prose-pre:border prose-pre:border-[#2D2D2D] prose-code:text-[#B89B5E] prose-code:bg-[#DCD9CE]/50'
          }`}
          style={{ ...editorStyle, ...contentMaxWidthStyle }}
        >
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={markdownComponents}
          >
            {previewMarkdown}
          </Markdown>
        </div>
      </div>

      {backlinks.length > 0 && (
        <div className="mt-12 pt-6 border-dashed font-redaction" style={{ borderTop: `1px dashed ${isDark ? '#3D3D40' : '#2D2D2D'}` }}>
          <h3 className="text-sm font-bold mb-4 uppercase tracking-wider flex items-center" style={{ color: isDark ? 'rgba(250,249,245,0.45)' : 'rgba(45,45,45,0.7)' }}>
            <span className="px-2 py-1 mr-2" style={{ background: isDark ? '#2A2A2D' : '#DCD9CE' }}>{backlinks.length}</span>
            Linked Mentions
          </h3>
          <div className="space-y-3">
            {backlinks.map((backlink) => (
              <div
                key={backlink.id}
                className="p-3 cursor-pointer transition-colors group"
                style={{ background: isDark ? 'rgba(250,249,245,0.04)' : 'rgba(220,217,206,0.3)', border: `1px solid ${isDark ? '#3D3D40' : 'rgba(45,45,45,0.2)'}` }}
                onClick={() => onNavigateToNoteById(backlink.id)}
              >
                <div className="font-bold mb-2 transition-colors group-hover:text-[#B89B5E]" style={{ color: isDark ? '#FAF9F5' : '#2D2D2D' }}>
                  {backlink.title}
                </div>
                <div className="text-xs leading-relaxed break-words" style={{ color: isDark ? 'rgba(250,249,245,0.50)' : 'rgba(45,45,45,0.7)' }}>
                  {getSnippet(backlink.content, note.title)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
