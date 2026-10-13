import { RefObject, useEffect, useRef } from 'react';

interface UseGlobalShortcutsOptions {
  enabled?: boolean;
  searchQuery: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onCreateNote: () => void;
  onOpenDailyNote: () => void;
  onOpenCommandPalette: () => void;
  onFocusSearch: () => void;
  onClearSearch: () => void;
  onForceSave?: () => void;
  onToggleFocusMode?: () => void;
  isFocusMode?: boolean;
  onExitFocusMode?: () => void;
  onToggleViewMode?: () => void;
}

export function useGlobalShortcuts({
  enabled = true,
  searchQuery,
  searchInputRef,
  onCreateNote,
  onOpenDailyNote,
  onOpenCommandPalette,
  onFocusSearch,
  onClearSearch,
  onForceSave,
  onToggleFocusMode,
  isFocusMode,
  onExitFocusMode,
  onToggleViewMode,
}: UseGlobalShortcutsOptions): void {
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  useEffect(() => {
    if (!enabled) return;

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

      // Obsidian's Quick switcher (Mod+O) and Command palette (Mod+P) map to the same palette.
      // On macOS only Cmd counts: Ctrl+P is Emacs line-up in CodeMirror's default keymap.
      // Mod+P is the browser print shortcut, so preventDefault is required.
      const paletteMod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : (e.metaKey || e.ctrlKey);
      if (paletteMod && !e.shiftKey && (e.key.toLowerCase() === 'o' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        onOpenCommandPalette();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleFocusMode?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'f') {
        e.preventDefault();
        onFocusSearch();
      }

      // macOS only Cmd: Ctrl+E is line-end in CodeMirror's default keymap there.
      const viewToggleMod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (viewToggleMod && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        onToggleViewMode?.();
      }

      if (e.key === 'Escape') {
        if (isFocusMode) {
          onExitFocusMode?.();
          return;
        }
        if (searchQueryRef.current && document.activeElement === searchInputRef.current) {
          onClearSearch();
          searchInputRef.current?.blur();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClearSearch, onCreateNote, onFocusSearch, onForceSave, onOpenCommandPalette, onOpenDailyNote, onToggleFocusMode, onExitFocusMode, onToggleViewMode, isFocusMode, searchInputRef]);
}
