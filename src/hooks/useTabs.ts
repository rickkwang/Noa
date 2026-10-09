import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { addTabId, MAX_OPEN_TABS, moveTabId, removeTabAndPickNext } from '../lib/tabUtils';
import type { Note } from '../types';

const OPEN_TABS_KEY = STORAGE_KEYS.OPEN_TABS;

// Fallbacks for when animationend never fires; kept just past TAB_ANIM_MS in EditorHeader.
const TAB_ENTER_FALLBACK_MS = 190;
const TAB_EXIT_FALLBACK_MS = 220;

interface UseTabsOptions {
  notes: Note[];
  isLoaded: boolean;
  activeNoteId: string;
  setActiveNoteId: (id: string) => void;
}

export function useTabs({ notes, isLoaded, activeNoteId, setActiveNoteId }: UseTabsOptions) {
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  // Entering tabs are a set (like closingTabIds): a single slot let a second open strip the first tab's animation mid-flight.
  // Value: the tab active when this one opened, used to suppress the adjacent divider during the entrance.
  const [enteringTabs, setEnteringTabs] = useState<Map<string, string | null>>(() => new Map());
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set());
  const [tabLimitWarning, setTabLimitWarning] = useState(false);
  const restoredOpenTabsRef = useRef(false);
  const openTabIdsRef = useRef<string[]>([]);
  const activeNoteIdRef = useRef('');
  const enteringTabTimeoutsRef = useRef<Map<string, number>>(new Map());
  const closingTabTimeoutsRef = useRef<Map<string, number>>(new Map());
  const tabLimitWarningTimeoutRef = useRef<number | null>(null);

  useEffect(() => { activeNoteIdRef.current = activeNoteId; }, [activeNoteId]);

  const clearEnteringTab = useCallback((id: string) => {
    const timeoutId = enteringTabTimeoutsRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      enteringTabTimeoutsRef.current.delete(id);
    }
    setEnteringTabs((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const closeTabById = useCallback((id: string) => {
    const current = openTabIdsRef.current;
    const idx = current.indexOf(id);
    if (idx === -1) {
      setClosingTabIds((prev) => {
        if (!prev.has(id)) return prev;
        const nextClosing = new Set(prev);
        nextClosing.delete(id);
        return nextClosing;
      });
      return;
    }

    const closeTimeout = closingTabTimeoutsRef.current.get(id);
    if (closeTimeout !== undefined) {
      window.clearTimeout(closeTimeout);
      closingTabTimeoutsRef.current.delete(id);
    }

    const { next, nextActive } = removeTabAndPickNext(current, id, activeNoteIdRef.current);
    openTabIdsRef.current = next;
    // A tab closed mid-entrance leaves the strip; drop its entrance bookkeeping
    // so the pending reset timer can't fire against a tab that no longer exists.
    clearEnteringTab(id);
    setClosingTabIds((prev) => {
      if (!prev.has(id)) return prev;
      const nextClosing = new Set(prev);
      nextClosing.delete(id);
      return nextClosing;
    });
    setOpenTabIds(next);
    if (nextActive !== null) {
      setActiveNoteId(nextActive);
    }
  }, [clearEnteringTab, setActiveNoteId]);

  // Restore openTabIds from localStorage after notes load
  useEffect(() => {
    if (!isLoaded || restoredOpenTabsRef.current) return;
    restoredOpenTabsRef.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem(OPEN_TABS_KEY); } catch { /* quota exceeded */ }
    if (!saved) return;
    try {
      const ids: string[] = JSON.parse(saved);
      const validIds = ids.filter(id => notes.some(n => n.id === id)).slice(-MAX_OPEN_TABS);
      if (validIds.length > 0) {
        openTabIdsRef.current = validIds;
        setOpenTabIds(validIds);
      }
    } catch { /* ignore */ }
  }, [isLoaded, notes]);

  useEffect(() => {
    if (!isLoaded) return;
    const validIds = new Set(notes.map(note => note.id));
    for (const id of openTabIdsRef.current) {
      if (!validIds.has(id)) closeTabById(id);
    }
  }, [isLoaded, notes, closeTabById]);

  // Persist openTabIds to localStorage (debounced — tabs open/close rapidly)
  useEffect(() => {
    if (!isLoaded) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabIds));
      } catch { /* quota exceeded — ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [isLoaded, openTabIds]);

  // Keep openTabIdsRef in sync for use in other effects
  useEffect(() => {
    openTabIdsRef.current = openTabIds;
  }, [openTabIds]);

  const showTabLimitWarning = useCallback(() => {
    setTabLimitWarning(true);
    if (tabLimitWarningTimeoutRef.current !== null) {
      window.clearTimeout(tabLimitWarningTimeoutRef.current);
    }
    tabLimitWarningTimeoutRef.current = window.setTimeout(() => {
      setTabLimitWarning(false);
      tabLimitWarningTimeoutRef.current = null;
    }, 3000);
  }, []);

  const markEnteringTab = useCallback((id: string, fromId: string | null) => {
    // Reduced motion disables the enter keyframes, so flagging the tab would leave it squeezed until the fallback fires.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setEnteringTabs((prev) => {
      if (prev.has(id) && prev.get(id) === fromId) return prev;
      const next = new Map(prev);
      next.set(id, fromId);
      return next;
    });
    const existing = enteringTabTimeoutsRef.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    enteringTabTimeoutsRef.current.set(id, window.setTimeout(() => {
      enteringTabTimeoutsRef.current.delete(id);
      clearEnteringTab(id);
    }, TAB_ENTER_FALLBACK_MS));
  }, [clearEnteringTab]);

  const openTabForNote = useCallback((id: string, animate: boolean) => {
    const wasOpen = openTabIdsRef.current.includes(id);
    const hadTabs = openTabIdsRef.current.length > 0;
    if (!wasOpen && openTabIdsRef.current.length >= MAX_OPEN_TABS) {
      showTabLimitWarning();
    }
    setOpenTabIds((prev) => {
      const next = addTabId(prev, id);
      if (next !== prev) openTabIdsRef.current = next;
      return next;
    });
    if (animate && !wasOpen && hadTabs) {
      markEnteringTab(id, activeNoteIdRef.current || null);
    }
  }, [markEnteringTab, showTabLimitWarning]);

  useEffect(() => () => {
    if (tabLimitWarningTimeoutRef.current !== null) {
      window.clearTimeout(tabLimitWarningTimeoutRef.current);
    }
    enteringTabTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    enteringTabTimeoutsRef.current.clear();
    closingTabTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    closingTabTimeoutsRef.current.clear();
  }, []);

  // Sync activeNoteId into openTabIds; a genuinely new tab animates in, matching the "+" button.
  useEffect(() => {
    if (!activeNoteId) return;
    openTabForNote(activeNoteId, true);
  }, [activeNoteId, openTabForNote]);

  const handleTabClose = useCallback((id: string) => {
    const current = openTabIdsRef.current;
    const idx = current.indexOf(id);
    if (idx === -1 || closingTabIds.has(id)) return;

    // With no neighboring tab to reveal, an exit animation only leaves an
    // empty tab strip behind. Close the final tab in one state change instead.
    if (current.length === 1) {
      closeTabById(id);
      return;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      closeTabById(id);
      return;
    }

    const { nextActive } = removeTabAndPickNext(current, id, activeNoteIdRef.current);
    // Switch to the neighbor immediately but never clear the selection here —
    // when the last tab closes, closeTabById clears it after the animation.
    if (nextActive) {
      setActiveNoteId(nextActive);
    }

    setClosingTabIds((prev) => {
      if (prev.has(id)) return prev;
      const nextClosing = new Set(prev);
      nextClosing.add(id);
      return nextClosing;
    });

    const timeoutId = window.setTimeout(() => {
      closingTabTimeoutsRef.current.delete(id);
      closeTabById(id);
    }, TAB_EXIT_FALLBACK_MS);
    closingTabTimeoutsRef.current.set(id, timeoutId);
  }, [closeTabById, closingTabIds, setActiveNoteId]);

  const handleTabCloseAnimationComplete = useCallback((id: string) => {
    closeTabById(id);
  }, [closeTabById]);

  const handleTabEnterComplete = useCallback((id: string) => {
    clearEnteringTab(id);
  }, [clearEnteringTab]);

  const handleTabReorder = useCallback((sourceId: string, targetId: string, after: boolean) => {
    if (closingTabIds.has(sourceId) || closingTabIds.has(targetId)) return;
    const next = moveTabId(openTabIdsRef.current, sourceId, targetId, after);
    if (next === openTabIdsRef.current) return;
    openTabIdsRef.current = next;
    setOpenTabIds(next);
  }, [closingTabIds]);

  // Reuse the previous array when the visible tab set is unchanged; a fresh array per keystroke re-runs EditorHeader's layout effects.
  const openTabsRef = useRef<{ id: string; title: string }[]>([]);
  const openTabs = useMemo(() => {
    const titleById = new Map(notes.map(n => [n.id, n.title]));
    const next = openTabIds.flatMap(id => (titleById.has(id) ? [{ id, title: titleById.get(id) as string }] : []));
    const prev = openTabsRef.current;
    if (prev.length === next.length && prev.every((t, i) => t.id === next[i].id && t.title === next[i].title)) {
      return prev;
    }
    openTabsRef.current = next;
    return next;
  }, [openTabIds, notes]);

  const closingTabIdList = useMemo(() => Array.from(closingTabIds), [closingTabIds]);
  const enteringTabIdList = useMemo(() => Array.from(enteringTabs.keys()), [enteringTabs]);
  const enteringFromTabIdList = useMemo(
    () => Array.from(new Set(Array.from(enteringTabs.values()).filter((id): id is string => Boolean(id)))),
    [enteringTabs],
  );

  return {
    openTabs,
    enteringTabIds: enteringTabIdList,
    enteringFromTabIds: enteringFromTabIdList,
    closingTabIds: closingTabIdList,
    tabLimitWarning,
    openTabForNote,
    closeTabById,
    handleTabClose,
    handleTabReorder,
    handleTabEnterComplete,
    handleTabCloseAnimationComplete,
  };
}
