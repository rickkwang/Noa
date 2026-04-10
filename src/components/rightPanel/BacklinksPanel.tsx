import React, { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Note } from '../../types';

interface BacklinksPanelProps {
  activeNote?: Note;
  notes: Note[];
  onNavigateToNoteById: (id: string) => void;
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

export function BacklinksPanel({ activeNote, notes, onNavigateToNoteById }: BacklinksPanelProps) {
  const backlinks = useMemo(() => {
    if (!activeNote) return [];
    return notes.filter(n =>
      n.id !== activeNote.id &&
      ((n.linkRefs ?? []).includes(activeNote.id) || (n.links ?? []).includes(activeNote.title))
    );
  }, [activeNote, notes]);

  const backlinkSnippets = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeNote) return map;
    backlinks.forEach(note => map.set(note.id, getSnippet(note, activeNote.title)));
    return map;
  }, [activeNote, backlinks]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 font-redaction">
      {!activeNote ? (
        <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">Open a note to see backlinks.</div>
      ) : backlinks.length === 0 ? (
        <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">
          No backlinks found for<br /><span className="font-bold text-[#2D2D2D]/70">"{activeNote.title}"</span>
        </div>
      ) : (
        <div className="space-y-3">
          {backlinks.map(note => {
            const snippet = backlinkSnippets.get(note.id);
            return (
              <div key={note.id} className="border border-[#2D2D2D] bg-[#DCD9CE]/40 p-3 hover:bg-[#DCD9CE]/70 transition-colors cursor-pointer">
                <button
                  onClick={() => onNavigateToNoteById(note.id)}
                  className="font-bold text-sm text-[#2D2D2D] hover:text-[#B89B5E] transition-colors flex items-center space-x-1.5 w-full text-left"
                >
                  <ExternalLink size={12} className="shrink-0" />
                  <span className="truncate">{note.title}</span>
                </button>
                {snippet && (
                  <p className="mt-1.5 text-xs text-[#2D2D2D]/60 leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">
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
