import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate } from '../lib/templates';
import { GlobalTask, Note } from '../types';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from '@/src/lib/icons';

interface CalendarPanelProps {
  notes: Note[];
  tasks?: GlobalTask[];
  activeNoteId: string;
  onSelectDate: (dateStr: string) => void;
  /** Pushes a date-range filter into the sidebar search box. Empty string clears it. */
  onSearchRange?: (query: string) => void;
  /** Watched so a range detaches the moment the search box says something else. */
  searchQuery?: string;
  dateFormat?: string;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
// No 'Week': the filter runs on updatedAt, and no note is edited in the
// future, so a Mon–Sun week only ever resolves to "Monday through today" —
// 2 days on a Tuesday, and indistinguishable from 7d by Sunday.
const PRESETS = ['Today', '7d', '30d', 'Month'] as const;
type Preset = typeof PRESETS[number];

type DayMeta = { daily: boolean; notes: number; due: number; overdue: number };
type Range = { start: string; end: string };

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// ISO day keys sort lexicographically, so plain string compare is a date compare.
const order = (a: string, b: string): Range => (a <= b ? { start: a, end: b } : { start: b, end: a });

function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CalendarPanel({
  notes,
  tasks = [],
  activeNoteId,
  onSelectDate,
  onSearchRange,
  searchQuery = '',
  dateFormat = 'YYYY-MM-DD',
}: CalendarPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [range, setRange] = useState<Range | null>(null);
  // Mirrors dragRef purely so a drag in progress repaints; the ref stays authoritative.
  const [dragPreview, setDragPreview] = useState<{ anchor: string; hover: string } | null>(null);
  const dragRef = useRef<{ anchor: string; hover: string; moved: boolean } | null>(null);
  // Anchor for shift-click. Seeded with today so the first shift-click still works.
  const anchorRef = useRef<string | null>(null);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const today = formatDate('YYYY-MM-DD');

  // One pass over notes + tasks per open month, rather than 31 × O(n) lookups
  // from inside the cell loop. Gated on isOpen: this component re-renders on
  // every notes change (every keystroke) and must do no per-note work while
  // collapsed.
  const { days: dayMeta, activeKey } = useMemo(() => {
    const days = new Map<string, DayMeta>();
    if (!isOpen) return { days, activeKey: null as string | null };

    const prefix = `${year}-${pad(month + 1)}-`;
    const ensure = (key: string): DayMeta => {
      let meta = days.get(key);
      if (!meta) {
        meta = { daily: false, notes: 0, due: 0, overdue: 0 };
        days.set(key, meta);
      }
      return meta;
    };

    // Note activity, keyed by local calendar day of updatedAt.
    const titles = new Set<string>();
    for (const note of notes) {
      titles.add(note.title);
      const parsed = new Date(note.updatedAt);
      if (Number.isNaN(parsed.getTime())) continue;
      const key = toKey(parsed);
      if (key.startsWith(prefix)) ensure(key).notes += 1;
    }

    // Daily notes are titled by the formatted date, and dateFormat is
    // user-configurable — so format each day forward and probe the title set
    // rather than trying to parse titles back into dates.
    const activeTitle = notes.find(n => n.id === activeNoteId)?.title ?? '';
    const lastDay = new Date(year, month + 1, 0).getDate();
    let activeKey: string | null = null;
    for (let d = 1; d <= lastDay; d++) {
      const formatted = formatDate(dateFormat, new Date(year, month, d));
      const key = `${prefix}${pad(d)}`;
      if (titles.has(formatted)) ensure(key).daily = true;
      if (activeTitle !== '' && formatted === activeTitle) activeKey = key;
    }

    // Open task due dates.
    for (const task of tasks) {
      if (task.completed || !task.dueDate?.startsWith(prefix)) continue;
      const meta = ensure(task.dueDate);
      meta.due += 1;
      if (task.dueDate < today) meta.overdue += 1;
    }

    return { days, activeKey };
  }, [isOpen, notes, tasks, year, month, dateFormat, activeNoteId, today]);

  const applyRange = useCallback((next: Range) => {
    setRange(next);
    onSearchRange?.(`after:${next.start} before:${next.end}`);
  }, [onSearchRange]);

  const clearRange = useCallback(() => {
    setRange(null);
    onSearchRange?.('');
  }, [onSearchRange]);

  // The search box owns the filter; the calendar only mirrors it. Editing or
  // clearing the query out from under us detaches the highlight instead of
  // leaving the grid claiming a filter that is no longer applied.
  useEffect(() => {
    if (!range) return;
    if (searchQuery !== `after:${range.start} before:${range.end}`) setRange(null);
  }, [searchQuery, range]);

  // Pointer-up lands on window, not the grid: a drag that ends outside the
  // calendar (or outside the sidebar) must still commit rather than stick.
  useEffect(() => {
    const finish = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);
      if (drag?.moved) applyRange(order(drag.anchor, drag.hover));
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [applyRange]);

  const activeRange = dragPreview ? order(dragPreview.anchor, dragPreview.hover) : range;

  const rangeNoteCount = useMemo(() => {
    if (!activeRange) return 0;
    let count = 0;
    for (const note of notes) {
      const parsed = new Date(note.updatedAt);
      if (Number.isNaN(parsed.getTime())) continue;
      const key = toKey(parsed);
      if (key >= activeRange.start && key <= activeRange.end) count += 1;
    }
    return count;
  }, [notes, activeRange]);

  const presetRange = useCallback((preset: Preset): Range => {
    const now = new Date();
    switch (preset) {
      case 'Today':
        return { start: today, end: today };
      case '7d':
        return { start: toKey(addDays(now, -6)), end: today };
      case '30d':
        return { start: toKey(addDays(now, -29)), end: today };
      case 'Month':
      default:
        return {
          start: `${year}-${pad(month + 1)}-01`,
          end: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
        };
    }
  }, [today, year, month]);

  const handleDayClick = (dateStr: string, shiftKey: boolean) => {
    if (shiftKey) {
      applyRange(order(anchorRef.current ?? today, dateStr));
      return;
    }
    anchorRef.current = dateStr;
    onSelectDate(dateStr);
  };

  const handlePointerDown = (dateStr: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || e.shiftKey) return;
    dragRef.current = { anchor: dateStr, hover: dateStr, moved: false };
  };

