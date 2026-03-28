import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Note, AppSettings } from '../../types';

interface BacklinkItem {
  id: string;
  title: string;
  content: string;
}

interface PreviewPaneProps {
  note: Note;
  allNotes: Note[];
  settings: AppSettings;
  onNavigateToNote: (title: string) => void;
  editorStyle: React.CSSProperties;
  contentMaxWidthStyle: React.CSSProperties;
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
  onNavigateToNote,
  editorStyle,
  contentMaxWidthStyle,
}: PreviewPaneProps) {
  const previewMarkdown = useMemo(
    () =>
      note.content.replace(/\[\[(.*?)\]\]/g, (_, title) => {
        const safeTitle = String(title ?? '').trim();
        const encoded = encodeURIComponent(safeTitle);
        return `[${safeTitle}](note-internal://${encoded})`;
      }),
    [note.content]
  );

  const backlinks: BacklinkItem[] = allNotes.filter(
    (n) => n.links && n.links.includes(note.title) && n.id !== note.id
  );

  return (
    <div className="flex-1 p-8 overflow-y-auto flex flex-col bg-[#EAE8E0]/50">
      <div className="flex-1">
        <div
          className="w-full h-full text-[#2D2D2D] prose prose-sm max-w-none prose-headings:font-bold prose-a:text-[#B89B5E] prose-a:no-underline hover:prose-a:underline prose-pre:bg-[#DCD9CE] prose-pre:text-[#2D2D2D] prose-pre:border prose-pre:border-[#2D2D2D] prose-code:text-[#B89B5E] prose-code:bg-[#DCD9CE]/50 prose-code:px-1 prose-code:rounded-sm"
          style={{ ...editorStyle, ...contentMaxWidthStyle }}
        >
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={{
              a: ({ href, children, ...props }) => {
                if (href?.startsWith('note-internal://')) {
                  const encoded = href.replace('note-internal://', '');
                  const noteTitle = decodeURIComponent(encoded);
                  return (
                    <span
                      className="text-[#B89B5E] cursor-pointer hover:underline font-bold"
                      onClick={() => onNavigateToNote(noteTitle)}
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
            }}
          >
            {previewMarkdown}
          </Markdown>
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
                onClick={() => onNavigateToNote(backlink.title)}
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
