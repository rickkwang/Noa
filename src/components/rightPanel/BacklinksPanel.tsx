import React, { useMemo } from 'react';
import { useEdgeFadeRef } from '../../hooks/useEdgeFadeRef';
import { findMentionLine, getBacklinks } from '../../lib/noteUtils';
import { Folder, Note } from '../../types';
import { LinkNoNoteState, LinkRow, LinkSectionHeader, linkSubtitle } from './LinkList';
import { Link } from '@/src/lib/icons';

interface BacklinksPanelProps {
  activeNote?: Note;
  notes: Note[];
  folders?: Folder[];
  onNavigateToNoteById: (id: string, lineIndex?: number) => void;
}

export function BacklinksPanel({ activeNote, notes, folders, onNavigateToNoteById }: BacklinksPanelProps) {
  const fadeRef = useEdgeFadeRef<HTMLDivElement>();
  // Each backlink carries the line that links here, so the row says why it's listed and opens at that line.
  const backlinks = useMemo(() => getBacklinks(activeNote, notes).map((note) => ({
    note,
    mention: activeNote ? findMentionLine(note.content, activeNote.title) : null,
  })), [activeNote, notes]);

  return (
    <div ref={fadeRef} className="flex-1 overflow-y-auto noa-panel-scroll noa-edge-fade-y px-1 pb-3 pt-2 font-ui">
      {!activeNote ? (
        <LinkNoNoteState />
      ) : (
        <>
          <LinkSectionHeader label="Linked from" count={backlinks.length} />
          {backlinks.length > 0 && (
            <div className="space-y-px">
              {backlinks.map(({ note, mention }) => (
                <LinkRow
                  key={note.id}
                  icon={Link}
                  title={note.title}
                  subtitle={linkSubtitle(note, folders)}
                  snippet={mention?.excerpt}
                  onClick={() => onNavigateToNoteById(note.id, mention?.lineIndex)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
