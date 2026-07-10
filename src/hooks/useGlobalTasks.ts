import { useMemo, useRef } from 'react';
import { GlobalTask, Note } from '../types';
import { parseTasksFromNotes } from '../lib/taskParser';

// Global task list derived from notes. parseTasksFromNotes caches per-note
// results by object identity, so only edited notes re-parse; on top of that,
// keep the previous array when every task is unchanged so memoized consumers
// (TasksPanel) can skip re-rendering entirely.
export function useGlobalTasks(notes: Note[]): GlobalTask[] {
  const prevRef = useRef<GlobalTask[]>([]);
  return useMemo(() => {
    const next = parseTasksFromNotes(notes);
    const prev = prevRef.current;
    if (prev.length === next.length && next.every((task, i) => task === prev[i])) {
      return prev;
    }
    prevRef.current = next;
    return next;
  }, [notes]);
}
