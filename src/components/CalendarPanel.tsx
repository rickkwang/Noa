import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from 'lucide-react';
import { Note } from '../types';
import { formatDate } from '../lib/templates';

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
  const activeNoteTitle = notes.find(n => n.id === activeNoteId)?.title ?? '';

  // Returns true only if the active note is a daily note for this dateStr
  const isActiveDate = (dateStr: string) =>
    activeNoteTitle !== '' && formatDate(dateFormat, new Date(dateStr + 'T00:00:00')) === activeNoteTitle;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay() returns 0=Sun..6=Sat; convert to Mon-based (0=Mon..6=Sun)
  const firstDayRaw = new Date(year, month, 1).getDay();
  const firstDayOffset = (firstDayRaw + 6) % 7; // Mon=0

  const pad = (n: number) => String(n).padStart(2, '0');
  const monthLabel = `${year}-${pad(month + 1)}`;

  const hasDailyNote = (dateStr: string) => {
    const formatted = formatDate(dateFormat, new Date(dateStr + 'T00:00:00'));
    return notes.some(n => n.title === formatted);
  };

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));

  // Build grid cells: leading empty + days + trailing empty
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDayOffset; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });

  return (
    <div className="shrink-0 border-t border-[#2D2D2D]">
      {/* Section header */}
      <button
        className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest text-[#2D2D2D]/40 hover:text-[#2D2D2D]/70 flex items-center transition-colors cursor-pointer"
        onClick={() => setIsOpen(v => !v)}
      >
        <Calendar size={12} className="mr-1 shrink-0" />
        Calendar
        <ChevronDown size={11} className={`ml-auto transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
      </button>

      {isOpen && (
        <div>
          {/* Month navigation */}
          <div className="flex items-center justify-between px-3 pb-1">
            <button onClick={prevMonth} className="p-0.5 text-[#2D2D2D]/50 hover:text-[#2D2D2D] active:opacity-70 transition-colors cursor-pointer">
              <ChevronLeft size={12} />
            </button>
            <span className="text-xs font-redaction text-[#2D2D2D]/80">{monthLabel}</span>
            <button onClick={nextMonth} className="p-0.5 text-[#2D2D2D]/50 hover:text-[#2D2D2D] active:opacity-70 transition-colors cursor-pointer">
              <ChevronRight size={12} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 px-2 pb-0.5">
            {WEEKDAYS.map(wd => (
              <div key={wd} className="flex items-center justify-center" style={{ fontSize: '10px' }}>
                <span className="text-[#2D2D2D]/40">{wd}</span>
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 px-2 pb-3">
            {cells.map((cell, i) => {
              if (cell.day === null) return <div key={`empty-${i}`} className="w-7 h-7" />;
              const dateStr = `${year}-${pad(month + 1)}-${pad(cell.day)}`;
              const isToday = dateStr === today;
              const isActive = isActiveDate(dateStr);
              const hasNote = hasDailyNote(dateStr);
              const isClickable = hasNote || isToday;
              let cellClass = `w-7 h-7 flex flex-col items-center justify-center text-xs font-redaction transition-colors ${isClickable ? 'cursor-pointer' : 'cursor-default'} `;
              if (isActive) cellClass += 'bg-[#B89B5E] text-white';
              else if (isToday) cellClass += 'border border-[#B89B5E] text-[#B89B5E] hover:bg-[#DCD9CE]';
              else if (hasNote) cellClass += 'text-[#2D2D2D] hover:bg-[#DCD9CE]';
              else cellClass += 'text-[#2D2D2D] opacity-40';
              return (
                <div key={dateStr} className={cellClass} onClick={() => isClickable && onSelectDate(dateStr)}>
                  <span className="leading-none">{cell.day}</span>
                  {hasNote && !isActive && <span className="w-1 h-1 bg-[#B89B5E] mt-0.5" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
