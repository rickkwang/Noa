import React, { useMemo, useState } from 'react';
import { formatDate } from '../lib/templates';
import { Note } from '../types';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from '@/src/lib/icons';

interface CalendarPanelProps {
  notes: Note[];
  activeNoteId: string;
  onSelectDate: (dateStr: string) => void;
  dateFormat?: string;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export default function CalendarPanel({ notes, activeNoteId, onSelectDate, dateFormat = 'YYYY-MM-DD' }: CalendarPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  const today = formatDate('YYYY-MM-DD');
  // Find the title of the active note to highlight the corresponding calendar day.
  // Daily note titles are the formatted date string (per dateFormat), so we compare
  // the formatted dateStr against the active note's title directly.
  // Gated on isOpen: this component re-renders on every notes change (every
  // keystroke) and must do no per-note work while collapsed.
  const activeNoteTitle = isOpen ? (notes.find(n => n.id === activeNoteId)?.title ?? '') : '';

  // Title set so each day cell checks membership in O(1) instead of scanning
  // all notes (31 × O(n) per render when open).
  const noteTitles = useMemo(
    () => (isOpen ? new Set(notes.map(n => n.title)) : null),
    [notes, isOpen]
  );

  // Returns true only if the active note is a daily note for this dateStr
  const isActiveDate = (dateStr: string) =>
    activeNoteTitle !== '' && formatDate(dateFormat, new Date(dateStr + 'T00:00:00')) === activeNoteTitle;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay() returns 0=Sun..6=Sat; convert to Mon-based (0=Mon..6=Sun)
  const firstDayRaw = new Date(year, month, 1).getDay();
  const firstDayOffset = (firstDayRaw + 6) % 7; // Mon=0

  const pad = (n: number) => String(n).padStart(2, '0');
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const hasDailyNote = (dateStr: string) => {
    const formatted = formatDate(dateFormat, new Date(dateStr + 'T00:00:00'));
    return noteTitles?.has(formatted) ?? false;
  };

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));

  // Build grid cells: leading empty + days + trailing empty
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDayOffset; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });

  return (
    <div className="noa-sidebar-section-surface shrink-0 border-t" style={{ borderTopColor: 'var(--panel-divider, #2D2D2B)' }}>
      {/* Section header */}
      <button
        className="w-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#2D2D2B]/50 hover:text-[#2D2D2B]/70 font-redaction flex items-center transition-colors cursor-pointer"
        onClick={() => setIsOpen(v => !v)}
        aria-expanded={isOpen}
      >
        <Calendar size={12} className="mr-1.5 shrink-0" />
        Calendar
        <ChevronDown size={11} className={`ml-auto transition-transform duration-100 ease-out ${isOpen ? '' : '-rotate-90'}`} />
      </button>

      {isOpen && (
        <div className="slide-down">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-2 pt-0.5 pb-2">
            <button type="button" onClick={prevMonth} aria-label="Previous month" className="w-8 h-8 flex items-center justify-center rounded-md text-[#2D2D2B]/50 noa-sidebar-hover-surface active:opacity-70 transition-colors cursor-pointer">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-medium font-redaction text-[#2D2D2B]/80">{monthLabel}</span>
            <button type="button" onClick={nextMonth} aria-label="Next month" className="w-8 h-8 flex items-center justify-center rounded-md text-[#2D2D2B]/50 noa-sidebar-hover-surface active:opacity-70 transition-colors cursor-pointer">
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 px-2 pb-1">
            {WEEKDAYS.map(wd => (
              <div key={wd} className="flex items-center justify-center" style={{ fontSize: '10px' }}>
                <span className="font-medium text-[#2D2D2B]/50">{wd}</span>
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-1 px-2 pb-3">
            {cells.map((cell, i) => {
              if (cell.day === null) return <div key={`empty-${i}`} className="w-8 h-8" />;
              const dateStr = `${year}-${pad(month + 1)}-${pad(cell.day)}`;
              const isToday = dateStr === today;
              const isActive = isActiveDate(dateStr);
              const hasNote = hasDailyNote(dateStr);
              const isClickable = hasNote || isToday;
              let cellClass = `w-8 h-8 flex flex-col items-center justify-center text-xs font-redaction rounded-md transition-colors ${isClickable ? 'cursor-pointer' : 'cursor-default'} `;
              if (isActive) cellClass += 'bg-[#CC7D5E] text-white font-bold shadow-[0_1px_2px_rgba(204,125,94,0.4)]';
              else if (isToday) cellClass += 'bg-[#CC7D5E]/12 text-[#CC7D5E] font-bold hover:bg-[#CC7D5E]/20';
              else if (hasNote) cellClass += 'text-[#2D2D2B]/80 noa-sidebar-hover-surface';
              else cellClass += 'text-[#2D2D2B]/60';
              return (
                <button
                  key={dateStr}
                  type="button"
                  className={cellClass}
                  onClick={() => isClickable && onSelectDate(dateStr)}
                  aria-label={`Open ${dateStr}`}
                  aria-current={isToday ? 'date' : undefined}
                  disabled={!isClickable}
                >
                  <span className="leading-none">{cell.day}</span>
                  {hasNote && !isActive && <span className="w-1 h-1 rounded-full bg-[#CC7D5E] mt-0.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
