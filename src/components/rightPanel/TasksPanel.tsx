import React, { useMemo, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { GlobalTask } from '../../types';

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

export function TasksPanel({ tasks, onToggleTask, onNavigateToNoteById }: TasksPanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [dueDateFilter, setDueDateFilter] = useState<'all' | 'today' | 'week' | 'overdue'>('all');

  const { activeTasks, completedTasks } = useMemo(() => {
    const activeTasks: typeof tasks = [];
    const completedTasks: typeof tasks = [];
    for (const t of tasks) {
      if (t.completed) completedTasks.push(t);
      else activeTasks.push(t);
    }
    return { activeTasks, completedTasks };
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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 font-redaction">
      {tasks.length === 0 && (
        <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">
          No tasks found.<br />Add "- [ ] task" in any note!
        </div>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1.5 pb-3 border-b border-[#2D2D2D]/20">
          <div className="flex gap-1">
            {(['all', 'high', 'medium', 'low'] as const).map(p => (
              <button key={p} onClick={() => setPriorityFilter(p)}
                className={`flex-1 text-[10px] uppercase tracking-wider border px-1 py-0.5 font-bold font-redaction active:opacity-70 transition-colors ${priorityFilter === p ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}>
                {p === 'all' ? 'All' : p}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['all', 'today', 'week', 'overdue'] as const).map(d => (
              <button key={d} onClick={() => setDueDateFilter(d)}
                className={`flex-1 text-[10px] uppercase tracking-wider border px-1 py-0.5 font-bold font-redaction active:opacity-70 transition-colors ${dueDateFilter === d ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}>
                {d === 'all' ? 'All' : d === 'today' ? 'Today' : d === 'week' ? 'Week' : 'Late'}
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredActiveTasks.length === 0 && activeTasks.length > 0 && (
        <div className="text-center text-[#2D2D2D]/50 mt-6 text-sm">No tasks match the current filter.</div>
      )}

      {filteredActiveTasks.length > 0 && (
        <div className="space-y-1">
          {filteredActiveTasks.map(task => (
            <div key={task.id} className="group flex flex-col px-2 py-1.5 border border-[#2D2D2D]/15 hover:border-[#2D2D2D]/30 hover:bg-[#DCD9CE]/30 transition-colors">
              <div className="flex items-start gap-2">
                <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 active:opacity-70">
                  <div className="w-3.5 h-3.5 border border-[#2D2D2D]/35 hover:border-[#B89B5E] transition-colors" />
                </button>
                <span className="flex-1 text-xs font-redaction leading-snug text-[#2D2D2D]">{task.content}</span>
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
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className="pt-3 border-t border-[#2D2D2D]/15">
          <div className="text-[10px] uppercase tracking-widest text-[#2D2D2D]/30 font-redaction pb-1">
            Completed ({completedTasks.length})
          </div>
          <div className="space-y-1">
            {completedTasks.map(task => (
              <div key={task.id} className="group flex flex-col px-2 py-1.5 border border-[#2D2D2D]/10 opacity-45 hover:opacity-70 transition-opacity">
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
          </div>
        </div>
      )}
    </div>
  );
}
