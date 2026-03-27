import { RefObject, useEffect } from 'react';

interface UseGlobalShortcutsOptions {
  searchQuery: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onCreateNote: () => void;
  onFocusSearch: () => void;
  onClearSearch: () => void;
}

export function useGlobalShortcuts({
  searchQuery,
  searchInputRef,
  onCreateNote,
  onFocusSearch,
  onClearSearch,
}: UseGlobalShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        onCreateNote();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        onFocusSearch();
      }

      if (
        e.key === 'Escape' &&
        searchQuery &&
        document.activeElement === searchInputRef.current
      ) {
        onClearSearch();
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClearSearch, onCreateNote, onFocusSearch, searchInputRef, searchQuery]);
}
