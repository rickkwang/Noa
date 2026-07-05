import React, { useMemo } from 'react';
import { ExternalLink } from '@/src/lib/icons';
import { Note } from '../../types';
import { getBacklinks } from '../../lib/noteUtils';

interface BacklinksPanelProps {
  activeNote?: Note;
  notes: Note[];
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
}

function getSnippet(note: Note, targetTitle: string): string {
  if (!targetTitle) return '';
  const lines = note.content.split('\n');
  const escaped = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]`);
  const idx = lines.findIndex(l => re.test(l));
  if (idx === -1) return '';
  return lines.slice(Math.max(0, idx - 1), idx + 2).join('\n').trim();
}

export function BacklinksPanel({ activeNote, notes, onNavigateToNoteById, isDark = false }: BacklinksPanelProps) {
  const backlinks = useMemo(() => getBacklinks(activeNote, notes), [activeNote, notes]);

  const backlinkSnippets = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeNote) return map;
    backlinks.forEach(note => map.set(note.id, getSnippet(note, activeNote.title)));
    return map;
  }, [activeNote, backlinks]);

  const txtMuted = isDark ? 'text-[rgba(238,237,234,0.45)]' : 'text-[#2D2D2D]/50';
  const cardBorder = isDark ? 'border-[rgba(238,237,234,0.25)]' : 'border-[#2D2D2D]';
  const cardBg = isDark ? 'bg-[#1E1E1C] hover:bg-[#2C2C28]' : 'bg-[#DCD9CE]/40 hover:bg-[#DCD9CE]/70';
  const titleColor = isDark ? 'text-[#EEEDEA]' : 'text-[#2D2D2D]';
  const snippetColor = isDark ? 'text-[rgba(238,237,234,0.45)]' : 'text-[#2D2D2D]/60';

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 font-redaction">
      {!activeNote ? (
        <div className={`text-center mt-10 text-sm ${txtMuted}`}>Open a note to see backlinks.</div>
      ) : backlinks.length === 0 ? (
        <div className={`text-center mt-10 text-sm ${txtMuted}`}>
          No backlinks found for<br /><span className={`font-bold ${isDark ? 'text-[rgba(238,237,234,0.6)]' : 'text-[#2D2D2D]/70'}`}>"{activeNote.title}"</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {backlinks.map(note => {
            const snippet = backlinkSnippets.get(note.id);
            return (
              <div key={note.id} className={`border px-3 py-2.5 transition-colors cursor-pointer ${cardBorder} ${cardBg}`}>
                <button
                  onClick={() => onNavigateToNoteById(note.id)}
                  className={`font-bold text-sm hover:text-[#CC7D5E] transition-colors flex items-center space-x-1.5 w-full text-left ${titleColor}`}
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
        </div>
      )}
    </div>
  );
}
