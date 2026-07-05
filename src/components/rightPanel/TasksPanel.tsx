import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, ExternalLink } from '@/src/lib/icons';
import { GlobalTask } from '../../types';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { lsGetBoolean, lsSetBoolean } from '../../lib/safeLocalStorage';

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
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
}

const TASKS_PAGE_SIZE = 100;

const PRIORITY_OPTIONS = ['all', 'high', 'medium', 'low'] as const;
const DUE_OPTIONS = ['all', 'today', 'week', 'overdue'] as const;
const DUE_DISPLAY: Record<string, string> = {
  all: 'all', today: 'today', week: 'week', overdue: 'late',
};

export function TasksPanel({ tasks, onToggleTask, onNavigateToNoteById, isDark = false }: TasksPanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<typeof PRIORITY_OPTIONS[number]>('all');
  const [dueDateFilter, setDueDateFilter] = useState<typeof DUE_OPTIONS[number]>('all');
  const [activePageSize, setActivePageSize] = useState(TASKS_PAGE_SIZE);
  const [completedPageSize, setCompletedPageSize] = useState(TASKS_PAGE_SIZE);
  const [completedExpanded, setCompletedExpanded] = useState(() => lsGetBoolean(STORAGE_KEYS.TASKS_COMPLETED_EXPANDED));

  const { activeTasks, completedTasks, overdueCount, todayCount } = useMemo(() => {
    const activeTasks: typeof tasks = [];
    const completedTasks: typeof tasks = [];
    let overdueCount = 0;
    let todayCount = 0;
    for (const t of tasks) {
      if (t.completed) {
        completedTasks.push(t);
      } else {
        activeTasks.push(t);
        const status = getDueDateStatus(t.dueDate);
        if (status === 'overdue') overdueCount++;
        if (status === 'today') todayCount++;
      }
    }
    return { activeTasks, completedTasks, overdueCount, todayCount };
  }, [tasks]);

  const filteredActiveTasks = useMemo(() => {
    if (priorityFilter === 'all' && dueDateFilter === 'all') return activeTasks;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return activeTasks.filter(task => {
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (dueDateFilter !== 'all') {
        if (!task.dueDate) return false;
        const due = parseLocalDueDate(task.dueDate);
        if (dueDateFilter === 'today' && due.getTime() !== today.getTime()) return false;
        if (dueDateFilter === 'week') {
          const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
          if (due < today || due > weekEnd) return false;
        }
        if (dueDateFilter === 'overdue' && due >= today) return false;
      }
      return true;
    });
  }, [activeTasks, priorityFilter, dueDateFilter]);

  const total = activeTasks.length + completedTasks.length;
  const completionPct = total > 0 ? Math.round((completedTasks.length / total) * 100) : 0;

  // ─── Theme tokens ──────────────────────────────────────────────────────
  const txt = isDark ? 'text-[#E8E0D0]' : 'text-[#2D2D2D]';
  const dim = isDark ? 'text-[rgba(232,224,208,0.5)]' : 'text-[#2D2D2D]/50';
  const dimmer = isDark ? 'text-[rgba(232,224,208,0.3)]' : 'text-[#2D2D2D]/30';
  const dimmest = isDark ? 'text-[rgba(232,224,208,0.18)]' : 'text-[#2D2D2D]/20';
  const rowBorder = isDark ? 'border-[rgba(232,224,208,0.06)]' : 'border-[#2D2D2D]/[0.06]';
  const rowHover = isDark ? 'hover:bg-[rgba(232,224,208,0.04)]' : 'hover:bg-[#DCD9CE]/35';
  const progressTrack = isDark ? 'bg-[rgba(232,224,208,0.1)]' : 'bg-[#2D2D2D]/8';
  const progressFill = isDark ? 'bg-[#E8E0D0]' : 'bg-[#2D2D2D]';
  const sectionLine = isDark ? 'bg-[rgba(232,224,208,0.12)]' : 'bg-[#2D2D2D]/12';
  const checkboxBorder = isDark ? 'border-[rgba(238,237,234,0.3)]' : 'border-[#2D2D2D]/35';
  const checkboxBorderDone = isDark ? 'border-[rgba(238,237,234,0.4)]' : 'border-[#2D2D2D]/50';
  const checkboxBgDone = isDark ? 'bg-[rgba(238,237,234,0.15)]' : 'bg-[#2D2D2D]/20';
  const checkmarkColor = isDark ? 'text-[#EEEDEA]' : 'text-[#2D2D2D]';
  const noteLink = isDark ? 'text-[rgba(232,224,208,0.3)]' : 'text-[#2D2D2D]/35';
  // Opaque panel bg for the hover-reveal source chip so it stays readable when it
  // floats over the end of a long task line. Matches RightPanel container bg.
  const chipBg = isDark ? 'bg-[#262624]' : 'bg-[#EAE8E0]';
  const showMoreBtn = isDark
    ? 'border-[rgba(238,237,234,0.15)] text-[rgba(238,237,234,0.3)] hover:border-[rgba(238,237,234,0.4)] hover:text-[rgba(238,237,234,0.6)]'
    : 'border-[#2D2D2D]/20 text-[#2D2D2D]/40 hover:border-[#2D2D2D]/40 hover:text-[#2D2D2D]';
  const lowRail = isDark ? 'bg-[rgba(232,224,208,0.25)]' : 'bg-[#2D2D2D]/25';

  // Task body & note titles → clean sans CJK (PingFang/system) instead of the
  // panel's Redaction→serif fallback, which renders Chinese thin and dated at 13px.
  const contentFont: React.CSSProperties = { fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' };

  function priorityRailColor(p: string): string | null {
    if (p === 'high') return 'bg-red-400';
    if (p === 'medium') return 'bg-[#CC7D5E]';
    if (p === 'low') return lowRail;
    return null;
  }

  function renderFilterRow<T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    onChange: (v: T) => void,
    displayMap?: Record<string, string>
  ) {
    return (
      <div className="flex items-baseline gap-3 text-[10px] uppercase tracking-wider font-bold font-redaction">
        <span className={`shrink-0 w-[58px] ${dimmer}`}>{label}</span>
        <div className="flex items-baseline flex-wrap">
          {options.map((opt, i) => (
            <React.Fragment key={opt}>
              <button
                onClick={() => { onChange(opt); setActivePageSize(TASKS_PAGE_SIZE); }}
                className={`transition-colors active:opacity-70 ${
                  value === opt
                    ? `${txt} underline decoration-2 underline-offset-[3px] decoration-[#CC7D5E]`
                    : `${dim} hover:opacity-80`
                }`}
              >
                {displayMap?.[opt] ?? opt}
              </button>
              {i < options.length - 1 && <span className={`mx-2 ${dimmest}`}>·</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 font-redaction ${txt}`}>
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
              <span className={`text-[10px] uppercase tracking-[0.25em] font-bold ${dimmer}`}>Tasks</span>
              <div className="flex items-baseline gap-1 tabular-nums text-[10px] font-semibold">
                <span className={txt}>{completedTasks.length}</span>
                <span className={dimmer}>/</span>
                <span className={dim}>{total}</span>
                <span className={dimmer}>·</span>
                <span className={dim}>{completionPct}%</span>
              </div>
            </div>
            <div className={`h-[2px] w-full ${progressTrack} relative`}>
              <div
                className={`absolute inset-y-0 left-0 ${progressFill} transition-all duration-500`}
                style={{ width: `${completionPct}%` }}
              />
            </div>
            {(overdueCount > 0 || todayCount > 0) && (
              <div className="flex items-center gap-3 mt-2 text-[10px] uppercase tracking-wider font-bold">
                {overdueCount > 0 && <span className="text-red-500">▴ {overdueCount} overdue</span>}
                {todayCount > 0 && <span className="text-[#CC7D5E]">● {todayCount} today</span>}
              </div>
            )}
          </div>

          {/* ─── Filter strip ────────────────────────────────────────── */}
          <div className="flex flex-col gap-2 mb-3">
            {renderFilterRow<typeof PRIORITY_OPTIONS[number]>('Priority', PRIORITY_OPTIONS, priorityFilter, setPriorityFilter)}
            {renderFilterRow<typeof DUE_OPTIONS[number]>('Due', DUE_OPTIONS, dueDateFilter, setDueDateFilter, DUE_DISPLAY)}
          </div>
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
                className={`group relative flex items-start gap-2.5 pl-3 pr-3 py-2 border-b transition-colors ${rowHover} ${rowBorder}`}>
                {railColor && (
                  <span className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${railColor}`} title={task.priority} />
                )}
                <div className="flex items-center h-[19px] shrink-0">
                  <button onClick={() => onToggleTask(task)} className="active:opacity-70" aria-label="Complete task">
                    <div className={`w-[15px] h-[15px] rounded-[4px] border transition-all hover:border-[#CC7D5E] hover:bg-[#CC7D5E]/10 ${checkboxBorder}`} />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <span style={contentFont} className={`block text-[13px] leading-[1.5] ${txt}`}>{task.content}</span>
                  <button onClick={() => onNavigateToNoteById(task.noteId)}
                    title={task.noteTitle}
                    className={`absolute top-2 right-2 flex items-center gap-0.5 px-1 rounded text-[10px] transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#CC7D5E] active:opacity-70 ${chipBg} ${noteLink}`}>
                    <ExternalLink size={9} />
                    <span style={contentFont} className="max-w-[12ch] truncate">{task.noteTitle}</span>
                  </button>
                  {task.dueDate && (
                    <div className={`mt-0.5 text-[10px] tabular-nums font-bold ${
                      isOverdue ? 'text-red-500' : isToday ? 'text-[#CC7D5E]' : isSoon ? 'text-[#CC7D5E]' : dim
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
              className={`w-full text-[10px] uppercase tracking-wider py-1 mt-2 border border-dashed transition-colors font-redaction ${showMoreBtn}`}>
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
            <span className={`text-[10px] uppercase tracking-[0.25em] font-bold shrink-0 ${dimmer}`}>Completed</span>
            <span className={`text-[10px] tabular-nums shrink-0 ${dimmer}`}>· {completedTasks.length}</span>
            <div className={`flex-1 h-px ${sectionLine}`} />
          </button>
          {completedExpanded && (
          <div>
            {completedTasks.slice(0, completedPageSize).map(task => {
              const railColor = priorityRailColor(task.priority);
              return (
                <div key={task.id} className={`group relative flex items-start gap-2.5 pl-3 pr-3 py-2 border-b opacity-50 hover:opacity-80 transition-opacity ${rowBorder}`}>
                  {railColor && (
                    <span className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${railColor}`} title={task.priority} />
                  )}
                  <div className="flex items-center h-[19px] shrink-0">
                    <button onClick={() => onToggleTask(task)} className="active:opacity-70" aria-label="Reopen task">
                      <div className={`w-[15px] h-[15px] rounded-[4px] border flex items-center justify-center ${checkboxBorderDone} ${checkboxBgDone}`}>
                        <Check size={10} weight="bold" className={checkmarkColor} />
                      </div>
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span style={contentFont} className={`block text-[13px] leading-[1.5] line-through ${txt}`}>{task.content}</span>
                    <button onClick={() => onNavigateToNoteById(task.noteId)}
                      title={task.noteTitle}
                      className={`absolute top-2 right-2 flex items-center gap-0.5 px-1 rounded text-[10px] transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#CC7D5E] active:opacity-70 ${chipBg} ${noteLink}`}>
                      <ExternalLink size={9} />
                      <span style={contentFont} className="max-w-[12ch] truncate">{task.noteTitle}</span>
                    </button>
                    {task.dueDate && (
                      <div className={`mt-0.5 text-[10px] tabular-nums ${dim}`}>→ {task.dueDate}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {completedTasks.length > completedPageSize && (
              <button onClick={() => setCompletedPageSize(s => s + TASKS_PAGE_SIZE)}
                className={`w-full text-[10px] uppercase tracking-wider py-1 mt-2 border border-dashed transition-colors font-redaction ${showMoreBtn}`}>
                Show more ({completedTasks.length - completedPageSize} remaining)
              </button>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
