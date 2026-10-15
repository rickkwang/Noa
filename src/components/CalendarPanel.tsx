import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate } from '../lib/templates';
import { GlobalTask, Note } from '../types';
import { ChevronLeft, ChevronRight } from '@/src/lib/icons';

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
  /** Owned by the rail card: false while the card is collapsed, so no per-note work runs. */
  isOpen: boolean;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
// No 'Week': the filter runs on updatedAt, so a Mon–Sun week would just mean "Monday through today".
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
  isOpen,
}: CalendarPanelProps) {
  const isBodyMounted = isOpen;
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

  // Always six rows, so the card keeps its height from month to month and what's below it doesn't shift.
  // getDay() is Sun-based; convert to Mon-based.
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const gridDates = useMemo(
    () => Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - firstDayOffset + i)),
    [year, month, firstDayOffset],
  );
  const gridFirstKey = toKey(gridDates[0]);
  const gridLastKey = toKey(gridDates[41]);

  // One pass over notes + tasks per month. Gated on isBodyMounted so it does no per-note work while collapsed.
  const { days: dayMeta, activeKey } = useMemo(() => {
    const days = new Map<string, DayMeta>();
    if (!isBodyMounted) return { days, activeKey: null as string | null };

    const inGrid = (key: string) => key >= gridFirstKey && key <= gridLastKey;
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
      if (inGrid(key)) ensure(key).notes += 1;
    }

    // dateFormat is user-configurable, so format each day and probe the title set rather than parsing titles.
    const activeTitle = notes.find(n => n.id === activeNoteId)?.title ?? '';
    let activeKey: string | null = null;
    for (const date of gridDates) {
      const formatted = formatDate(dateFormat, date);
      const key = toKey(date);
      if (titles.has(formatted)) ensure(key).daily = true;
      if (activeTitle !== '' && formatted === activeTitle) activeKey = key;
    }

    // Open task due dates.
    for (const task of tasks) {
      if (task.completed || !task.dueDate || !inGrid(task.dueDate)) continue;
      const meta = ensure(task.dueDate);
      meta.due += 1;
      if (task.dueDate < today) meta.overdue += 1;
    }

    return { days, activeKey };
  }, [isBodyMounted, notes, tasks, gridDates, gridFirstKey, gridLastKey, dateFormat, activeNoteId, today]);

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

  // Pointer-up is listened for on window so a drag ending outside the grid still commits.
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

  const selectedPresetIndex = PRESETS.findIndex(preset => {
    const target = presetRange(preset);
    return !!range && range.start === target.start && range.end === target.end;
  });
  // Indicator keeps its last slot while hidden (clearing fades in place), and only slides preset→preset;
  // appearing from nothing jumps to its slot and fades in rather than sweeping across from slot 0.
  const [indicator, setIndicator] = useState({ selected: selectedPresetIndex, index: Math.max(0, selectedPresetIndex), slide: false });
  if (indicator.selected !== selectedPresetIndex) {
    setIndicator({
      selected: selectedPresetIndex,
      index: selectedPresetIndex === -1 ? indicator.index : selectedPresetIndex,
      slide: indicator.selected !== -1 && selectedPresetIndex !== -1,
    });
  }

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


  // The rail card supplies the title row; this is only its body.
  if (!isBodyMounted) return null;
  return (
    <div className="select-none px-2 pt-1 pb-1.5 font-ui">
      {/* Summary line, like the tags card: the month in ink, then the selected range (or the edited count) muted. */}
      <div className="flex h-[26px] items-center gap-1">
        <button
          type="button"
          onClick={goToToday}
          title="Jump to today"
          aria-label="Jump to today"
          data-today={isViewingToday}
          className="noa-cal-month min-w-0 truncate rounded-md px-1 text-left text-body leading-[19px]"
        >
          {monthName} <span className="noa-rail-muted">{year}</span>
        </button>
        <span className="ms-auto flex shrink-0">
          <button type="button" onClick={prevMonth} aria-label="Previous month" className="noa-cal-nav noa-rail-muted flex size-[26px] items-center justify-center rounded-md">
            <ChevronLeft size={14} />
          </button>
          <button type="button" onClick={nextMonth} aria-label="Next month" className="noa-cal-nav noa-rail-muted flex size-[26px] items-center justify-center rounded-md">
            <ChevronRight size={14} />
          </button>
        </span>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 pt-1.5">
        {WEEKDAYS.map(wd => (
          <div key={wd} className="noa-rail-muted flex h-5 items-center justify-center text-xs leading-[15px]">{wd}</div>
        ))}
      </div>

      {/* Day grid: seven equal columns across the card, 30px rows. */}
      <div className="grid grid-cols-7 gap-y-0.5" onDragStart={e => e.preventDefault()}>
        {gridDates.map((date) => {
          const dateStr = toKey(date);
          const meta = dayMeta.get(dateStr);
          const isActive = dateStr === activeKey;
          const inRange = !!activeRange && dateStr >= activeRange.start && dateStr <= activeRange.end;
          const isRangeEdge = !!activeRange && (dateStr === activeRange.start || dateStr === activeRange.end);

          // Up to two dots: notes (neutral; darker for a daily note), open tasks (amber, orange when overdue).
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
              // All states are styled in CSS from these attributes, so both themes read them the same way.
              data-active={isActive || undefined}
              data-today={dateStr === today || undefined}
              data-range={inRange ? (isRangeEdge ? 'edge' : 'mid') : undefined}
              // Neighbouring-month days recede, except inside a range, which keeps its days at full strength.
              data-outside={(date.getMonth() !== month && !inRange) || undefined}
              className="noa-cal-day relative flex h-[30px] items-center justify-center rounded-md text-xs tabular-nums"
              onClick={(e) => handleDayClick(dateStr, e.shiftKey)}
              onPointerDown={handlePointerDown(dateStr)}
              onPointerEnter={handlePointerEnter(dateStr)}
              title={tip || undefined}
              aria-label={ariaLabel}
              aria-current={dateStr === today ? 'date' : undefined}
            >
              <span className="leading-none">{date.getDate()}</span>
              {!isActive && (noteDot || taskDot) && (
                <span className="pointer-events-none absolute bottom-[3px] left-0 right-0 flex items-center justify-center gap-[2px]">
                  {noteDot && <span data-dot={meta!.daily ? 'daily' : 'note'} className="noa-cal-dot size-[3px] rounded-full" />}
                  {taskDot && <span data-dot={meta!.overdue > 0 ? 'overdue' : 'due'} className="noa-cal-dot size-[3px] rounded-full" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* The selected range, as a muted line under the grid; "edited", not "notes": the filter runs on updatedAt.
          Only shown with a range: the rail is top-anchored, so it pushes the presets down, never the grid. */}
      {activeRange ? (
        <div className="flex h-[26px] items-center gap-1.5 px-1 text-xs leading-[15px]">
          <span className="truncate text-[var(--text-primary,#2D2D2B)]">
            {activeRange.start === activeRange.end
              ? shortDate(activeRange.start)
              : `${shortDate(activeRange.start)} – ${shortDate(activeRange.end)}`}
          </span>
          <span className="noa-rail-muted shrink-0 tabular-nums" title="Notes edited in this range">
            {rangeNoteCount} {rangeNoteCount === 1 ? 'note' : 'notes'} edited
          </span>
          <button type="button" onClick={clearRange} aria-label="Clear date filter" className="noa-cal-nav noa-rail-muted ms-auto shrink-0 rounded-md px-1">
            Clear
          </button>
        </div>
      ) : <div className="h-1.5" />}

      <div>
        <div className="noa-segmented-track relative flex items-center rounded-lg p-px text-xs" role="group" aria-label="Date range presets">
          {/* One shared indicator slides between equal-width slots; no gap so translateX(i * 100%) lands exactly. */}
          <span
            aria-hidden="true"
            className="noa-segment-indicator pointer-events-none absolute top-px bottom-px left-px rounded-[7px]"
            data-visible={selectedPresetIndex !== -1}
            data-slide={indicator.slide}
            style={{ width: `calc((100% - 2px) / ${PRESETS.length})`, transform: `translateX(${indicator.index * 100}%)` }}
          />
          {PRESETS.map((preset, i) => {
            const isSelected = i === selectedPresetIndex;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => (isSelected ? clearRange() : applyRange(presetRange(preset)))}
                aria-pressed={isSelected}
                className="noa-segment relative flex h-6 flex-1 items-center justify-center rounded-[7px]"
              >
                {preset}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
