import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_RIGHT_TAB, isRightTab, RightTab } from '../constants/rightTabs';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { lsGet, lsSet } from '../lib/safeLocalStorage';
import { useResizeDrag } from './useResizeDrag';

const SIDEBAR_DEFAULT_WIDTH = 325;
const RIGHT_PANEL_DEFAULT_WIDTH = 340;
// Neither panel narrows below the width it opens at. A minimum under the
// default is a width the user can reach once and never get back to by dragging,
// and it puts the drag floor somewhere nothing in the UI explains. Both sides
// grow only, from the same width they start at.
export const SIDEBAR_MIN_WIDTH = SIDEBAR_DEFAULT_WIDTH;
export const RIGHT_PANEL_MIN_WIDTH = RIGHT_PANEL_DEFAULT_WIDTH;
// Exported so the resize handles report their real bounds through
// aria-valuemin/max instead of hand-copied literals. Both handles carried a
// number that had already gone stale against the width it described, and a
// screen reader announcing this range is the only place it is ever spoken.
export const PANEL_MAX_WIDTH = 480;
const PANEL_MAX_VIEWPORT_RATIO = 0.35;

// Every box that reads --noa-sidebar-width while a drag is running, paired with
// the declaration it resolves into. A pointermove already lands one value per
// frame; that value used to reach these boxes as a custom property on
// documentElement, and custom properties inherit — Blink invalidates style for
// everything that could inherit the write, which is the whole document, whether
// or not anything actually reads the property. Measured on this app: ~3.5ms of
// style recalc per dragged frame at 2.5k elements and ~13ms at 6k, which is
// where a vault of a thousand notes lands, because the sidebar list is not
// virtualised. Writing the resolved pixels onto these five costs 0.3-0.7ms at
// either size, since width and left do not inherit at all.
//
// Only the drag takes this path. The variable stays the source of truth
// everywhere else, and the end of the drag writes it before putting every
// declaration here back exactly as React left it.
const SIDEBAR_DRAG_TARGETS: ReadonlyArray<readonly [selector: string, property: string]> = [
  ['[data-sidebar-container]', 'width'],
  ['[data-sidebar-content-layer="true"]', 'width'],
  ['[data-sidebar-column-surface="true"]', 'width'],
  ['[data-sidebar-separator="true"]', 'left'],
  // The titlebar's hairline starts at the sidebar's edge from a pseudo-element,
  // and a pseudo can only read the variable from the element it hangs off — so
  // this one stays a variable write, scoped to the titlebar's own small subtree
  // instead of the document.
  ['[data-titlebar="true"]', '--noa-sidebar-width'],
];

// `floor` is required: every caller must say which panel's default it is
// protecting. A shared default here is what let the right panel open narrower
// than the width it declares.
export function getResponsivePanelMaxWidth(viewportWidth: number, floor: number): number {
  return Math.max(floor, Math.min(PANEL_MAX_WIDTH, viewportWidth * PANEL_MAX_VIEWPORT_RATIO));
}

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

  // Pointer and keyboard paths share the same responsive maximum, and each
  // panel floors that maximum at its own default width. Without the floor a
  // desktop narrower than default/0.35 (971px for the right panel) caps below
  // the declared default, so the panel opens narrower than the width every CSS
  // fallback and every drag boundary claims it has — and jumps on the first
  // resize interaction.
  const clampSidebarWidth = useCallback(
    (v: number) => Math.max(SIDEBAR_MIN_WIDTH, Math.min(
      v,
      getResponsivePanelMaxWidth(window.innerWidth, SIDEBAR_DEFAULT_WIDTH),
    )),
    []
  );
  const clampRightPanelWidth = useCallback(
    (v: number) => Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(
      v,
      getResponsivePanelMaxWidth(window.innerWidth, RIGHT_PANEL_DEFAULT_WIDTH),
    )),
    []
  );

  const getSidebarValue = useCallback((e: MouseEvent) => {
    return Math.min(
      e.clientX,
      getResponsivePanelMaxWidth(window.innerWidth, SIDEBAR_DEFAULT_WIDTH),
    );
  }, []);

  const getRightPanelValue = useCallback((e: MouseEvent) => {
    return Math.min(
      window.innerWidth - e.clientX,
      getResponsivePanelMaxWidth(window.innerWidth, RIGHT_PANEL_DEFAULT_WIDTH),
    );
  }, []);

  const sidebarDragOverridesRef = useRef<
    Array<{ element: HTMLElement; property: string; previous: string }> | null
  >(null);
  const previewedSidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const previewSidebarWidth = useCallback((size: number) => {
    previewedSidebarWidthRef.current = size;
    const overrides = sidebarDragOverridesRef.current;
    if (!overrides) {
      document.documentElement.style.setProperty('--noa-sidebar-width', `${size}px`);
      return;
    }
    for (const override of overrides) {
      override.element.style.setProperty(override.property, `${size}px`);
    }
  }, []);
  const previewRightPanelWidth = useCallback((size: number) => {
    document.documentElement.style.setProperty('--noa-right-panel-width', `${size}px`);
  }, []);

  const {
    size: sidebarWidth,
    setSize: setSidebarWidth,
    isDragging: isDraggingSidebar,
    setIsDragging: setIsDraggingSidebar,
  } = useResizeDrag(SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, PANEL_MAX_WIDTH, getSidebarValue, 'col-resize', previewSidebarWidth);
  const {
    size: rightPanelWidth,
    setSize: setRightPanelWidth,
    isDragging: isDraggingRightPanel,
    setIsDragging: setIsDraggingRightPanel,
  } = useResizeDrag(
    RIGHT_PANEL_DEFAULT_WIDTH,
    RIGHT_PANEL_MIN_WIDTH,
    PANEL_MAX_WIDTH,
    getRightPanelValue,
    'col-resize',
    previewRightPanelWidth
  );

  // The translucent sidebar paints its veil from a pseudo-element on the app
  // shell, and a pseudo can only read an inherited property from the element it
  // hangs off — that single consumer forces the subtree-wide write back no
  // matter where the value lands. The setting is off by default, so the common
  // drag takes the cheap path and the opt-in keeps its old cost rather than a
  // veil frozen at the width the drag started from.
  useEffect(() => {
    if (!isDraggingSidebar) return;
    if (document.documentElement.dataset.translucentSidebar === 'enabled') return;
    const overrides = SIDEBAR_DRAG_TARGETS.flatMap(([selector, property]) => {
      const element = document.querySelector<HTMLElement>(selector);
      return element ? [{ element, property, previous: element.style.getPropertyValue(property) }] : [];
    });
    sidebarDragOverridesRef.current = overrides;
    return () => {
      sidebarDragOverridesRef.current = null;
      // The variable first, so restoring the var() declarations below resolves
      // to the width the drag ended on rather than the one it started from.
      document.documentElement.style.setProperty(
        '--noa-sidebar-width',
        `${previewedSidebarWidthRef.current}px`,
      );
      for (const { element, property, previous } of overrides) {
        if (previous) element.style.setProperty(property, previous);
        else element.style.removeProperty(property);
      }
    };
  }, [isDraggingSidebar]);

  // Keyboard nudges use the same limits as the corresponding pointer path.
  const nudgeSidebarWidth = useCallback(
    (delta: number) => setSidebarWidth(w => clampSidebarWidth(w + delta)),
    [clampSidebarWidth, setSidebarWidth]
  );
  const nudgeRightPanelWidth = useCallback(
    (delta: number) => setRightPanelWidth(w => clampRightPanelWidth(w + delta)),
    [clampRightPanelWidth, setRightPanelWidth]
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
