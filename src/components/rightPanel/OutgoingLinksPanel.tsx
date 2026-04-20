import React, { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Note } from '../../types';
import { useOutgoingLinks } from '../../hooks/useOutgoingLinks';

interface OutgoingLinksPanelProps {
  activeNote?: Note;
  notes: Note[];
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
}

function getSnippet(content: string, targetTitle: string): string {
  if (!targetTitle) return '';
  const lines = content.split('\n');
  const escaped = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]`);
  const idx = lines.findIndex(l => re.test(l));
  if (idx === -1) return '';
  return lines.slice(Math.max(0, idx - 1), idx + 2).join('\n').trim();
}

export function OutgoingLinksPanel({ activeNote, notes, onNavigateToNoteById, isDark = false }: OutgoingLinksPanelProps) {
  const { resolved, unresolvedTitles } = useOutgoingLinks(activeNote, notes);

  const snippets = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeNote) return map;
    resolved.forEach(n => map.set(n.id, getSnippet(activeNote.content, n.title)));
    return map;
  }, [activeNote, resolved]);

  const txtMuted = isDark ? 'text-[rgba(232,224,208,0.45)]' : 'text-[#2D2D2D]/50';
  const cardBorder = isDark ? 'border-[rgba(232,224,208,0.25)]' : 'border-[#2D2D2D]';
  const cardBg = isDark ? 'bg-[#1E1E1C] hover:bg-[#2C2C28]' : 'bg-[#DCD9CE]/40 hover:bg-[#DCD9CE]/70';
  const titleColor = isDark ? 'text-[#E8E0D0]' : 'text-[#2D2D2D]';
  const snippetColor = isDark ? 'text-[rgba(232,224,208,0.45)]' : 'text-[#2D2D2D]/60';
  const unresolvedBorder = isDark ? 'border-[rgba(232,224,208,0.12)]' : 'border-[#2D2D2D]/30';
  const unresolvedBg = isDark ? 'bg-transparent' : 'bg-transparent';
  const unresolvedTitleColor = isDark ? 'text-[rgba(232,224,208,0.45)]' : 'text-[#2D2D2D]/50';

  const hasAny = resolved.length > 0 || unresolvedTitles.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 font-redaction">
      {!activeNote ? (
        <div className={`text-center mt-10 text-sm ${txtMuted}`}>Open a note to see outgoing links.</div>
      ) : !hasAny ? (
        <div className={`text-center mt-10 text-sm ${txtMuted}`}>
          No outgoing links from<br /><span className={`font-bold ${isDark ? 'text-[rgba(240,237,230,0.6)]' : 'text-[#2D2D2D]/70'}`}>"{activeNote.title}"</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {resolved.map(note => {
            const snippet = snippets.get(note.id);
            return (
              <div key={note.id} className={`border px-3 py-2.5 transition-colors cursor-pointer ${cardBorder} ${cardBg}`}>
                <button
                  onClick={() => onNavigateToNoteById(note.id)}
                  className={`font-bold text-sm hover:text-[#B89B5E] transition-colors flex items-center space-x-1.5 w-full text-left ${titleColor}`}
                >
                  <ExternalLink size={12} className="shrink-0" />
                  <span className="truncate">{note.title}</span>
                </button>
                {snippet && (
                  <p className={`mt-1.5 text-xs leading-relaxed line-clamp-3 whitespace-pre-wrap break-words ${snippetColor}`}>
                    {snippet}
                  </p>
                )}
              </div>
            );
          })}
          {unresolvedTitles.length > 0 && (
            <div className="pt-2">
              <div className={`text-[10px] uppercase tracking-wider mb-1.5 ${txtMuted}`}>Unresolved</div>
              <div className="space-y-1.5">
                {unresolvedTitles.map(title => (
                  <div key={title} className={`border border-dashed px-3 py-2 text-sm italic ${unresolvedBorder} ${unresolvedBg} ${unresolvedTitleColor}`}>
                    <span className="flex items-center space-x-1.5">
                      <ExternalLink size={12} className="shrink-0 opacity-60" />
                      <span className="truncate">{title}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
