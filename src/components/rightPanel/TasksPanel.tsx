import React, { useMemo, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
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

const PRIORITY_OPTIONS = ['all', 'high', 'medium', 'low'] as const;
const DUE_OPTIONS = ['all', 'today', 'next7', 'overdue'] as const;

// Memoized: `tasks` keeps its identity across keystrokes that don't change any
// task (useGlobalTasks) and the callbacks are stabilized in App, so typing in
// a task-free note skips this panel entirely.
export const TasksPanel = React.memo(function TasksPanel({ tasks, onToggleTask, onNavigateToNoteById, isDark = false }: TasksPanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<typeof PRIORITY_OPTIONS[number]>('all');
  const [dueDateFilter, setDueDateFilter] = useState<typeof DUE_OPTIONS[number]>('all');
  const [activePageSize, setActivePageSize] = useState(TASKS_PAGE_SIZE);
  const [completedPageSize, setCompletedPageSize] = useState(TASKS_PAGE_SIZE);
  const [completedExpanded, setCompletedExpanded] = useState(() => lsGetBoolean(STORAGE_KEYS.TASKS_COMPLETED_EXPANDED));

  const { activeTasks, completedTasks, overdueCount, todayCount, hasPriorities, hasDueDates } = useMemo(() => {
    const activeTasks: typeof tasks = [];
    const completedTasks: typeof tasks = [];
    let overdueCount = 0;
    let todayCount = 0;
    let hasPriorities = false;
    let hasDueDates = false;
    for (const t of tasks) {
      if (t.priority !== 'none') hasPriorities = true;
      if (t.dueDate) hasDueDates = true;
      if (t.completed) {
        completedTasks.push(t);
      } else {
        activeTasks.push(t);
        const status = getDueDateStatus(t.dueDate);
        if (status === 'overdue') overdueCount++;
        if (status === 'today') todayCount++;
      }
    }
    return { activeTasks, completedTasks, overdueCount, todayCount, hasPriorities, hasDueDates };
  }, [tasks]);

  // A filter whose row is hidden (no task carries that metadata) must not keep
  // filtering — e.g. filter set to 'high', then the last prioritized task is
  // edited away: the row disappears with no visible way to clear it.
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

  const total = activeTasks.length + completedTasks.length;
  const completionPct = total > 0 ? Math.round((completedTasks.length / total) * 100) : 0;

  // ─── Theme tokens ──────────────────────────────────────────────────────
  const txt = isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]';
  const dim = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  const dimmer = isDark ? 'text-[rgba(249,249,247,0.3)]' : 'text-[#2D2D2B]/30';
  const rowHover = 'hover:bg-transparent';
  const progressTrack = isDark ? 'bg-[rgba(249,249,247,0.2)]' : 'bg-[#2D2D2B]/12';
  // Reads the theme token rather than a literal hex: `bg-[#F9F9F7]` is one of
  // the classes index.css remaps globally with `!important` (see the comment
  // above its dark-mode block), so as a foreground fill it silently inverted to
  // the dark surface colour. The class generated for the token matches no remap
  // selector. Fallback is the light value; RightPanel is lazy-loaded, so
  // ThemeInjector has always set the token before this paints.
  const progressFill = 'bg-[var(--text-primary,#2D2D2B)]';
  const checkboxBorder = isDark ? 'border-[rgba(249,249,247,0.48)]' : 'border-[#2D2D2B]/50';
  const checkboxBorderDone = isDark ? 'border-[rgba(249,249,247,0.4)]' : 'border-[#2D2D2B]/50';
  const checkboxBgDone = isDark ? 'bg-[rgba(249,249,247,0.15)]' : 'bg-[#2D2D2B]/20';
  const checkmarkColor = isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]';
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

  function renderFilterRow<T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    onChange: (v: T) => void
  ) {
    return (
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] font-bold font-redaction">
        <span className={`shrink-0 w-[58px] ${dimmer}`}>{label}</span>
        <div className="flex items-center gap-1 flex-wrap">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setActivePageSize(TASKS_PAGE_SIZE); }}
              className={`px-1.5 py-0.5 border rounded-[3px] transition-colors active:opacity-70 ${
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
    <div className={`flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 font-redaction ${txt}`}>
      {tasks.length === 0 && (
        <div className={`text-center mt-10 text-sm ${dim}`}>
          No tasks found.<br />Add &quot;- [ ] task&quot; in any note!
        </div>
      )}

      {tasks.length > 0 && (
        <>
          {/* ─── Stat header ─────────────────────────────────────────── */}
          <div className="mb-5">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className={`text-[11px] uppercase tracking-[0.25em] font-bold ${dimmer}`}>Tasks</span>
              <div
                className="flex items-baseline gap-1 tabular-nums text-[11px] font-semibold"
                aria-label={`${completedTasks.length} completed of ${total} tasks`}
              >
                <span className={txt}>{completedTasks.length}</span>
                <span className={dimmer}>/</span>
                <span className={dim}>{total}</span>
                {completedTasks.length > 0 && (
                  <>
                    <span className={dimmer}>·</span>
                    <span className={dim}>{completionPct}%</span>
                  </>
                )}
              </div>
            </div>
            <div className={`h-[3px] w-full ${progressTrack} relative`}>
              <div
                className={`absolute inset-y-0 left-0 ${progressFill} transition-[width] duration-200`}
                style={{ width: `${completionPct}%` }}
              />
            </div>
            {(overdueCount > 0 || todayCount > 0) && (
              <div className="flex items-center gap-3 mt-2 text-[11px] uppercase tracking-[0.08em] font-bold">
                {overdueCount > 0 && <span className="text-[#D45555]">▴ {overdueCount} overdue</span>}
                {todayCount > 0 && <span className="text-[#CC7D5E]">● {todayCount} today</span>}
              </div>
            )}
          </div>

          {/* ─── Filter strip — each row only when some task carries that
                 metadata; for plain checklists both rows are pure noise ── */}
          {(hasPriorities || hasDueDates) && (
            <div className="flex flex-col gap-2 mb-3">
              {hasPriorities && renderFilterRow<typeof PRIORITY_OPTIONS[number]>('Priority', PRIORITY_OPTIONS, priorityFilter, setPriorityFilter)}
              {hasDueDates && renderFilterRow<typeof DUE_OPTIONS[number]>('Due', DUE_OPTIONS, dueDateFilter, setDueDateFilter)}
            </div>
          )}
        </>
      )}

      {filteredActiveTasks.length === 0 && activeTasks.length > 0 && (
        <div className={`text-center mt-6 text-sm ${dim}`}>No tasks match the current filter.</div>
      )}

      {/* ─── Active task rows ────────────────────────────────────────── */}
      {filteredActiveTasks.length > 0 && (
        <div>
          {filteredActiveTasks.slice(0, activePageSize).map(task => {
            const dueDateStatus = getDueDateStatus(task.dueDate);
            const isOverdue = dueDateStatus === 'overdue';
            const isToday = dueDateStatus === 'today';
            const isSoon = dueDateStatus === 'soon';
            const railColor = priorityRailColor(task.priority);
            return (
              <div key={task.id}
                 className={`group relative flex items-start gap-2.5 py-1.5 transition-colors ${rowHover}`}>
                {railColor && (
                  <span className={`absolute -left-2 top-2 bottom-2 w-[2px] rounded-full ${railColor}`} title={task.priority} />
                )}
                <div className="flex items-center h-[21px] shrink-0">
                  <button onClick={() => onToggleTask(task)} className="p-1 -m-1 rounded-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CC7D5E]/60 active:opacity-70" aria-label="Complete task">
                    <div className={`w-[16px] h-[16px] rounded-[4px] border transition-colors hover:border-[#CC7D5E] hover:bg-[#CC7D5E]/10 ${checkboxBorder}`} />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`block text-sm leading-[1.5] ${txt}`}>{task.content}</span>
                  <button onClick={() => onNavigateToNoteById(task.noteId, task.lineIndex)}
                    aria-label={`Open source note: ${task.noteTitle}`}
                    title={task.noteTitle}
                    className={`absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-1 transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#CC7D5E]/60 hover:text-[#CC7D5E] active:opacity-70 ${noteLink}`}>
                    <ExternalLink size={11} />
                  </button>
                  {task.dueDate && (
                    <div className={`mt-0.5 text-[11px] tabular-nums font-bold ${
                      isOverdue ? 'text-[#D45555]' : isToday ? 'text-[#CC7D5E]' : isSoon ? 'text-[#CC7D5E]' : dim
                    }`}>
                      {isOverdue ? '⚠ ' : isToday ? '● ' : '→ '}{task.dueDate}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filteredActiveTasks.length > activePageSize && (
            <button onClick={() => setActivePageSize(s => s + TASKS_PAGE_SIZE)}
              className={`w-full text-[11px] uppercase tracking-[0.08em] py-1 mt-2 border border-dashed transition-colors font-redaction ${showMoreBtn}`}>
              Show more ({filteredActiveTasks.length - activePageSize} remaining)
            </button>
          )}
        </div>
      )}

      {/* ─── Completed section ───────────────────────────────────────── */}
      {completedTasks.length > 0 && (
        <div className="mt-5">
          <button
            onClick={() => setCompletedExpanded(v => { lsSetBoolean(STORAGE_KEYS.TASKS_COMPLETED_EXPANDED, !v); return !v; })}
            className="flex items-center gap-2 mb-1 w-full group/comp active:opacity-70"
            aria-expanded={completedExpanded}
          >
            <ChevronRight
              size={11}
              className={`shrink-0 transition-transform ${dimmer} ${completedExpanded ? 'rotate-90' : ''}`}
            />
            <span className={`text-[11px] uppercase tracking-[0.25em] font-bold shrink-0 ${dimmer}`}>Completed</span>
            <span className={`text-[11px] tabular-nums shrink-0 ${dimmer}`}>· {completedTasks.length}</span>
          </button>
          {completedExpanded && (
          <div>
            {completedTasks.slice(0, completedPageSize).map(task => {
              const railColor = priorityRailColor(task.priority);
              return (
                <div key={task.id} className="group relative flex items-start gap-2.5 py-1.5 opacity-50 hover:opacity-80 transition-opacity">
                  {railColor && (
                    <span className={`absolute -left-2 top-2 bottom-2 w-[2px] rounded-full ${railColor}`} title={task.priority} />
                  )}
                  <div className="flex items-center h-[21px] shrink-0">
                    <button onClick={() => onToggleTask(task)} className="p-1 -m-1 rounded-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CC7D5E]/60 active:opacity-70" aria-label="Reopen task">
                      <div className={`w-[15px] h-[15px] rounded-[4px] border flex items-center justify-center ${checkboxBorderDone} ${checkboxBgDone}`}>
                        <Check size={10} weight="bold" className={checkmarkColor} />
                      </div>
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`block text-sm leading-[1.5] line-through ${txt}`}>{task.content}</span>
                    <button onClick={() => onNavigateToNoteById(task.noteId, task.lineIndex)}
                      aria-label={`Open source note: ${task.noteTitle}`}
                      title={task.noteTitle}
                      className={`absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-1 transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#CC7D5E]/60 hover:text-[#CC7D5E] active:opacity-70 ${noteLink}`}>
                      <ExternalLink size={11} />
                    </button>
                    {task.dueDate && (
                      <div className={`mt-0.5 text-[11px] tabular-nums ${dim}`}>→ {task.dueDate}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {completedTasks.length > completedPageSize && (
              <button onClick={() => setCompletedPageSize(s => s + TASKS_PAGE_SIZE)}
                className={`w-full text-[11px] uppercase tracking-[0.08em] py-1 mt-2 border border-dashed transition-colors font-redaction ${showMoreBtn}`}>
                Show more ({completedTasks.length - completedPageSize} remaining)
              </button>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
});
