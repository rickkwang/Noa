import { useMemo, useRef } from 'react';
import { parseTasksFromNotes } from '../lib/taskParser';
import { GlobalTask, Note } from '../types';

// Per-note parse cache (by object identity) plus reuse of the previous array when unchanged, so TasksPanel can skip renders.
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
