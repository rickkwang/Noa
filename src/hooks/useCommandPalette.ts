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
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

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
    close,
    run,
  };
}
