import React from 'react';
import { useOutgoingLinks } from '../../hooks/useOutgoingLinks';
import { Note, Folder } from '../../types';
import { LinkEmptyState, LinkRow, LinkSectionHeader, linkSubtitle } from './LinkList';
import { Link, Unlink } from '@/src/lib/icons';

interface OutgoingLinksPanelProps {
  activeNote?: Note;
  notes: Note[];
  folders?: Folder[];
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
}

export function OutgoingLinksPanel({ activeNote, notes, folders, onNavigateToNoteById, isDark = false }: OutgoingLinksPanelProps) {
  const { resolved, unresolvedTitles } = useOutgoingLinks(activeNote, notes, folders);
  const hasAny = resolved.length > 0 || unresolvedTitles.length > 0;

  return (
    <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-2 py-3 font-redaction">
      {!activeNote ? (
        <LinkEmptyState lead="Open a note to see outgoing links." isDark={isDark} />
      ) : !hasAny ? (
        <LinkEmptyState lead="No outgoing links from" title={activeNote.title} isDark={isDark} />
      ) : (
        <>
          {resolved.length > 0 && (
            <>
              <LinkSectionHeader label="Links" count={resolved.length} isDark={isDark} />
              <div className="space-y-px">
                {resolved.map(note => (
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
          {unresolvedTitles.length > 0 && (
            <div className={resolved.length > 0 ? 'mt-4' : ''}>
              {/* A broken-link glyph and the muted title carry the state on
                  their own. The dashed outline this replaces drew a box around
                  every miss, which made the absent notes the loudest thing in
                  a panel about the present ones. */}
              <LinkSectionHeader label="Unresolved" count={unresolvedTitles.length} isDark={isDark} />
              <div className="space-y-px">
                {unresolvedTitles.map(title => (
                  <LinkRow key={title} icon={Unlink} title={title} dimmed isDark={isDark} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
