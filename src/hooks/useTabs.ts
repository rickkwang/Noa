import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { addTabId, MAX_OPEN_TABS, removeTabAndPickNext } from '../lib/tabUtils';
import type { Note } from '../types';

const OPEN_TABS_KEY = STORAGE_KEYS.OPEN_TABS;

interface UseTabsOptions {
  notes: Note[];
  isLoaded: boolean;
  activeNoteId: string;
  setActiveNoteId: (id: string) => void;
}

export function useTabs({ notes, isLoaded, activeNoteId, setActiveNoteId }: UseTabsOptions) {
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [enteringTabId, setEnteringTabId] = useState<string | null>(null);
  const [enteringFromTabId, setEnteringFromTabId] = useState<string | null>(null);
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set());
  const [tabLimitWarning, setTabLimitWarning] = useState(false);
  const restoredOpenTabsRef = useRef(false);
  const openTabIdsRef = useRef<string[]>([]);
  const activeNoteIdRef = useRef('');
  const enteringTabIdRef = useRef<string | null>(null);
  const enteringTabResetRef = useRef<number | null>(null);
  const closingTabTimeoutsRef = useRef<Map<string, number>>(new Map());
  const tabLimitWarningTimeoutRef = useRef<number | null>(null);

  useEffect(() => { activeNoteIdRef.current = activeNoteId; }, [activeNoteId]);

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
  }, [setActiveNoteId]);

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
    // Mirror handleTabClose. Under reduced motion the enter keyframes are off,
    // so flagging the tab only leaves it squeezed (min-width:0) until the 190ms
    // fallback fires — animationend never arrives to clear it early. That pop is
    // worse than the motion it replaces.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    enteringTabIdRef.current = id;
    setEnteringTabId(id);
    setEnteringFromTabId(fromId);
    if (enteringTabResetRef.current !== null) {
      window.clearTimeout(enteringTabResetRef.current);
    }
    enteringTabResetRef.current = window.setTimeout(() => {
      if (enteringTabIdRef.current === id) {
        enteringTabIdRef.current = null;
        setEnteringTabId(null);
        setEnteringFromTabId(null);
      }
      if (enteringTabResetRef.current !== null) {
        enteringTabResetRef.current = null;
      }
    }, 190);
  }, []);

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
    if (enteringTabResetRef.current !== null) {
      window.clearTimeout(enteringTabResetRef.current);
    }
    if (tabLimitWarningTimeoutRef.current !== null) {
      window.clearTimeout(tabLimitWarningTimeoutRef.current);
    }
    closingTabTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    closingTabTimeoutsRef.current.clear();
  }, []);

  // Sync activeNoteId into openTabIds. Animate: openTabForNote only marks the
  // tab as entering when it's genuinely new and other tabs already exist, so
  // sidebar/search-opened notes get the same entrance as the "+" button.
  useEffect(() => {
    if (!activeNoteId) return;
    openTabForNote(activeNoteId, true);
  }, [activeNoteId, openTabForNote]);

  const handleTabClose = useCallback((id: string) => {
    const current = openTabIdsRef.current;
    const idx = current.indexOf(id);
    if (idx === -1 || closingTabIds.has(id)) return;

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
    }, 220);
    closingTabTimeoutsRef.current.set(id, timeoutId);
  }, [closeTabById, closingTabIds, setActiveNoteId]);

  const handleTabCloseAnimationComplete = useCallback((id: string) => {
    closeTabById(id);
  }, [closeTabById]);

  const handleTabEnterComplete = useCallback((id: string) => {
    if (enteringTabIdRef.current !== id) return;
    enteringTabIdRef.current = null;
    if (enteringTabResetRef.current !== null) {
      window.clearTimeout(enteringTabResetRef.current);
      enteringTabResetRef.current = null;
    }
    setEnteringTabId(null);
    setEnteringFromTabId(null);
  }, []);

  // Only ids and titles are rendered, but `notes` changes on every keystroke.
  // Handing EditorHeader a fresh array each time would re-run its layout
  // effects mid-typing — a smooth scrollIntoView restart plus a forced
  // scrollLeft/scrollWidth read per character. Reuse the previous array
  // whenever the visible tab set is unchanged.
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

  return {
    openTabs,
    enteringTabId,
    enteringFromTabId,
    closingTabIds: closingTabIdList,
    tabLimitWarning,
    openTabForNote,
    closeTabById,
    handleTabClose,
    handleTabEnterComplete,
    handleTabCloseAnimationComplete,
  };
}
