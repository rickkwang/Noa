import { useEffect, useState } from 'react';

const MAX_ENTRIES = 50;

export type NoteHistory = ReturnType<typeof createNoteHistory>;

/**
 * Browser-style back/forward over opened notes. Lives outside React state so a note switch re-renders only the
 * buttons subscribed to it, not App. A switch the user made becomes a new entry; one the app made on its own (the
 * tab strip picking a neighbour after a close) overwrites the current entry, so Back never resurrects a closed tab.
 * Entries for notes no longer shown are skipped rather than pruned, so they come back with their workspace.
 */
export function createNoteHistory() {
  let entries: string[] = [];
  let index = -1;
  let shown = '';
  let replaceNext = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };

  const target = (dir: -1 | 1, liveIds: ReadonlySet<string>) => {
    // With no note shown (its tab was closed), Back reopens the entry the history is sitting on.
    const start = dir < 0 && entries[index] !== shown ? index : index + dir;
    for (let i = start; i >= 0 && i < entries.length; i += dir) {
      if (entries[i] !== shown && liveIds.has(entries[i])) return i;
    }
    return null;
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getVersion: () => version,
    /** Marks the coming switch to `id` as the app's own doing rather than a navigation. */
    replaceNext: (id: string) => {
      if (id !== shown) replaceNext = true;
    },
    show: (id: string) => {
      const replace = replaceNext;
      replaceNext = false;
      shown = id;
      if (!id || entries[index] === id) return emit();
      if (replace && index >= 0) {
        entries[index] = id;
      } else {
        entries = [...entries.slice(0, index + 1), id].slice(-MAX_ENTRIES);
        index = entries.length - 1;
      }
      emit();
    },
    can: (dir: -1 | 1, liveIds: ReadonlySet<string>) => target(dir, liveIds) !== null,
    go: (dir: -1 | 1, liveIds: ReadonlySet<string>, open: (id: string) => void) => {
      const i = target(dir, liveIds);
      if (i === null) return;
      index = i;
      emit();
      open(entries[i]);
    },
  };
}

/** One history per App, fed every change of the active note. */
export function useNoteHistory(activeNoteId: string | null | undefined): NoteHistory {
  const [history] = useState(createNoteHistory);
  useEffect(() => {
    history.show(activeNoteId ?? '');
  }, [activeNoteId, history]);
  return history;
}
