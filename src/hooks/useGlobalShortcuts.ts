import { RefObject, useEffect, useRef } from 'react';

interface UseGlobalShortcutsOptions {
  searchQuery: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onCreateNote: () => void;
  onOpenDailyNote: () => void;
  onOpenCommandPalette: () => void;
  onFocusSearch: () => void;
  onClearSearch: () => void;
  onForceSave?: () => void;
}

export function useGlobalShortcuts({
  searchQuery,
  searchInputRef,
  onCreateNote,
  onOpenDailyNote,
  onOpenCommandPalette,
  onFocusSearch,
  onClearSearch,
  onForceSave,
}: UseGlobalShortcutsOptions): void {
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onForceSave?.();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        onCreateNote();
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenDailyNote();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenCommandPalette();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        onFocusSearch();
      }

      if (
        e.key === 'Escape' &&
        searchQueryRef.current &&
        document.activeElement === searchInputRef.current
      ) {
        onClearSearch();
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClearSearch, onCreateNote, onFocusSearch, onForceSave, onOpenCommandPalette, onOpenDailyNote, searchInputRef]);
}
