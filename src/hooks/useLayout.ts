import { useState, useEffect, useCallback } from 'react';
import { useResizeDrag } from './useResizeDrag';

export function useLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('app-sidebar-open');
    return saved ? saved === 'true' : true;
  });
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(() => {
    const saved = localStorage.getItem('app-right-panel-open');
    return saved ? saved === 'true' : true;
  });
  const [activeRightTab, setActiveRightTab] = useState<'tasks' | 'backlinks' | 'graph'>(() => {
    const saved = localStorage.getItem('app-right-tab');
    return (['tasks', 'backlinks', 'graph'] as const).includes(saved as 'tasks' | 'backlinks' | 'graph')
      ? (saved as 'tasks' | 'backlinks' | 'graph')
      : 'tasks';
  });
  const [editorViewMode, setEditorViewMode] = useState<'edit' | 'preview' | 'split'>(() => {
    const saved = localStorage.getItem('app-editor-view-mode');
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
      localStorage.setItem('app-sidebar-open', JSON.stringify(isSidebarOpen));
      localStorage.setItem('app-right-panel-open', JSON.stringify(isRightPanelOpen));
      localStorage.setItem('app-right-tab', activeRightTab);
      localStorage.setItem('app-editor-view-mode', editorViewMode);
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
