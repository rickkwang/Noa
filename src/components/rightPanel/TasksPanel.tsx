import React, { useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { useEdgeFadeRef } from '../../hooks/useEdgeFadeRef';
import { tokenizeInlineRefs } from '../../lib/noteUtils';
import { lsGetBoolean, lsSetBoolean } from '../../lib/safeLocalStorage';
import { GlobalTask } from '../../types';
import { Check, ChevronRight, ExternalLink } from '@/src/lib/icons';

// Parse 'YYYY-MM-DD' as LOCAL midnight. `new Date('YYYY-MM-DD')` parses as UTC
// midnight, which shifts the date a day earlier for users west of UTC.
function parseLocalDueDate(dueDate: string): Date {
  const [y, m, d] = dueDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getDueDateStatus(dueDate: string | undefined): 'overdue' | 'today' | 'soon' | null {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = parseLocalDueDate(dueDate);
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  const diff = (due.getTime() - today.getTime()) / 86_400_000;
  if (diff <= 3) return 'soon';
  return null;
}

interface TasksPanelProps {
  tasks: GlobalTask[];
  onToggleTask: (task: GlobalTask) => void;
  onNavigateToNoteById: (id: string, lineIndex?: number) => void;
  isDark?: boolean;
}

const TASKS_PAGE_SIZE = 100;
// A just-checked task holds its place this long, showing its done state, before it settles into Completed.
const SETTLE_MS = 700;

const PRIORITY_OPTIONS = ['all', 'high', 'medium', 'low'] as const;
const DUE_OPTIONS = ['all', 'today', 'next7', 'overdue'] as const;

// Memoized: `tasks` keeps identity across keystrokes that don't change a task, so typing elsewhere skips this panel.
// Task text is raw Markdown: links drop their brackets (soft accent underline) and tags take accent ink.
// Tokens only style; the row's own open-note button stays the single navigation target. Struck rows drop the underline.
const LINK_UNDERLINE = 'color-mix(in srgb, var(--accent-color, #CC7D5E) 45%, transparent)';
function TaskText({ content, struck = false }: { content: string; struck?: boolean }) {
  return (
    <>
      {tokenizeInlineRefs(content).map((token, i) => {
        if (token.kind === 'link') {
          if (struck) return <React.Fragment key={i}>{token.text}</React.Fragment>;
          return (
            <span key={i} className="underline decoration-1 underline-offset-[3px]" style={{ textDecorationColor: LINK_UNDERLINE }}>
              {token.text}
            </span>
          );
        }
        if (token.kind === 'tag') {
          return <span key={i} style={{ color: 'var(--accent-color, #CC7D5E)' }}>{token.text}</span>;
        }
        return <React.Fragment key={i}>{token.text}</React.Fragment>;
      })}
    </>
  );
}

export const TasksPanel = React.memo(function TasksPanel({ tasks, onToggleTask, onNavigateToNoteById, isDark = false }: TasksPanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<typeof PRIORITY_OPTIONS[number]>('all');
  const [dueDateFilter, setDueDateFilter] = useState<typeof DUE_OPTIONS[number]>('all');
  const fadeRef = useEdgeFadeRef<HTMLDivElement>();
  const [activePageSize, setActivePageSize] = useState(TASKS_PAGE_SIZE);
  const [completedPageSize, setCompletedPageSize] = useState(TASKS_PAGE_SIZE);
  const [completedExpanded, setCompletedExpanded] = useState(() => lsGetBoolean(STORAGE_KEYS.TASKS_COMPLETED_EXPANDED));
  // id → its index in the active list when checked; upstream sorts completed tasks last, so the hold re-inserts it there.
  const [settling, setSettling] = useState<ReadonlyMap<string, number>>(() => new Map());
  const settleTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = settleTimersRef.current;
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, []);

  const toggleActiveTask = (task: GlobalTask) => {
    const timers = settleTimersRef.current;
    const pending = timers.get(task.id);
    if (pending !== undefined) window.clearTimeout(pending);
    if (task.completed) {
      // Unchecking during the hold: the task never left the list, so just drop the hold.
      timers.delete(task.id);
      setSettling(prev => { const next = new Map(prev); next.delete(task.id); return next; });
    } else {
      setSettling(prev => new Map(prev).set(task.id, activeTasks.findIndex(t => t.id === task.id)));
      timers.set(task.id, window.setTimeout(() => {
        timers.delete(task.id);
        setSettling(prev => { const next = new Map(prev); next.delete(task.id); return next; });
      }, SETTLE_MS));
    }
    onToggleTask(task);
  };

  const { activeTasks, completedTasks, overdueCount, todayCount, hasPriorities, hasDueDates } = useMemo(() => {
    const activeTasks: typeof tasks = [];
    const completedTasks: typeof tasks = [];
    let overdueCount = 0;
    let todayCount = 0;
    let hasPriorities = false;
    let hasDueDates = false;
    const held: typeof tasks = [];
    for (const t of tasks) {
      if (t.priority !== 'none') hasPriorities = true;
      if (t.dueDate) hasDueDates = true;
      if (t.completed && !settling.has(t.id)) {
        completedTasks.push(t);
      } else {
        if (t.completed) { held.push(t); continue; }
        activeTasks.push(t);
        const status = getDueDateStatus(t.dueDate);
        if (status === 'overdue') overdueCount++;
        if (status === 'today') todayCount++;
      }
    }
    held.sort((a, b) => settling.get(a.id)! - settling.get(b.id)!);
    for (const t of held) activeTasks.splice(Math.min(settling.get(t.id)!, activeTasks.length), 0, t);
    return { activeTasks, completedTasks, overdueCount, todayCount, hasPriorities, hasDueDates };
  }, [tasks, settling]);

  // A filter whose row is hidden must not keep filtering, or it would strand the user with no visible way to clear it.
  const priorityFilterEff = hasPriorities ? priorityFilter : 'all';
  const dueDateFilterEff = hasDueDates ? dueDateFilter : 'all';

  const filteredActiveTasks = useMemo(() => {
    if (priorityFilterEff === 'all' && dueDateFilterEff === 'all') return activeTasks;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return activeTasks.filter(task => {
      if (priorityFilterEff !== 'all' && task.priority !== priorityFilterEff) return false;
      if (dueDateFilterEff !== 'all') {
        if (!task.dueDate) return false;
        const due = parseLocalDueDate(task.dueDate);
        if (dueDateFilterEff === 'today' && due.getTime() !== today.getTime()) return false;
        if (dueDateFilterEff === 'next7') {
          const rangeEnd = new Date(today); rangeEnd.setDate(today.getDate() + 6);
          if (due < today || due > rangeEnd) return false;
        }
        if (dueDateFilterEff === 'overdue' && due >= today) return false;
      }
      return true;
    });
  }, [activeTasks, priorityFilterEff, dueDateFilterEff]);

  const total = tasks.length;
  const doneCount = tasks.reduce((n, t) => n + (t.completed ? 1 : 0), 0);

  // ─── Theme tokens ──────────────────────────────────────────────────────
  const txt = isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]';
  const dim = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  const dimmer = isDark ? 'text-[rgba(249,249,247,0.3)]' : 'text-[#2D2D2B]/30';
  const rowHover = 'hover:bg-transparent';
  const checkboxBorder = isDark ? 'border-[rgba(249,249,247,0.48)]' : 'border-[#2D2D2B]/50';
  const noteLink = isDark ? 'text-[rgba(249,249,247,0.42)]' : 'text-[#2D2D2B]/40';
  const showMoreBtn = isDark
    ? 'border-[rgba(249,249,247,0.15)] text-[rgba(249,249,247,0.3)] hover:border-[rgba(249,249,247,0.4)] hover:text-[rgba(249,249,247,0.6)]'
    : 'border-[#2D2D2B]/20 text-[#2D2D2B]/40 hover:border-[#2D2D2B]/40 hover:text-[#2D2D2B]';
  const lowRail = isDark ? 'bg-[rgba(249,249,247,0.25)]' : 'bg-[#2D2D2B]/25';
  const filterHoverIdle = isDark ? 'hover:text-[rgba(249,249,247,0.8)]' : 'hover:text-[#2D2D2B]/80';

  function priorityRailColor(p: string): string | null {
    if (p === 'high') return 'bg-[#D45555]/70';
    if (p === 'medium') return 'bg-[#CC7D5E]';
    if (p === 'low') return lowRail;
    return null;
  }

  // Round box, as in a step list: open is a hairline ring, done is an accent disc with a knocked-out check.
  // Theme tokens rather than literal hexes: remapped `bg-[#…]` classes would invert these foreground fills.
  function renderCheckbox(done: boolean, justChecked = false) {
    return done ? (
      <div className={`w-[15px] h-[15px] rounded-full flex items-center justify-center bg-[var(--accent-color,#CC7D5E)] transition-colors duration-200 ${justChecked ? 'noa-task-check-in' : ''}`}>
        <Check size={9} weight="bold" className={`text-[var(--bg-primary,#FCFCFB)] ${justChecked ? 'noa-task-check-glyph' : ''}`} />
      </div>
    ) : (
      <div className={`w-[15px] h-[15px] rounded-full border transition-colors duration-200 hover:border-[#CC7D5E] hover:bg-[#CC7D5E]/10 ${checkboxBorder}`} />
    );
  }

  function renderOpenSource(task: GlobalTask) {
    return (
      <button onClick={() => onNavigateToNoteById(task.noteId, task.lineIndex)}
        aria-label={`Open source note: ${task.noteTitle}`}
        title={task.noteTitle}
        className={`absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-1 transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none hover:text-[#CC7D5E] noa-press ${noteLink}`}>
        <ExternalLink size={11} />
      </button>
    );
  }

  function renderFilterRow<T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    onChange: (v: T) => void
  ) {
    return (
      <div className="flex items-center gap-3 text-caption font-ui">
        <span className={`shrink-0 w-[52px] ${dimmer}`}>{label}</span>
        <div className="flex items-center gap-1 flex-wrap">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setActivePageSize(TASKS_PAGE_SIZE); }}
              className={`px-1.5 py-0.5 border rounded-chip capitalize transition-colors ${
                value === opt
                  ? 'border-[#CC7D5E] text-[#CC7D5E]'
                  : `border-transparent ${dim} ${filterHoverIdle}`
              }`}
            >
              {opt === 'next7' ? '7 days' : opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={fadeRef} className={`flex-1 overflow-y-auto noa-panel-scroll noa-edge-fade-y px-3 pb-4 pt-2 font-ui ${txt}`}>
      {tasks.length === 0 && (
        <div className={`noa-hint-in text-center mt-10 text-body ${dim}`}>
          No tasks found.<br />Add &quot;- [ ] task&quot; in any note!
        </div>
      )}

      {tasks.length > 0 && (
        <>
          {/* ─── Summary: one quiet line, no bar — the list itself is the progress ── */}
          <div className="mb-3 flex items-baseline gap-3 text-caption">
            <div
              className="flex items-baseline gap-1 tabular-nums"
              aria-label={`${doneCount} completed of ${total} tasks`}
            >
              <span className={txt}>{doneCount}</span>
              <span className={dimmer}>/</span>
              <span className={dim}>{total} done</span>
            </div>
            {overdueCount > 0 && <span className="text-[#D45555]">{overdueCount} overdue</span>}
            {todayCount > 0 && <span className="text-[#CC7D5E]">{todayCount} due today</span>}
          </div>

          {/* ─── Filter strip — each row only when some task carries that
                 metadata; for plain checklists both rows are pure noise ── */}
          {(hasPriorities || hasDueDates) && (
            <div className="flex flex-col gap-1.5 mb-3">
              {hasPriorities && renderFilterRow<typeof PRIORITY_OPTIONS[number]>('Priority', PRIORITY_OPTIONS, priorityFilter, setPriorityFilter)}
              {hasDueDates && renderFilterRow<typeof DUE_OPTIONS[number]>('Due', DUE_OPTIONS, dueDateFilter, setDueDateFilter)}
            </div>
          )}
        </>
      )}

      {filteredActiveTasks.length === 0 && activeTasks.length > 0 && (
        <div className={`noa-hint-in text-center mt-6 text-body ${dim}`}>No tasks match the current filter.</div>
      )}

      {/* ─── Active task rows (a just-checked row holds here, done, until it settles) ── */}
      {filteredActiveTasks.length > 0 && (
        <div>
          {filteredActiveTasks.slice(0, activePageSize).map(task => {
            const dueDateStatus = task.completed ? null : getDueDateStatus(task.dueDate);
            const isOverdue = dueDateStatus === 'overdue';
            const isToday = dueDateStatus === 'today';
            const isSoon = dueDateStatus === 'soon';
            const railColor = task.completed ? null : priorityRailColor(task.priority);
            return (
              <div key={task.id}
                 className={`group relative flex items-start gap-2.5 py-1.5 pr-6 transition-colors ${rowHover}`}>
                {railColor && (
                  <span className={`absolute -left-2 top-2 bottom-2 w-[2px] rounded-full ${railColor}`} title={task.priority} />
                )}
                <div className="flex items-center h-5 shrink-0">
                  <button onClick={() => toggleActiveTask(task)} className="p-1 -m-1 rounded-full focus-visible:outline-none noa-press" aria-label={task.completed ? 'Reopen task' : 'Complete task'}>
                    {renderCheckbox(task.completed, task.completed)}
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`block text-body leading-5 transition-colors duration-200 ${task.completed ? `line-through ${dim}` : txt}`}>
                    <TaskText content={task.content} struck={task.completed} />
                  </span>
                  {renderOpenSource(task)}
                  {task.dueDate && !task.completed && (
                    <div className={`mt-0.5 text-caption tabular-nums ${
                      isOverdue ? 'text-[#D45555]' : isToday || isSoon ? 'text-[#CC7D5E]' : dim
                    }`}>
                      {isOverdue ? 'Overdue · ' : isToday ? 'Today · ' : ''}{task.dueDate}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filteredActiveTasks.length > activePageSize && (
            <button onClick={() => setActivePageSize(s => s + TASKS_PAGE_SIZE)}
              className={`w-full text-caption py-1 mt-2 border border-dashed rounded-chip transition-colors font-ui ${showMoreBtn}`}>
              Show {filteredActiveTasks.length - activePageSize} more
            </button>
          )}
        </div>
      )}

      {/* ─── Completed section ───────────────────────────────────────── */}
      {completedTasks.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setCompletedExpanded(v => { lsSetBoolean(STORAGE_KEYS.TASKS_COMPLETED_EXPANDED, !v); return !v; })}
            className={`flex items-center gap-1.5 mb-0.5 py-1 text-caption transition-colors ${dim} ${filterHoverIdle}`}
            aria-expanded={completedExpanded}
          >
            <ChevronRight
              size={11}
              className={`shrink-0 transition-transform duration-200 ease-(--ease-snap) ${completedExpanded ? 'rotate-90' : ''}`}
            />
            <span className="tabular-nums">{completedTasks.length} completed</span>
          </button>
          {/* Height eases open via grid rows; inert while folded so hidden rows stay out of the tab order. */}
          <div
            inert={!completedExpanded || undefined}
            className={`grid transition-[grid-template-rows] duration-200 ease-(--ease-out) motion-reduce:transition-none ${completedExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          >
          <div className="min-h-0 overflow-hidden pl-1 -ml-1">
          <div>
            {completedTasks.slice(0, completedPageSize).map(task => (
                <div key={task.id} className="group relative flex items-start gap-2.5 py-1.5 pr-6">
                  <div className="flex items-center h-5 shrink-0">
                    <button onClick={() => toggleActiveTask(task)} className="p-1 -m-1 rounded-full focus-visible:outline-none noa-press" aria-label="Reopen task">
                      {renderCheckbox(true)}
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`block text-body leading-5 line-through ${dim}`}><TaskText content={task.content} struck /></span>
                    {renderOpenSource(task)}
                  </div>
                </div>
            ))}
            {completedTasks.length > completedPageSize && (
              <button onClick={() => setCompletedPageSize(s => s + TASKS_PAGE_SIZE)}
                className={`w-full text-caption py-1 mt-2 border border-dashed rounded-chip transition-colors font-ui ${showMoreBtn}`}>
                Show {completedTasks.length - completedPageSize} more
              </button>
            )}
          </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
});
