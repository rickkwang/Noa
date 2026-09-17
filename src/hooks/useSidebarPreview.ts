import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Mirror the durations in index.css / the inline styles below, plus slack for a
// frame that lands late. These back the fallbacks that end each animated phase:
// transitionend is not a guaranteed event, and every phase here has exactly one
// way out.
const SIDEBAR_PREVIEW_EXIT_MS = 180;
const SIDEBAR_DOCK_MOTION_MS = 320;
const SIDEBAR_PROMOTION_MS = 320;
const SIDEBAR_MOTION_FALLBACK_SLACK_MS = 80;

export type SidebarPreviewPhase = 'idle' | 'open' | 'closing' | 'promoting-open' | 'promoting-close' | 'settling-close';

interface UseSidebarPreviewOptions {
  isMobile: boolean;
  isFocusMode: boolean;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  isDraggingSidebar: boolean;
  setIsDraggingSidebar: (dragging: boolean) => void;
}

export function useSidebarPreview({
  isMobile,
  isFocusMode,
  isSidebarOpen,
  setIsSidebarOpen,
  isDraggingSidebar,
  setIsDraggingSidebar,
}: UseSidebarPreviewOptions) {
  const [sidebarPreviewPhase, setSidebarPreviewPhase] = useState<SidebarPreviewPhase>('idle');
  const isSidebarPreviewOpen = sidebarPreviewPhase === 'open' || sidebarPreviewPhase === 'closing';
  const isSidebarPreviewClosing = sidebarPreviewPhase === 'closing';
  const isPromotingSidebarPreview = sidebarPreviewPhase === 'promoting-open'
    || sidebarPreviewPhase === 'promoting-close';
  const isReversingSidebarPromotion = sidebarPreviewPhase === 'promoting-close';
  const isSettlingSidebarPromotionClose = sidebarPreviewPhase === 'settling-close';
  const [isSidebarDockClosing, setIsSidebarDockClosing] = useState(false);
  const [isSidebarPreviewSettling, setIsSidebarPreviewSettling] = useState(false);
  const isSidebarMaterialActive = !isMobile && (
    isSidebarOpen
    || isSidebarDockClosing
    || isPromotingSidebarPreview
    || isSettlingSidebarPromotionClose
  );
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarPreviewCloseTimerRef = useRef<number | null>(null);
  const wasSidebarPreviewOpenRef = useRef(false);
  const isDraggingSidebarRef = useRef(isDraggingSidebar);
  const wasDraggingSidebarRef = useRef(isDraggingSidebar);
  const cancelSidebarPreviewClose = useCallback(() => {
    if (sidebarPreviewCloseTimerRef.current !== null) {
      window.clearTimeout(sidebarPreviewCloseTimerRef.current);
      sidebarPreviewCloseTimerRef.current = null;
    }
    setSidebarPreviewPhase((phase) => phase === 'closing' ? 'open' : phase);
  }, []);
  const openSidebarPreview = useCallback(() => {
    cancelSidebarPreviewClose();
    if (!isMobile && !isSidebarOpen && !isFocusMode) {
      setSidebarPreviewPhase('open');
    }
  }, [cancelSidebarPreviewClose, isFocusMode, isMobile, isSidebarOpen]);
  const closeSidebarPreview = useCallback(() => {
    if (sidebarPreviewPhase !== 'open') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setSidebarPreviewPhase('idle');
      return;
    }
    setSidebarPreviewPhase('closing');
  }, [sidebarPreviewPhase]);
  const finishSidebarPreviewExit = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity') return;
    setSidebarPreviewPhase((phase) => phase === 'closing' ? 'idle' : phase);
  }, []);
  const scheduleSidebarPreviewClose = useCallback(() => {
    if (isDraggingSidebarRef.current) return;
    cancelSidebarPreviewClose();
    sidebarPreviewCloseTimerRef.current = window.setTimeout(() => {
      sidebarPreviewCloseTimerRef.current = null;
      closeSidebarPreview();
    }, 140);
  }, [cancelSidebarPreviewClose, closeSidebarPreview]);
  const toggleSidebar = useCallback(() => {
    cancelSidebarPreviewClose();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!isSidebarOpen && isSidebarPreviewOpen && !reduceMotion) {
      setSidebarPreviewPhase('promoting-open');
      setIsSidebarOpen(true);
      return;
    }
    if (sidebarPreviewPhase === 'promoting-open' && isSidebarOpen && !reduceMotion) {
      setSidebarPreviewPhase('promoting-close');
      setIsSidebarOpen(false);
      return;
    }
    if (sidebarPreviewPhase === 'promoting-close' && !isSidebarOpen && !reduceMotion) {
      setSidebarPreviewPhase('promoting-open');
      setIsSidebarOpen(true);
      return;
    }
    setSidebarPreviewPhase('idle');
    const nextOpen = !isSidebarOpen;
    setIsSidebarDockClosing(!isMobile && !nextOpen && !reduceMotion);
    setIsSidebarOpen(nextOpen);
  }, [cancelSidebarPreviewClose, isMobile, isSidebarOpen, isSidebarPreviewOpen, setIsSidebarOpen, sidebarPreviewPhase]);
  const finishSidebarDockMotion = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'width') return;
    setIsSidebarDockClosing(false);
  }, []);
  const finishSidebarPromotion = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'width') return;
    setSidebarPreviewPhase((phase) => (
      phase === 'promoting-close' ? 'settling-close' : phase === 'promoting-open' ? 'idle' : phase
    ));
  }, []);
  // Leaving the preview drops the sidebar back into the docked flow, where its
  // own width is the collapse mask — so that width goes from the full column to
  // 0 in the same commit. Without a frame of suppression the mask would play a
  // phantom collapse for a sidebar the user already dismissed, shoving the
  // editor across the screen and back. The layout effect lands the suppressed
  // style before the browser gets a chance to start that transition.
  useLayoutEffect(() => {
    if (wasSidebarPreviewOpenRef.current && !isSidebarPreviewOpen) setIsSidebarPreviewSettling(true);
    wasSidebarPreviewOpenRef.current = isSidebarPreviewOpen;
  }, [isSidebarPreviewOpen]);
  useEffect(() => {
    if (!isSidebarPreviewSettling) return;
    const frame = window.requestAnimationFrame(() => setIsSidebarPreviewSettling(false));
    return () => window.cancelAnimationFrame(frame);
  }, [isSidebarPreviewSettling]);
  useEffect(() => {
    if (!isSettlingSidebarPromotionClose) return;
    const frame = window.requestAnimationFrame(() => setSidebarPreviewPhase('idle'));
    return () => window.cancelAnimationFrame(frame);
  }, [isSettlingSidebarPromotionClose]);
  // Every animated phase terminates on its own, because the transitionend it
  // would otherwise wait on can legitimately never arrive. The exit style can
  // land in the same style flush as the entry — a fast hover-then-Escape, or a
  // loaded machine coalescing both mutations — and then opacity never leaves the
  // @starting-style 0, no transition is generated, and no event fires. The phase
  // would stay 'closing' forever: an invisible preview left over the app, still
  // reachable by keyboard, with the sidebar never returning to inert. The same
  // holds when a transition is dropped because the element's transition
  // shorthand resolved to none for that commit. These land after the animation,
  // so the event still wins whenever it does fire.
  useEffect(() => {
    const fallbackMs = sidebarPreviewPhase === 'closing'
      ? SIDEBAR_PREVIEW_EXIT_MS + SIDEBAR_MOTION_FALLBACK_SLACK_MS
      : sidebarPreviewPhase === 'promoting-open' || sidebarPreviewPhase === 'promoting-close'
        ? SIDEBAR_PROMOTION_MS + SIDEBAR_MOTION_FALLBACK_SLACK_MS
        : null;
    if (fallbackMs === null) return;
    const timer = window.setTimeout(() => {
      // Resolve to exactly what the transitionend handlers would have set, so a
      // fallback and a late event are indistinguishable downstream.
      setSidebarPreviewPhase((phase) => (
        phase === 'closing' || phase === 'promoting-open' ? 'idle'
          : phase === 'promoting-close' ? 'settling-close'
            : phase
      ));
    }, fallbackMs);
    return () => window.clearTimeout(timer);
  }, [sidebarPreviewPhase]);
  // Same hazard on the dock: toggling while a resize drag holds the transition
  // at none leaves no width animation to end, and a stuck true keeps the
  // translucent material painted for a sidebar that is already closed.
  useEffect(() => {
    if (!isSidebarDockClosing) return;
    const timer = window.setTimeout(
      () => setIsSidebarDockClosing(false),
      SIDEBAR_DOCK_MOTION_MS + SIDEBAR_MOTION_FALLBACK_SLACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isSidebarDockClosing]);
  useEffect(() => {
    if (isMobile || isFocusMode) {
      cancelSidebarPreviewClose();
      setSidebarPreviewPhase('idle');
      setIsSidebarDockClosing(false);
      return;
    }
    if (isSidebarOpen && (sidebarPreviewPhase === 'open' || sidebarPreviewPhase === 'closing')) {
      cancelSidebarPreviewClose();
      setSidebarPreviewPhase('idle');
    }
  }, [cancelSidebarPreviewClose, isFocusMode, isMobile, isSidebarOpen, sidebarPreviewPhase]);
  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!reducedMotion) return;
    const settleInterruptedTransition = () => {
      if (!reducedMotion.matches) return;
      setIsSidebarDockClosing(false);
      setSidebarPreviewPhase((phase) => (
        phase === 'closing' || phase.startsWith('promoting-') ? 'idle' : phase
      ));
    };
    reducedMotion.addEventListener('change', settleInterruptedTransition);
    return () => reducedMotion.removeEventListener('change', settleInterruptedTransition);
  }, []);
  useEffect(() => {
    isDraggingSidebarRef.current = isDraggingSidebar;
    if (isDraggingSidebar) cancelSidebarPreviewClose();
    if (wasDraggingSidebarRef.current && !isDraggingSidebar && isSidebarPreviewOpen) {
      const sidebar = document.querySelector<HTMLElement>('[data-sidebar-container]');
      if (!sidebar?.matches(':hover') && !sidebarToggleRef.current?.matches(':hover')) {
        scheduleSidebarPreviewClose();
      }
    }
    wasDraggingSidebarRef.current = isDraggingSidebar;
  }, [cancelSidebarPreviewClose, isDraggingSidebar, isSidebarPreviewOpen, scheduleSidebarPreviewClose]);
  useEffect(() => () => {
    if (sidebarPreviewCloseTimerRef.current !== null) window.clearTimeout(sidebarPreviewCloseTimerRef.current);
  }, []);
  useEffect(() => {
    if (!isSidebarPreviewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelSidebarPreviewClose();
      closeSidebarPreview();
      sidebarToggleRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [cancelSidebarPreviewClose, closeSidebarPreview, isSidebarPreviewOpen]);

  const handleSidebarResizeStart = useCallback(() => {
    isDraggingSidebarRef.current = true;
    cancelSidebarPreviewClose();
    setIsDraggingSidebar(true);
  }, [cancelSidebarPreviewClose, setIsDraggingSidebar]);

  return {
    isSidebarPreviewOpen,
    isSidebarPreviewClosing,
    isSidebarPreviewSettling,
    isPromotingSidebarPreview,
    isReversingSidebarPromotion,
    isSettlingSidebarPromotionClose,
    isSidebarMaterialActive,
    sidebarToggleRef,
    cancelSidebarPreviewClose,
    openSidebarPreview,
    scheduleSidebarPreviewClose,
    toggleSidebar,
    finishSidebarPreviewExit,
    finishSidebarDockMotion,
    finishSidebarPromotion,
    handleSidebarResizeStart,
  };
}
