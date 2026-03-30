import { useState, useEffect, useCallback } from 'react';
import { useResizeDrag } from './useResizeDrag';
import { STORAGE_KEYS } from '../constants/storageKeys';

export function useLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SIDEBAR_OPEN);
    return saved ? saved === 'true' : true;
  });
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_OPEN);
    return saved ? saved === 'true' : true;
  });
  const [activeRightTab, setActiveRightTab] = useState<'tasks' | 'backlinks' | 'graph'>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RIGHT_TAB);
    return (['tasks', 'backlinks', 'graph'] as const).includes(saved as 'tasks' | 'backlinks' | 'graph')
      ? (saved as 'tasks' | 'backlinks' | 'graph')
      : 'tasks';
  });
  const [editorViewMode, setEditorViewMode] = useState<'edit' | 'preview' | 'split'>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.EDITOR_VIEW_MODE);
    return (['edit', 'preview', 'split'] as const).includes(saved as 'edit' | 'preview' | 'split')
      ? (saved as 'edit' | 'preview' | 'split')
      : 'split';
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
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsSidebarOpen(false);
        setIsRightPanelOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_OPEN, JSON.stringify(isSidebarOpen));
      localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL_OPEN, JSON.stringify(isRightPanelOpen));
      localStorage.setItem(STORAGE_KEYS.RIGHT_TAB, activeRightTab);
      localStorage.setItem(STORAGE_KEYS.EDITOR_VIEW_MODE, editorViewMode);
    } catch { /* storage full, ignore */ }
  }, [isSidebarOpen, isRightPanelOpen, activeRightTab, editorViewMode]);

  const openGraphView = useCallback(() => {
    setIsRightPanelOpen(true);
    setActiveRightTab('graph');
  }, []);

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
  };
}
