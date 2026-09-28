import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Note } from '../types';

type CommandItem = {
  id: string;
  label: string;
  action: () => void;
};

type UseCommandPaletteOptions = {
  notes: Note[];
  onCreateNote: () => void;
  onOpenDailyNote: () => void;
  onOpenSettings: () => void;
  onFocusSearch: () => void;
  onOpenNoteById: (id: string) => void;
};

export function useCommandPalette({
  notes,
  onCreateNote,
  onOpenDailyNote,
  onOpenSettings,
  onFocusSearch,
  onOpenNoteById,
}: UseCommandPaletteOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  // Index into `items` of the row Enter runs. Reset whenever the list is
  // rebuilt from a new query, so the highlight never points past the end.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setSelectedIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, [setQuery]);

  const run = useCallback((action: () => void) => {
    action();
    close();
  }, [close]);

  const items = useMemo(() => {
    const base: CommandItem[] = [
      { id: 'new-note', label: 'New note', action: onCreateNote },
      { id: 'open-daily-note', label: "Open today's daily note", action: onOpenDailyNote },
      { id: 'open-settings', label: 'Open settings', action: onOpenSettings },
      { id: 'focus-search', label: 'Focus search', action: onFocusSearch },
    ];

    const normalizedQuery = query.trim().toLowerCase();

    const filteredBase = normalizedQuery
      ? base.filter((item) => item.label.toLowerCase().includes(normalizedQuery))
      : base;

    const noteCommands: CommandItem[] = notes
      .filter((note) => !normalizedQuery || note.title.toLowerCase().includes(normalizedQuery))
      .slice(0, 8)
      .map((note) => ({
        id: `note-${note.id}`,
        label: `Open note: ${note.title}`,
        action: () => onOpenNoteById(note.id),
      }));

    return [...filteredBase, ...noteCommands];
  }, [notes, onCreateNote, onFocusSearch, onOpenDailyNote, onOpenNoteById, onOpenSettings, query]);

  // Wraps at both ends, like every other palette the user already knows.
  // Steps from the clamped index: the list can shrink while open (a note
  // deleted elsewhere) without a query change resetting the stored one.
  const moveSelection = useCallback((delta: number) => {
    setSelectedIndex((current) => {
      if (items.length === 0) return 0;
      const from = Math.min(current, items.length - 1);
      return (from + delta + items.length) % items.length;
    });
  }, [items.length]);

  const activeIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  return {
    isOpen,
    setIsOpen,
    query,
    setQuery,
    inputRef,
    items,
    selectedIndex: activeIndex,
    setSelectedIndex,
    moveSelection,
    close,
    run,
  };
}
