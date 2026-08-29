import React from 'react';
import { useOutgoingLinks } from '../../hooks/useOutgoingLinks';
import { Note, Folder } from '../../types';
import { LinkNoNoteState, LinkRow, LinkSectionHeader, linkSubtitle } from './LinkList';
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

  // "Links" is always on the page, count and all — a note with none isn't an
  // exceptional state worth its own message, just a 0. "Unresolved" stays
  // conditional: it names a problem (a broken [[link]]), so it should vanish
  // once there isn't one, rather than sit there permanently reading "0".
  // "No note open" is a different state from either of those, though — it's
  // not that this note has zero links, there's no note to have any — so it
  // gets its own message instead of folding into the same "0" the panel uses
  // for a real, linkless note.
  return (
    <div className="flex-1 overflow-y-auto noa-panel-scroll px-2 pb-3 pt-2 font-redaction">
      {!activeNote ? (
        <LinkNoNoteState isDark={isDark} />
      ) : (
        <>
          <LinkSectionHeader label="Links" count={resolved.length} isDark={isDark} />
          {resolved.length > 0 && (
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
          )}
          {unresolvedTitles.length > 0 && (
            <div className="mt-4">
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
