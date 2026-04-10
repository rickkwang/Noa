import { useState, useEffect, useCallback } from 'react';
import { useResizeDrag } from './useResizeDrag';
import { STORAGE_KEYS } from '../constants/storageKeys';

export function useLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try { const saved = localStorage.getItem(STORAGE_KEYS.SIDEBAR_OPEN); return saved ? saved === 'true' : true; } catch { return true; }
  });
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    try { const saved = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_OPEN); return saved ? saved === 'true' : true; } catch { return true; }
  });
  const [activeRightTab, setActiveRightTab] = useState<'tasks' | 'backlinks' | 'graph' | 'properties'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RIGHT_TAB);
      const valid = ['tasks', 'backlinks', 'graph', 'properties'] as const;
      return saved !== null && (valid as readonly string[]).includes(saved)
        ? (saved as 'tasks' | 'backlinks' | 'graph' | 'properties')
        : 'tasks';
    } catch { return 'tasks'; }
  });
  const [editorViewMode, setEditorViewMode] = useState<'edit' | 'preview' | 'split'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EDITOR_VIEW_MODE);
      const valid = ['edit', 'preview', 'split'] as const;
      return saved !== null && (valid as readonly string[]).includes(saved)
        ? (saved as 'edit' | 'preview' | 'split')
        : 'split';
    } catch { return 'split'; }
  });

  const getSidebarValue = useCallback((e: MouseEvent) => {
    const maxWidth = Math.min(480, window.innerWidth * 0.35);
    return Math.min(e.clientX, maxWidth);
  }, []);

  const getRightPanelValue = useCallback((e: MouseEvent) => {
    const maxWidth = Math.min(480, window.innerWidth * 0.35);
    return Math.min(window.innerWidth - e.clientX, maxWidth);
  }, []);

  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingRightPanel, setIsDraggingRightPanel] = useState(false);
  const { size: sidebarWidth, setIsDragging: _setIsDraggingSidebar } = useResizeDrag(280, 280, 480, getSidebarValue);
  const { size: rightPanelWidth, setIsDragging: _setIsDraggingRightPanel } = useResizeDrag(320, 320, 480, getRightPanelValue);

  const handleSetIsDraggingSidebar = useCallback((v: boolean) => {
    setIsDraggingSidebar(v);
    _setIsDraggingSidebar(v);
  }, [_setIsDraggingSidebar]);

  const handleSetIsDraggingRightPanel = useCallback((v: boolean) => {
    setIsDraggingRightPanel(v);
    _setIsDraggingRightPanel(v);
  }, [_setIsDraggingRightPanel]);

  useEffect(() => {
    let wasMobile = false;
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile && !wasMobile) {
        // Entering mobile: close panels
        setIsSidebarOpen(false);
        setIsRightPanelOpen(false);
      } else if (!mobile && wasMobile) {
        // Returning to desktop: restore from localStorage
        try {
          const sb = localStorage.getItem(STORAGE_KEYS.SIDEBAR_OPEN);
          const rp = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_OPEN);
          setIsSidebarOpen(sb ? sb === 'true' : true);
          setIsRightPanelOpen(rp ? rp === 'true' : true);
        } catch { /* ignore */ }
      }
      wasMobile = mobile;
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_OPEN, String(isSidebarOpen));
      localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL_OPEN, String(isRightPanelOpen));
      localStorage.setItem(STORAGE_KEYS.RIGHT_TAB, activeRightTab);
      localStorage.setItem(STORAGE_KEYS.EDITOR_VIEW_MODE, editorViewMode);
    } catch { /* storage full, ignore */ }
  }, [isSidebarOpen, isRightPanelOpen, activeRightTab, editorViewMode]);

  const openGraphView = useCallback(() => {
    setIsRightPanelOpen(true);
    setActiveRightTab('graph');
  }, []);

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
    openGraphView,
    sidebarWidth,
    rightPanelWidth,
    isDraggingSidebar,
    isDraggingRightPanel,
    setIsDraggingSidebar: handleSetIsDraggingSidebar,
    setIsDraggingRightPanel: handleSetIsDraggingRightPanel,
    editorViewMode,
    setEditorViewMode,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
  };
}
