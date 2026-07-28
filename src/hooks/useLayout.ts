import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_RIGHT_TAB, isRightTab, RightTab } from '../constants/rightTabs';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { lsGet, lsSet } from '../lib/safeLocalStorage';
import { useResizeDrag } from './useResizeDrag';

export function useLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = lsGet(STORAGE_KEYS.SIDEBAR_OPEN);
    return saved !== null ? saved === 'true' : true;
  });
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    const saved = lsGet(STORAGE_KEYS.RIGHT_PANEL_OPEN);
    return saved !== null ? saved === 'true' : true;
  });
  const [activeRightTab, setActiveRightTab] = useState<RightTab>(() => {
    const saved = lsGet(STORAGE_KEYS.RIGHT_TAB);
    return isRightTab(saved) ? saved : DEFAULT_RIGHT_TAB;
  });
  const [editorViewMode, setEditorViewMode] = useState<'edit' | 'preview' | 'split'>(() => {
    const saved = lsGet(STORAGE_KEYS.EDITOR_VIEW_MODE);
    const valid = ['edit', 'preview', 'split'] as const;
    return saved !== null && (valid as readonly string[]).includes(saved)
      ? (saved as 'edit' | 'preview' | 'split')
      : 'split';
  });

  // Single clamp for both pointer drag and keyboard nudge (min 310,
  // max min(480, 35vw)) — the two input paths must never diverge.
  const clampPanelWidth = useCallback(
    (v: number) => Math.max(310, Math.min(v, Math.min(480, window.innerWidth * 0.35))),
    []
  );

  const getSidebarValue = useCallback((e: MouseEvent) => {
    return Math.min(e.clientX, Math.min(480, window.innerWidth * 0.35));
  }, []);

  const getRightPanelValue = useCallback((e: MouseEvent) => {
    return Math.min(window.innerWidth - e.clientX, Math.min(480, window.innerWidth * 0.35));
  }, []);

  const previewSidebarWidth = useCallback((size: number) => {
    document.documentElement.style.setProperty('--noa-sidebar-width', `${size}px`);
  }, []);
  const previewRightPanelWidth = useCallback((size: number) => {
    document.documentElement.style.setProperty('--noa-right-panel-width', `${size}px`);
  }, []);

  const {
    size: sidebarWidth,
    setSize: setSidebarWidth,
    isDragging: isDraggingSidebar,
    setIsDragging: setIsDraggingSidebar,
  } = useResizeDrag(310, 310, 480, getSidebarValue, 'col-resize', previewSidebarWidth);
  const {
    size: rightPanelWidth,
    setSize: setRightPanelWidth,
    isDragging: isDraggingRightPanel,
    setIsDragging: setIsDraggingRightPanel,
  } = useResizeDrag(310, 310, 480, getRightPanelValue, 'col-resize', previewRightPanelWidth);

  // Keyboard path for the separator handles — shares clampPanelWidth with
  // the drag handlers above so mouse and keyboard can never disagree.
  const nudgeSidebarWidth = useCallback(
    (delta: number) => setSidebarWidth(w => clampPanelWidth(w + delta)),
    [clampPanelWidth, setSidebarWidth]
  );
  const nudgeRightPanelWidth = useCallback(
    (delta: number) => setRightPanelWidth(w => clampPanelWidth(w + delta)),
    [clampPanelWidth, setRightPanelWidth]
  );

  useEffect(() => {
    previewSidebarWidth(sidebarWidth);
    previewRightPanelWidth(rightPanelWidth);
  }, [previewSidebarWidth, previewRightPanelWidth, rightPanelWidth, sidebarWidth]);

  const wasMobileRef = useRef(false);
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile && !wasMobileRef.current) {
        // Entering mobile: close panels
        setIsSidebarOpen(false);
        setIsRightPanelOpen(false);
      } else if (!mobile && wasMobileRef.current) {
        // Returning to desktop: restore from localStorage
        const sb = lsGet(STORAGE_KEYS.SIDEBAR_OPEN);
        const rp = lsGet(STORAGE_KEYS.RIGHT_PANEL_OPEN);
        setIsSidebarOpen(sb !== null ? sb === 'true' : true);
        setIsRightPanelOpen(rp !== null ? rp === 'true' : true);
      }
      wasMobileRef.current = mobile;
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    lsSet(STORAGE_KEYS.SIDEBAR_OPEN, String(isSidebarOpen));
    lsSet(STORAGE_KEYS.RIGHT_PANEL_OPEN, String(isRightPanelOpen));
    lsSet(STORAGE_KEYS.RIGHT_TAB, activeRightTab);
    lsSet(STORAGE_KEYS.EDITOR_VIEW_MODE, editorViewMode);
  }, [isSidebarOpen, isRightPanelOpen, activeRightTab, editorViewMode]);

  const [isFocusMode, setIsFocusMode] = useState(false);
  const toggleFocusMode = useCallback(() => setIsFocusMode(v => !v), []);
  const exitFocusMode = useCallback(() => setIsFocusMode(false), []);

  return {
    isMobile,
    isSidebarOpen,
    setIsSidebarOpen,
    isRightPanelOpen,
    setIsRightPanelOpen,
    activeRightTab,
    setActiveRightTab,
    sidebarWidth,
    rightPanelWidth,
    isDraggingSidebar,
    isDraggingRightPanel,
    setIsDraggingSidebar,
    setIsDraggingRightPanel,
    nudgeSidebarWidth,
    nudgeRightPanelWidth,
    editorViewMode,
    setEditorViewMode,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
  };
}
