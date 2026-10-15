import React, { useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { useEdgeFadeRef } from '../../hooks/useEdgeFadeRef';
import { lsGetBoolean, lsSetBoolean } from '../../lib/safeLocalStorage';
import { GlobalTask, Note } from '../../types';
import CalendarPanel from '../CalendarPanel';
import { TagBrowser } from '../sidebar/TagBrowser';
import { RailCard } from './RailCard';

interface NoteRailProps {
  notes: Note[];
  tasks: GlobalTask[];
  activeNoteId: string;
  searchQuery: string;
  dateFormat: string;
  onOpenDailyNote: (dateStr: string) => void;
  onSearchQuery: (query: string) => void;
  onSearchTag: (tag: string) => void;
}

// Stored as "collapsed" so a card nobody has touched starts open.
function usePersistedCollapse(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => lsGetBoolean(key));
  const toggle = () => setCollapsed(v => { lsSetBoolean(key, !v); return !v; });
  return [!collapsed, toggle];
}

/**
 * Calendar and Tags as cards in a 280px column beside the editor, independent of the right panel. It takes
 * its own width (the editor narrows and recentres) and is shown and hidden from the titlebar in one frame;
 * each card collapses from its own header.
 */
export function NoteRail({ notes, tasks, activeNoteId, searchQuery, dateFormat, onOpenDailyNote, onSearchQuery, onSearchTag }: NoteRailProps) {
  const [calendarOpen, toggleCalendar] = usePersistedCollapse(STORAGE_KEYS.NOTE_RAIL_CALENDAR_COLLAPSED);
  const [tagsOpen, toggleTags] = usePersistedCollapse(STORAGE_KEYS.NOTE_RAIL_TAGS_COLLAPSED);
  const fadeRef = useEdgeFadeRef<HTMLDivElement>();
  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <aside
      aria-label="Calendar and tags"
      data-note-rail="true"
      className="flex w-[280px] shrink-0 flex-col bg-[var(--bg-primary,#FCFCFB)] pb-3 pr-3 pt-3 box-content"
    >
      <div ref={fadeRef} className="noa-edge-fade-y flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-px [scrollbar-width:none]">
        <RailCard title="Calendar" summary={monthLabel} open={calendarOpen} onToggle={toggleCalendar}>
          <CalendarPanel
            notes={notes}
            tasks={tasks}
            activeNoteId={activeNoteId}
            onSelectDate={onOpenDailyNote}
            onSearchRange={onSearchQuery}
            searchQuery={searchQuery}
            dateFormat={dateFormat}
            isOpen={calendarOpen}
          />
        </RailCard>
        <RailCard title="Tags" open={tagsOpen} onToggle={toggleTags}>
          <TagBrowser notes={notes} onSearchTag={onSearchTag} searchQuery={searchQuery} isOpen={tagsOpen} />
        </RailCard>
      </div>
    </aside>
  );
}
