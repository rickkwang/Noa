import React, { useMemo, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { GlobalTask } from '../../types';

function getDueDateStatus(dueDate: string | undefined): 'overdue' | 'today' | 'soon' | null {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  const diff = (due.getTime() - today.getTime()) / 86_400_000;
  if (diff <= 3) return 'soon';
  return null;
}

interface PriorityBadgeProps { priority: string }

const PRIORITY_STYLES: Record<string, string> = {
  high: 'border-red-400 text-red-500',
  medium: 'border-[#B89B5E] text-[#B89B5E]',
  low: 'border-[#2D2D2D]/40 text-[#2D2D2D]/60',
};

function PriorityBadge({ priority }: PriorityBadgeProps) {
  if (priority === 'none') return null;
  return (
    <span className={`text-[10px] uppercase tracking-wider border px-1 font-bold font-redaction ${PRIORITY_STYLES[priority] ?? ''}`}>
      {priority}
    </span>
  );
}

interface TasksPanelProps {
  tasks: GlobalTask[];
  onToggleTask: (task: GlobalTask) => void;
  onNavigateToNoteById: (id: string) => void;
}

const TASKS_PAGE_SIZE = 100;

export function TasksPanel({ tasks, onToggleTask, onNavigateToNoteById }: TasksPanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [dueDateFilter, setDueDateFilter] = useState<'all' | 'today' | 'week' | 'overdue'>('all');
  const [activePageSize, setActivePageSize] = useState(TASKS_PAGE_SIZE);
  const [completedPageSize, setCompletedPageSize] = useState(TASKS_PAGE_SIZE);

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
        const due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 font-redaction">
      {tasks.length === 0 && (
        <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">
          No tasks found.<br />Add "- [ ] task" in any note!
        </div>
      )}

      {tasks.length > 0 && (
        <>
          {/* 完成进度条 */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-[#2D2D2D]/50 uppercase tracking-wider">
              <span>{completedTasks.length}/{total} done</span>
              <div className="flex items-center gap-2">
                {overdueCount > 0 && (
                  <span className="text-red-500 font-bold">{overdueCount} overdue</span>
                )}
                {todayCount > 0 && (
                  <span className="text-[#B89B5E] font-bold">{todayCount} due today</span>
                )}
              </div>
            </div>
            <div className="h-1 bg-[#2D2D2D]/10 w-full">
              <div
                className="h-1 bg-[#2D2D2D] transition-all duration-300"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>

          {/* 过滤器 */}
          <div className="flex flex-col gap-1.5 pb-3 border-b border-[#2D2D2D]/20">
            <div className="flex gap-1">
              {(['all', 'high', 'medium', 'low'] as const).map(p => (
                <button key={p} onClick={() => { setPriorityFilter(p); setActivePageSize(TASKS_PAGE_SIZE); }}
                  className={`flex-1 text-[10px] uppercase tracking-wider border px-1 py-0.5 font-bold font-redaction active:opacity-70 transition-colors ${priorityFilter === p ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['all', 'today', 'week', 'overdue'] as const).map(d => (
                <button key={d} onClick={() => { setDueDateFilter(d); setActivePageSize(TASKS_PAGE_SIZE); }}
                  className={`flex-1 text-[10px] uppercase tracking-wider border px-1 py-0.5 font-bold font-redaction active:opacity-70 transition-colors ${dueDateFilter === d ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}>
                  {d === 'all' ? 'All' : d === 'today' ? 'Today' : d === 'week' ? 'Week' : 'Late'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {filteredActiveTasks.length === 0 && activeTasks.length > 0 && (
        <div className="text-center text-[#2D2D2D]/50 mt-6 text-sm">No tasks match the current filter.</div>
      )}

      {filteredActiveTasks.length > 0 && (
        <div className="space-y-1">
          {filteredActiveTasks.slice(0, activePageSize).map(task => {
            const dueDateStatus = getDueDateStatus(task.dueDate);
            const isOverdue = dueDateStatus === 'overdue';
            const isToday = dueDateStatus === 'today';
            const isSoon = dueDateStatus === 'soon';
            return (
              <div key={task.id} className={`group flex flex-col px-2 py-1.5 border hover:bg-[#DCD9CE]/70 transition-colors ${isOverdue ? 'border-red-400 bg-red-50/30' : 'border-[#2D2D2D] bg-[#DCD9CE]/40'}`}>
                <div className="flex items-start gap-2">
                  <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 active:opacity-70">
                    <div className="w-3.5 h-3.5 border border-[#2D2D2D]/35 hover:border-[#B89B5E] transition-colors" />
                  </button>
                  <span className="flex-1 text-xs font-redaction leading-snug text-[#2D2D2D]">{task.content}</span>
                </div>
                <div className="flex items-center justify-between mt-1 pl-5 text-[10px] text-[#2D2D2D]/50">
                  <div className="flex items-center gap-x-2">
                    <PriorityBadge priority={task.priority} />
                    {task.dueDate && (
                      <span className={`tabular-nums font-bold ${isOverdue ? 'text-red-500' : isToday ? 'text-[#B89B5E]' : isSoon ? 'text-[#D97757]' : ''}`}>
                        {isOverdue ? '⚠ ' : isToday ? '● ' : ''}{task.dueDate}
                      </span>
                    )}
                  </div>
                  <button onClick={() => onNavigateToNoteById(task.noteId)}
                    className="flex items-center gap-1 hover:text-[#B89B5E] transition-colors active:opacity-70 shrink-0">
                    <ExternalLink size={9} />
                    <span>{task.noteTitle}</span>
                  </button>
                </div>
              </div>
            );
          })}
          {filteredActiveTasks.length > activePageSize && (
            <button
              onClick={() => setActivePageSize(s => s + TASKS_PAGE_SIZE)}
              className="w-full text-[10px] uppercase tracking-wider text-[#2D2D2D]/40 hover:text-[#2D2D2D] py-1 border border-dashed border-[#2D2D2D]/20 hover:border-[#2D2D2D]/40 transition-colors font-redaction"
            >
              Show more ({filteredActiveTasks.length - activePageSize} remaining)
            </button>
          )}
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className="pt-3 border-t border-[#2D2D2D]/15">
          <div className="text-[10px] uppercase tracking-widest text-[#2D2D2D]/30 font-redaction pb-1">
            Completed ({completedTasks.length})
          </div>
          <div className="space-y-1">
            {completedTasks.slice(0, completedPageSize).map(task => (
              <div key={task.id} className="group flex flex-col px-2 py-1.5 border border-[#2D2D2D]/25 bg-[#DCD9CE]/40 opacity-45 hover:opacity-70 transition-opacity">
                <div className="flex items-start gap-2">
                  <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 active:opacity-70">
                    <div className="w-3.5 h-3.5 border border-[#2D2D2D]/50 bg-[#2D2D2D]/20 flex items-center justify-center">
                      <Check size={9} strokeWidth={2.5} className="text-[#2D2D2D]" />
                    </div>
                  </button>
                  <span className="flex-1 text-xs font-redaction leading-snug line-through text-[#2D2D2D]">{task.content}</span>
                </div>
                <div className="flex items-center justify-between mt-1 pl-5 text-[10px] text-[#2D2D2D]/50">
                  <div className="flex items-center gap-x-2">
                    <PriorityBadge priority={task.priority} />
                    {task.dueDate && <span className="tabular-nums">{task.dueDate}</span>}
                  </div>
                  <button onClick={() => onNavigateToNoteById(task.noteId)}
                    className="flex items-center gap-1 hover:text-[#B89B5E] transition-colors active:opacity-70 shrink-0">
                    <ExternalLink size={9} />
                    <span>{task.noteTitle}</span>
                  </button>
                </div>
              </div>
            ))}
            {completedTasks.length > completedPageSize && (
              <button
                onClick={() => setCompletedPageSize(s => s + TASKS_PAGE_SIZE)}
                className="w-full text-[10px] uppercase tracking-wider text-[#2D2D2D]/40 hover:text-[#2D2D2D] py-1 border border-dashed border-[#2D2D2D]/20 hover:border-[#2D2D2D]/40 transition-colors font-redaction"
              >
                Show more ({completedTasks.length - completedPageSize} remaining)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
