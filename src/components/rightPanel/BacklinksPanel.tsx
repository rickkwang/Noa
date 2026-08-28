import React, { useMemo } from 'react';
import { getBacklinks } from '../../lib/noteUtils';
import { Folder, Note } from '../../types';
import { LinkEmptyState, LinkRow, LinkSectionHeader, linkSubtitle } from './LinkList';
import { Link } from '@/src/lib/icons';

interface BacklinksPanelProps {
  activeNote?: Note;
  notes: Note[];
  folders?: Folder[];
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
}

export function BacklinksPanel({ activeNote, notes, folders, onNavigateToNoteById, isDark = false }: BacklinksPanelProps) {
  const backlinks = useMemo(() => getBacklinks(activeNote, notes), [activeNote, notes]);

  return (
    <div className="flex-1 overflow-y-auto noa-panel-scroll px-2 pb-3 pt-2 font-redaction">
      {!activeNote ? (
        <LinkEmptyState lead="Open a note to see backlinks." isDark={isDark} />
      ) : backlinks.length === 0 ? (
        <LinkEmptyState lead="No backlinks found for" title={activeNote.title} isDark={isDark} />
      ) : (
        <>
          <LinkSectionHeader label="Backlinks" count={backlinks.length} isDark={isDark} />
          <div className="space-y-px">
            {backlinks.map(note => (
              <LinkRow
                key={note.id}
                icon={Link}
                title={note.title}
                subtitle={linkSubtitle(note, folders)}
                onClick={() => onNavigateToNoteById(note.id)}
                isDark={isDark}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
