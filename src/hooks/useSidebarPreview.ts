import { useCallback, useEffect, useRef, useState } from 'react';

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
  const isSidebarMaterialActive = !isMobile && (
    isSidebarOpen
    || isSidebarDockClosing
    || isPromotingSidebarPreview
    || isSettlingSidebarPromotionClose
  );
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarPreviewCloseTimerRef = useRef<number | null>(null);
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
    if (event.target !== event.currentTarget || event.propertyName !== 'margin-left') return;
    setIsSidebarDockClosing(false);
  }, []);
  const finishSidebarPromotion = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'width') return;
    setSidebarPreviewPhase((phase) => (
      phase === 'promoting-close' ? 'settling-close' : phase === 'promoting-open' ? 'idle' : phase
    ));
  }, []);
  useEffect(() => {
    if (!isSettlingSidebarPromotionClose) return;
    const frame = window.requestAnimationFrame(() => setSidebarPreviewPhase('idle'));
    return () => window.cancelAnimationFrame(frame);
  }, [isSettlingSidebarPromotionClose]);
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
