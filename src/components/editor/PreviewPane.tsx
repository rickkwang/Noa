import React, { useMemo, useRef } from 'react';
import { useScrollingClass } from '../../hooks/useScrollingClass';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
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

  const titleToIds = useMemo(() => buildTitleToIdsMap(allNotes), [allNotes]);

  const previewMarkdown = useMemo(() => {
    const renderAttachmentTag = (attId: string, filename: string, mimeType: string) => {
      const safeId = encodeURIComponent(attId);
      const safeFilename = encodeURIComponent(filename);
      const safeMimeType = encodeURIComponent(mimeType);
      return `<attachment-embed data-attachment-id="${safeId}" data-filename="${safeFilename}" data-mime-type="${safeMimeType}"></attachment-embed>`;
    };

    const findAttachment = (ref: string) => {
      const exact = (note.attachments ?? []).find((a) => a.filename === ref || a.vaultPath === ref);
      if (exact) return exact;
      const basename = ref.split('/').pop() ?? ref;
      return (note.attachments ?? []).find((a) => a.filename === basename || a.vaultPath === ref);
    };

    // Step 1: rewrite ![[filename]] attachment embeds into explicit HTML tags
    const withAttachments = note.content.replace(/!\[\[(.*?)\]\]/g, (_, filename) => {
      const safeFilename = String(filename ?? '').trim();
      const att = findAttachment(safeFilename);
      if (!att) return `<span data-attachment-missing="true">${safeFilename}</span>`;
      return renderAttachmentTag(att.id, safeFilename, att.mimeType);
    });

    // Step 2: rewrite [[title]] wiki-links (skip already-rewritten attachment links)
    return withAttachments.replace(/\[\[(.*?)\]\]/g, (_, title) => {
      const safeTitle = String(title ?? '').trim();
      const ids = titleToIds.get(safeTitle);
      if (ids && ids.length === 1) {
        return `[${safeTitle}](note-internal://id/${ids[0]})`;
      }
      const legacyAttachment = findAttachment(safeTitle);
      if (legacyAttachment) {
        return renderAttachmentTag(legacyAttachment.id, safeTitle, legacyAttachment.mimeType);
      }
      const encoded = encodeURIComponent(safeTitle);
      return `[${safeTitle}](note-internal://title/${encoded})`;
    });
  }, [note.content, note.attachments, titleToIds]);

  const backlinks: BacklinkItem[] = useMemo(
    () => allNotes.filter((n) =>
      n.id !== note.id &&
      ((n.linkRefs ?? []).includes(note.id) || (!(n.linkRefs?.length) && n.links && n.links.includes(note.title)))
    ),
    [allNotes, note.id, note.title]
  );

  return (
    <div ref={scrollRef} className="flex-1 pt-8 pb-8 pl-8 overflow-y-auto flex flex-col bg-[#EAE8E0]/50" style={{ paddingRight: '2rem', ...style }}>
      <div className="flex-1">
        <div
          className="w-full h-full text-[#2D2D2D] prose prose-sm max-w-none prose-headings:font-bold prose-a:text-[#B89B5E] prose-a:no-underline hover:prose-a:underline prose-pre:bg-[#DCD9CE] prose-pre:text-[#2D2D2D] prose-pre:border prose-pre:border-[#2D2D2D] prose-code:text-[#B89B5E] prose-code:bg-[#DCD9CE]/50 prose-code:px-1 prose-code:rounded-sm"
          style={{ ...editorStyle, ...contentMaxWidthStyle }}
        >
          {(() => {
            const markdownComponents: any = {
              'attachment-embed': ({ ...props }: any) => {
                const attachmentId = String(props['data-attachment-id'] ?? '');
                const filename = decodeURIComponent(String(props['data-filename'] ?? 'document'));
                const mimeType = decodeURIComponent(String(props['data-mime-type'] ?? ''));
                const attachmentByName = (note.attachments ?? []).find((a) => a.filename === filename || a.vaultPath === filename || a.vaultPath?.endsWith(`/${filename}`));
                const resolvedAttachmentId = attachmentId || attachmentByName?.id || '';
                const resolvedMimeType = mimeType || attachmentByName?.mimeType || '';
                const url = objectUrls?.get(resolvedAttachmentId) ?? '';
                const displayFilename = cleanDisplayFilename(filename);

                if (!resolvedAttachmentId) {
                  return <span className="text-[#2D2D2D]/40 text-xs italic">[Attachment not found]</span>;
                }

                if (!url) {
                  return <span className="text-[#2D2D2D]/40 text-xs italic">[Loading attachment...]</span>;
                }

                return <img src={url} alt={filename} loading="lazy" className="max-w-full" style={{ display: 'block' }} />;
              },
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
              img: ({ src, alt, ...props }: any) => {
                if (!src || src === '#attachment-not-found') {
                  return (
                    <span className="text-[#2D2D2D]/40 text-xs italic border border-dashed border-[#2D2D2D]/20 px-2 py-1">
                      [{alt ?? 'Image not found'}]
                    </span>
                  );
                }
                return (
                  <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="max-w-full"
                    style={{ display: 'block' }}
                    {...props}
                  />
                );
              },
            };

            return (
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex, rehypeRaw]}
            components={markdownComponents}
          >
            {previewMarkdown}
          </Markdown>
            );
          })()}
        </div>
      </div>

      {backlinks.length > 0 && (
        <div className="mt-12 pt-6 border-t border-[#2D2D2D] border-dashed font-redaction">
          <h3 className="text-sm font-bold text-[#2D2D2D]/70 mb-4 uppercase tracking-wider flex items-center">
            <span className="bg-[#DCD9CE] px-2 py-1 mr-2">{backlinks.length}</span>
            Linked Mentions
          </h3>
          <div className="space-y-3">
            {backlinks.map((backlink) => (
              <div
                key={backlink.id}
                className="p-3 bg-[#DCD9CE]/30 border border-[#2D2D2D]/20 hover:border-[#B89B5E] cursor-pointer transition-colors group"
                onClick={() => onNavigateToNoteById(backlink.id)}
              >
                <div className="font-bold text-[#2D2D2D] group-hover:text-[#B89B5E] mb-2 transition-colors">
                  {backlink.title}
                </div>
                <div className="text-xs text-[#2D2D2D]/70 leading-relaxed break-words">
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
