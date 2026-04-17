import { useState, useEffect, useCallback, useRef } from 'react';
import { useResizeDrag } from './useResizeDrag';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { DEFAULT_RIGHT_TAB, isRightTab, RightTab } from '../constants/rightTabs';
import { lsGet, lsSet } from '../lib/safeLocalStorage';

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
