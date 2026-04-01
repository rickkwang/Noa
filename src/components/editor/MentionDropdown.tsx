import React, { useEffect, useState } from 'react';
import { Note } from '../../types';

interface MentionQuery {
  query: string;
  index: number;
  x: number;
  y: number;
}

interface MentionDropdownProps {
  mentionQuery: MentionQuery;
  allNotes: Note[];
  currentNoteId: string;
  onInsert: (title: string, index: number) => void;
}

export function MentionDropdown({
  mentionQuery,
  allNotes,
  currentNoteId,
  onInsert,
}: MentionDropdownProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [mentionQuery.index, mentionQuery.query]);

  const suggestions = allNotes
    .filter((n) => n.title.toLowerCase().includes(mentionQuery.query) && n.id !== currentNoteId)
    .slice(0, 5);

  if (suggestions.length === 0) return null;

  return (
    <div
      className={`absolute z-50 bg-[#EAE8E0] border border-[#2D2D2D] shadow-[4px_4px_0_0_rgba(45,45,45,1)] font-redaction w-64 max-h-48 overflow-y-auto transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ top: mentionQuery.y, left: mentionQuery.x }}
    >
      <div className="px-3 py-1 bg-[#DCD9CE] border-b border-[#2D2D2D] text-xs font-bold text-[#2D2D2D]/70">
        Link to note
      </div>
      {suggestions.map((n) => (
        <div
          key={n.id}
          className="px-3 py-2 hover:bg-[#2D2D2D] hover:text-[#EAE8E0] cursor-pointer border-b border-[#2D2D2D]/10 last:border-0 truncate"
          onMouseDown={(e) => {
            e.preventDefault();
            onInsert(n.title, mentionQuery.index);
          }}
        >
          {n.title}
        </div>
      ))}
    </div>
  );
}