  const handlePointerEnter = (dateStr: string) => () => {
    const drag = dragRef.current;
    if (!drag || drag.hover === dateStr) return;
    drag.hover = dateStr;
    drag.moved = true;
    setDragPreview({ anchor: drag.anchor, hover: dateStr });
  };

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const monthName = viewMonth.toLocaleDateString('en-US', { month: 'long' });
  const isViewingToday = today.startsWith(`${year}-${pad(month + 1)}-`);

  // Build grid cells: leading empty + days + trailing empty
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay() returns 0=Sun..6=Sat; convert to Mon-based (0=Mon..6=Sun)
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  // Always six rows. A 5-row month next to a 6-row one resized the whole
  // bottom-anchored panel, so the nav arrows moved under the cursor between
  // clicks.
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDayOffset; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length < 42) cells.push({ day: null });

  return (
    <div className="noa-sidebar-section-surface shrink-0 border-t" style={{ borderTopColor: 'var(--panel-divider, #2D2D2B)' }}>
      {/* Section header */}
      <button
        className="w-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#2D2D2B]/50 hover:text-[#2D2D2B]/70 font-redaction flex items-center transition-colors cursor-pointer"
        onClick={() => setIsOpen(v => !v)}
        aria-expanded={isOpen}
      >
        <Calendar size={11} className="mr-1.5 shrink-0" />
        Calendar
        <ChevronDown size={10} className={`ml-auto transition-transform duration-100 ease-out ${isOpen ? '' : '-rotate-90'}`} />
      </button>

      {isOpen && (
        <div className="slide-down select-none">
          {/* Range summary sits under the section header, not above the
              weekday row. Two alignment systems meet in this panel: left-set
              text (header, summary, chips) starts at 12px, while weekday
              labels and dates are centred inside 32px cells and so start
              ~20px in. Neither is wrong, but butted against each other they
              read as a misalignment — so the text rows group together and the
              grid rows group together.

              It must also stay above the grid: the panel is bottom-anchored,
              so a row appearing below the grid shoves the grid up by its own
              height mid-drag and the pointer lands a whole week off target. */}
          {activeRange && (
            <div className="flex items-center gap-1.5 px-3 pb-2 text-[11px] font-redaction">
              <span className="text-[#CC7D5E] font-medium truncate">
                {activeRange.start === activeRange.end
                  ? shortDate(activeRange.start)
                  : `${shortDate(activeRange.start)} – ${shortDate(activeRange.end)}`}
              </span>
              {/* "edited", not "notes": the filter runs on updatedAt, so a
                  note written months ago and touched yesterday belongs in the
                  count. Calling them "notes" read as "notes from this week". */}
              <span className="text-[#2D2D2B]/40 shrink-0" title="Notes edited in this range">
                {rangeNoteCount} edited
              </span>
            </div>
          )}

          {/* Month navigation — the label doubles as "jump back to today" */}
          <div className="flex items-center justify-between px-3 pt-0.5 pb-2">
            <button type="button" onClick={prevMonth} aria-label="Previous month" className="w-8 h-8 flex items-center justify-center rounded-md text-[#2D2D2B]/50 noa-sidebar-hover-surface active:opacity-70 transition-colors cursor-pointer">
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={goToToday}
              title="Jump to today"
              aria-label="Jump to today"
              className={`px-2 py-1 rounded-md text-xs font-medium font-redaction transition-colors cursor-pointer noa-sidebar-hover-surface ${isViewingToday ? 'text-[#2D2D2B]/80' : 'text-[#CC7D5E]'}`}
            >
              <span className="font-semibold">{monthName}</span>
              <span className="ml-1 text-[#2D2D2B]/40">{year}</span>
            </button>
            <button type="button" onClick={nextMonth} aria-label="Next month" className="w-8 h-8 flex items-center justify-center rounded-md text-[#2D2D2B]/50 noa-sidebar-hover-surface active:opacity-70 transition-colors cursor-pointer">
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-[repeat(7,2rem)] justify-between px-3 pb-1">
            {WEEKDAYS.map(wd => (
              <div key={wd} className="flex items-center justify-center" style={{ fontSize: '10px' }}>
                <span className="font-medium text-[#2D2D2B]/50">{wd}</span>
              </div>
            ))}
          </div>

          {/* Day grid */}
          {/* Fixed 32px tracks, space-between — not grid-cols-7. Seven flexible
              columns made a 32px cell's edge a function of the sidebar width,
              so the grid drifted away from the header, summary and chip rows,
              which sit at a fixed 12px. The sidebar cannot go below 320px and
              7x32 + 24 = 248, so the tracks always fit. */}
          <div className="grid grid-cols-[repeat(7,2rem)] justify-between gap-y-1 px-3 pb-2" onDragStart={e => e.preventDefault()}>
            {cells.map((cell, i) => {
              if (cell.day === null) return <div key={`empty-${i}`} className="w-8 h-8" />;
              const dateStr = `${year}-${pad(month + 1)}-${pad(cell.day)}`;
              const meta = dayMeta.get(dateStr);
              const isToday = dateStr === today;
              const isActive = dateStr === activeKey;
              const hasNote = meta?.daily ?? false;
              const inRange = !!activeRange && dateStr >= activeRange.start && dateStr <= activeRange.end;
              const isRangeEdge = !!activeRange && (dateStr === activeRange.start || dateStr === activeRange.end);

              let cellClass = 'relative w-8 h-8 flex items-center justify-center text-xs font-redaction rounded-md transition-colors cursor-pointer ';
              if (isActive) cellClass += 'bg-[#CC7D5E] text-white font-bold shadow-[0_1px_2px_rgba(204,125,94,0.4)]';
              else if (isToday) cellClass += 'bg-[#CC7D5E]/12 text-[#CC7D5E] font-bold hover:bg-[#CC7D5E]/20';
              // Only the two edges take accent ink. Tinting every day in the
              // range turned a week into a solid orange block that shouted
              // louder than today's marker sitting inside it.
              else if (inRange) cellClass += isRangeEdge
                ? 'bg-[#CC7D5E]/22 text-[#CC7D5E] font-bold'
                : 'bg-[#CC7D5E]/10 text-[#2D2D2B]/80';
              else if (hasNote) cellClass += 'text-[#2D2D2B]/80 noa-sidebar-hover-surface';
              // /75 against the /50 weekday header. At the old /60 the two rows
              // sat at nearly the same weight and the grid read as one flat block.
              else cellClass += 'text-[#2D2D2B]/75';

              // Two 3px dots at most: notes on the left, open tasks on the
              // right. They read as one small cluster instead of competing for
              // the same slot under the numeral.
              const noteDot = meta && (meta.daily || meta.notes > 0);
              const taskDot = (meta?.due ?? 0) > 0;
              const taskStatus = meta?.due
                ? `${meta.due} task${meta.due > 1 ? 's' : ''} due${meta.overdue ? `, ${meta.overdue} overdue` : ''}`
                : null;
              const tip = [
                meta?.daily ? 'daily note' : null,
                meta?.notes ? `${meta.notes} note${meta.notes > 1 ? 's' : ''} edited` : null,
                taskStatus,
              ].filter(Boolean).join(' · ');
              const ariaLabel = [`Open ${dateStr}`, tip].filter(Boolean).join(', ');

              return (
                <button
                  key={dateStr}
                  type="button"
                  className={cellClass}
                  onClick={(e) => handleDayClick(dateStr, e.shiftKey)}
                  onPointerDown={handlePointerDown(dateStr)}
                  onPointerEnter={handlePointerEnter(dateStr)}
                  title={tip || undefined}
                  aria-label={ariaLabel}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <span className="leading-none">{cell.day}</span>
                  {!isActive && (noteDot || taskDot) && (
                    <span className="absolute bottom-[3px] left-0 right-0 flex items-center justify-center gap-[2px] pointer-events-none">
                      {noteDot && (
                        <span
                          className="w-[3px] h-[3px] rounded-full"
                          style={{
                            backgroundColor: meta!.daily
                              ? 'var(--accent-color, #CC7D5E)'
                              : 'color-mix(in srgb, var(--accent-color, #CC7D5E) 45%, transparent)',
                          }}
                        />
                      )}
                      {taskDot && (
                        <span className={`w-[3px] h-[3px] rounded-full ${meta!.overdue > 0 ? 'bg-[#C24444]' : 'bg-[#D9862B]'}`} />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Range presets. Outlined, not bare text: as plain labels in the
              sidebar's muted grey they read as a caption rather than four
              things you can press. The 3px radius is the codebase's default
              for controls — TasksPanel's filter chips are the same shape. */}
          {/* px-3, not the px-2 the grid rows use: those centre a 32px cell in a
              wider column, so their ink starts ~13px in. These chips are
              left-aligned, so they need the padding to do that job themselves. */}
          <div className="flex items-center gap-1 px-3 pb-3 text-[10px] font-redaction">
            {PRESETS.map(preset => {
              const target = presetRange(preset);
              const isSelected = !!range && range.start === target.start && range.end === target.end;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => (isSelected ? clearRange() : applyRange(target))}
                  aria-pressed={isSelected}
                  className={`px-1.5 py-0.5 border rounded-[3px] transition-colors active:opacity-70 cursor-pointer ${
                    isSelected
                      ? 'border-[#CC7D5E] text-[#CC7D5E] bg-[#CC7D5E]/10'
                      : 'border-[#2D2D2B]/15 text-[#2D2D2B]/60 hover:border-[#2D2D2B]/30 hover:text-[#2D2D2B]/80'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
            {activeRange && (
              <button
                type="button"
                onClick={clearRange}
                aria-label="Clear date filter"
                className="ml-auto shrink-0 px-1 text-[#2D2D2B]/40 hover:text-[#2D2D2B]/80 transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
