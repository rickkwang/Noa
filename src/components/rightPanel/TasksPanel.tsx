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
        <div className="space-y-2">
          {filteredActiveTasks.map(task => (
            <div key={task.id} className="group flex flex-col p-2 border-2 border-[#2D2D2D] bg-[#EAE8E0] transition-all duration-150">
              <div className="flex items-start space-x-2">
                <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 cursor-pointer">
                  <div className="w-4 h-4 border-2 border-[#2D2D2D] bg-[#EAE8E0] hover:bg-[#DCD9CE] transition-all duration-150 active:bg-[#2D2D2D]/20" />
                </button>
                <span className="flex-1 text-sm leading-tight">{task.content}</span>
              </div>
              <div className="flex items-center justify-between mt-1.5 pl-6 text-xs text-[#2D2D2D]/60">
                <div className="flex items-center gap-x-2">
                  <PriorityBadge priority={task.priority} />
                  {task.dueDate && <span className="text-[10px] text-[#2D2D2D]/50 tabular-nums whitespace-nowrap">{task.dueDate}</span>}
                </div>
                <button onClick={() => onNavigateToNoteById(task.noteId)}
                  className="flex items-center space-x-1 hover:text-[#B89B5E] transition-colors cursor-pointer shrink-0">
                  <ExternalLink size={10} />
                  <span>{task.noteTitle}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className="space-y-2 pt-4 border-t border-[#2D2D2D]/20">
          <div className="text-[#2D2D2D]/40 text-xs font-bold mb-2 uppercase tracking-wider">
            Completed ({completedTasks.length})
          </div>
          {completedTasks.map(task => (
            <div key={task.id} className="group flex flex-col p-2 border border-[#2D2D2D]/20 opacity-50 transition-all duration-150">
              <div className="flex items-start space-x-2">
                <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 cursor-pointer">
                  <div className="w-4 h-4 border-2 border-[#2D2D2D]/60 bg-[#2D2D2D]/60 flex items-center justify-center text-[#EAE8E0]">
                    <Check size={12} strokeWidth={4} />
                  </div>
                </button>
                <span className="flex-1 text-sm leading-tight line-through text-[#2D2D2D]/50">{task.content}</span>
              </div>
              <div className="flex items-center justify-between mt-1.5 pl-6 text-xs text-[#2D2D2D]/40">
                <div className="flex items-center gap-x-2">
                  <PriorityBadge priority={task.priority} />
                  {task.dueDate && <span className="text-[10px] tabular-nums">{task.dueDate}</span>}
                </div>
                <button onClick={() => onNavigateToNoteById(task.noteId)}
                  className="flex items-center space-x-1 hover:text-[#B89B5E] transition-colors cursor-pointer shrink-0">
                  <ExternalLink size={10} />
                  <span>{task.noteTitle}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
