import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { attachEdgeFade, type EdgeFadeHandle } from '../../lib/edgeFade';
import { Note } from '../../types';
import { X, Plus } from '@/src/lib/icons';

const noDragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };
const dragRegion: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };

// Keep in sync with the editor-tab-slot-enter/exit keyframes in index.css, and
// with TAB_ENTER_FALLBACK_MS / TAB_EXIT_FALLBACK_MS in useTabs.
const TAB_ANIM_MS = 170;

// Compressed tabs (see .editor-tab in index.css): widest is the old fixed 9rem,
// narrowest still fits a padded initial or the active tab's close glyph.
const TAB_MAX_W = 144;
const TAB_MIN_W = 44;
// The active tab stops compressing here, as in Obsidian: it holds the close
// glyph and, right after a new note, the rename field.
const TAB_ACTIVE_MIN_W = 96;
// Fixed chrome sharing the strip's frame with the tabs: the strip's px-1, each
// divider (w-px + mx-0.5), and the new-tab button (w-6 + ml-1).
const TAB_STRIP_PADDING = 8;
const TAB_DIVIDER_W = 5;
const NEW_TAB_BUTTON_W = 28;

// Stable identity for the optional id lists, so the memos below don't rebuild on
// every render when the caller omits them.
const NO_TAB_IDS: string[] = [];

interface EditorTab {
  id: string;
  title: string;
}

interface EditorHeaderProps {
  note: Note;
  tabs?: EditorTab[];
  isEditingTitle: boolean;
  titleInput: string;
  enteringTabIds?: string[];
  enteringFromTabIds?: string[];
  closingTabIds?: string[];
  onTitleInputChange: (value: string) => void;
  onTitleSubmit: () => void;
  onTitleKeyDown: (e: React.KeyboardEvent) => void;
  onSetEditingTitle: (v: boolean) => void;
  onTabChange?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onTabReorder?: (sourceId: string, targetId: string, after: boolean) => void;
  onNewTab?: () => void;
  onTabEnterComplete?: (id: string) => void;
  onTabCloseAnimationComplete?: (id: string) => void;
  onClose?: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  liftTabStrip?: boolean;
  reserveTitlebarTraffic?: boolean;
  reserveTitlebarActions?: boolean;
  isDark: boolean;
  readOnly?: boolean;
}

type TabSlot = { left: number; width: number };

// Where the dragged tab sits when it settles into `slot`. Tabs are not all one
// width (the active tab keeps TAB_ACTIVE_MIN_W while the rest compress), so the
// slot is measured from its own edges rather than assumed to be one step over.
function tabSlotOffset(positions: TabSlot[], source: number, slot: number) {
  if (slot === source) return 0;
  const from = positions[source];
  return slot > source
    ? positions[slot].left + positions[slot].width - from.width - from.left
    : positions[slot].left - from.left;
}

// How far a tab between the drag's source and target moves to make room: the
// dragged tab's own width plus one divider gap, whatever its own width is.
function tabMakeRoomShift(positions: TabSlot[], source: number, target: number, index: number) {
  if (index === source) return 0;
  const gap = positions.length > 1 ? positions[1].left - positions[0].left - positions[0].width : 0;
  const step = positions[source].width + gap;
  if (source < target && index > source && index <= target) return -step;
  if (source > target && index >= target && index < source) return step;
  return 0;
}

function isActiveTabInView(strip: HTMLElement) {
  const active = strip.querySelector<HTMLElement>('[data-active-tab="true"]');
  if (!active) return false;
  const tab = active.getBoundingClientRect();
  const bounds = strip.getBoundingClientRect();
  return tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1;
}

export function EditorHeader({
  note,
  tabs,
  isEditingTitle,
  titleInput,
  enteringTabIds = NO_TAB_IDS,
  enteringFromTabIds = NO_TAB_IDS,
  closingTabIds = NO_TAB_IDS,
  onTitleInputChange,
  onTitleSubmit,
  onTitleKeyDown,
  onSetEditingTitle,
  onTabChange,
  onTabClose,
  onTabReorder,
  onNewTab,
  onTabEnterComplete,
  onTabCloseAnimationComplete,
  onClose,
  titleInputRef,
  liftTabStrip = false,
  reserveTitlebarTraffic = false,
  reserveTitlebarActions = false,
  isDark,
  readOnly = false,
}: EditorHeaderProps) {
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabStripFrameRef = useRef<HTMLDivElement>(null);
  const entranceScrollOwnerRef = useRef<string | null>(null);
  // Track IME composition so we don't commit a half-typed CJK title when the
  // user presses Enter or blurs mid-selection.
  const isComposingRef = useRef(false);
  const handleCompositionStart = () => { isComposingRef.current = true; };
  const handleCompositionEnd = () => { isComposingRef.current = false; };
  const handleTitleBlur = () => { if (!isComposingRef.current) onTitleSubmit(); };
  const handleTitleKeyDownGuarded = (e: React.KeyboardEvent) => {
    // Swallow Enter while composing; some IMEs fire Enter to accept a candidate.
    // keyCode 229 is the legacy "composition in progress" marker.
    if (isComposingRef.current || e.nativeEvent.isComposing || (e as unknown as { keyCode: number }).keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    onTitleKeyDown(e);
  };
  const enteringTabIdSet = useMemo(() => new Set(enteringTabIds), [enteringTabIds]);
  const enteringFromTabIdSet = useMemo(() => new Set(enteringFromTabIds), [enteringFromTabIds]);
  const closingTabIdSet = useMemo(() => new Set(closingTabIds), [closingTabIds]);
  const isEnteringActiveTab = enteringTabIdSet.has(note.id);
  const anyTabAnimating = enteringTabIds.length > 0 || closingTabIds.length > 0;
  // Both overflow edges fade by distance, through the shared driver — see
  // lib/edgeFade. Held in a ref rather than state because the strength lives in
  // CSS variables on the strip itself: a fade that re-rendered the header on
  // every scroll frame would be paying a render to draw a gradient.
  const edgeFadeRef = useRef<EdgeFadeHandle | null>(null);
  const activeTabInViewRef = useRef(true);
  // Tabs that will still be there once closing ones finish: the width they
  // share is what the entering/exiting tab animates toward.
  const settledTabCount = tabs ? tabs.filter((tab) => !closingTabIdSet.has(tab.id)).length : 0;
  const settledTabCountRef = useRef(settledTabCount);
  settledTabCountRef.current = settledTabCount;
  const hasNewTabButton = Boolean(onNewTab);
  // A count change re-divides the space, and so does switching tabs while
  // compressed (the wider active slot moves). The tabs ease onto the new widths
  // for the length of the enter/exit animation, then go back to snapping so
  // resizes track the pointer. Decided during render, not in an effect: the
  // flag has to reach the DOM in the same commit as the width change. Set from
  // a layout effect it landed after an earlier effect had already read layout,
  // so the new widths were computed without it and snapped (measured: 44→96px
  // in one frame on a tab switch).
  //
  // closingActiveId: the tab that was active when it started closing. Its
  // successor takes over the active width at once, and the exit keyframes start
  // from --noa-tab-w, so without this the closing tab first dropped to the
  // compressed width (96→53px in a frame) and only then collapsed.
  const tabLayoutKey = `${settledTabCount}:${note.id}`;
  const [tabLayout, setTabLayout] = useState({ key: tabLayoutKey, activeId: note.id, resizing: false, closingActiveId: null as string | null });
  if (tabLayout.key !== tabLayoutKey) {
    const closingActiveId = tabLayout.activeId !== note.id && closingTabIdSet.has(tabLayout.activeId)
      ? tabLayout.activeId
      : tabLayout.closingActiveId !== null && closingTabIdSet.has(tabLayout.closingActiveId) ? tabLayout.closingActiveId : null;
    setTabLayout({ key: tabLayoutKey, activeId: note.id, resizing: true, closingActiveId });
  }
  useEffect(() => {
    if (!tabLayout.resizing) return;
    const timer = window.setTimeout(() => setTabLayout((prev) => ({ ...prev, resizing: false })), TAB_ANIM_MS + 20);
    return () => window.clearTimeout(timer);
  }, [tabLayout.key, tabLayout.resizing]);
  const applyTabFitWidth = useCallback(() => {
    const scrollEl = tabStripRef.current;
    const frameEl = tabStripFrameRef.current;
    const count = settledTabCountRef.current;
    if (!scrollEl || !frameEl || count === 0) return;
    const space = frameEl.clientWidth - TAB_STRIP_PADDING - (hasNewTabButton ? NEW_TAB_BUTTON_W : 0) - TAB_DIVIDER_W * (count - 1);
    const even = space / count;
    const activeWidth = count > 1 && even < TAB_ACTIVE_MIN_W ? TAB_ACTIVE_MIN_W : even;
    const restWidth = count > 1 && even < TAB_ACTIVE_MIN_W ? (space - activeWidth) / (count - 1) : even;
    const clampWidth = (width: number) => Math.floor(Math.min(TAB_MAX_W, Math.max(TAB_MIN_W, width)));
    scrollEl.style.setProperty('--noa-tab-fit-w', `${clampWidth(restWidth)}px`);
    scrollEl.style.setProperty('--noa-tab-active-fit-w', `${clampWidth(activeWidth)}px`);
  }, [hasNewTabButton]);
  // Tab positions are kept in strip-content coordinates (scrollLeft included),
  // so auto-scrolling the strip mid-drag doesn't invalidate them.
  const tabPointerRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    clientX: number;
    sourceIndex: number;
    targetIndex: number;
    positions: { left: number; width: number }[];
    element: HTMLDivElement;
    dragging: boolean;
    frame: number | null;
  } | null>(null);
  const [tabDrag, setTabDrag] = useState<{ id: string; sourceIndex: number; targetIndex: number; positions: { left: number; width: number }[] } | null>(null);
  const suppressTabClickRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const updateTabDrag = () => {
    const drag = tabPointerRef.current;
    const strip = tabStripRef.current;
    if (!drag || !strip) return;
    const stripRect = strip.getBoundingClientRect();
    const x = drag.clientX - stripRect.left + strip.scrollLeft;
    const { positions, sourceIndex } = drag;
    const delta = Math.max(
      tabSlotOffset(positions, sourceIndex, 0),
      Math.min(tabSlotOffset(positions, sourceIndex, positions.length - 1), x - drag.startX),
    );
    drag.element.style.setProperty('--noa-tab-drag-x', `${delta}px`);
    // Resolve against the dragged tab's leading edge, not the pointer: from the
    // pointer, where the tab was grabbed decided the swap — near its right
    // edge it swapped after a few px, near its left only after a full width.
    // A neighbour gives way once that edge crosses its midline.
    const draggedLeft = positions[sourceIndex].left + delta;
    const draggedRight = draggedLeft + positions[sourceIndex].width;
    const targetIndex = positions.reduce((index, position, positionIndex) => (
      positionIndex !== sourceIndex
        && (positionIndex < sourceIndex ? draggedLeft : draggedRight) > position.left + position.width / 2
        ? index + 1
        : index
    ), 0);
    if (targetIndex !== drag.targetIndex || !drag.frame) {
      drag.targetIndex = targetIndex;
      setTabDrag({ id: drag.id, sourceIndex, targetIndex, positions });
    }
  };
  // Runs every frame while dragging: scrolls the strip when the pointer sits
  // near either edge, and re-resolves the target since scrolling moves it.
  const tickTabDrag = () => {
    const drag = tabPointerRef.current;
    const strip = tabStripRef.current;
    if (!drag?.dragging || !strip) return;
    const rect = strip.getBoundingClientRect();
    const edge = 32;
    const step = drag.clientX < rect.left + edge
      ? -Math.ceil((rect.left + edge - drag.clientX) / 4)
      : drag.clientX > rect.right - edge
        ? Math.ceil((drag.clientX - rect.right + edge) / 4)
        : 0;
    if (step) strip.scrollLeft += step;
    updateTabDrag();
    drag.frame = window.requestAnimationFrame(tickTabDrag);
  };
  const finishTabDrag = (commit: boolean) => {
    const drag = tabPointerRef.current;
    if (!drag) return;
    if (commit && drag.dragging) updateTabDrag();
    tabPointerRef.current = null;
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    if (drag.dragging) {
      suppressTabClickRef.current = true;
      window.setTimeout(() => { suppressTabClickRef.current = false; }, 0);
    }
    // Every drag settles, including one dropped back home or cancelled: those
    // used to snap the tab up to half a width in a single frame.
    if (drag.dragging && tabs) {
      const settledIndex = commit ? drag.targetIndex : drag.sourceIndex;
      if (settledIndex !== drag.targetIndex) {
        setTabDrag({ id: drag.id, sourceIndex: drag.sourceIndex, targetIndex: settledIndex, positions: drag.positions });
      }
      drag.element.style.transition = 'transform 150ms ease-out';
      void drag.element.getBoundingClientRect();
      drag.element.style.setProperty('--noa-tab-drag-x', `${tabSlotOffset(drag.positions, drag.sourceIndex, settledIndex)}px`);
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        // Commit the new order before dropping the offset, so no frame paints
        // the tab back in its old slot.
        flushSync(() => {
          if (settledIndex !== drag.sourceIndex) {
            onTabReorder?.(drag.id, tabs[settledIndex].id, settledIndex > drag.sourceIndex);
          }
          setTabDrag(null);
        });
        drag.element.style.removeProperty('--noa-tab-drag-x');
        drag.element.style.removeProperty('transition');
      }, 150);
      return;
    }
    drag.element.style.removeProperty('--noa-tab-drag-x');
    setTabDrag(null);
  };

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    const frame = tabPointerRef.current?.frame;
    if (frame) window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const clearPending = (event: PointerEvent) => {
      if (tabPointerRef.current?.pointerId === event.pointerId && !tabPointerRef.current.dragging) tabPointerRef.current = null;
    };
    window.addEventListener('pointerup', clearPending);
    window.addEventListener('pointercancel', clearPending);
    return () => {
      window.removeEventListener('pointerup', clearPending);
      window.removeEventListener('pointercancel', clearPending);
    };
  }, []);

  useLayoutEffect(() => {
    const scrollEl = tabStripRef.current;
    if (!scrollEl) return;
    // A new tab is always appended at the end, so follow the strip's right edge
    // while it widens and it reads as sliding in at that edge. Letting the
    // entrance finish and snapping into view afterward instead teleported the
    // whole strip a full tab-width in a single frame (measured: 73px, 3/3).
    if (isEnteringActiveTab) {
      entranceScrollOwnerRef.current = note.id;
      // Ease to the edge rather than pinning to it: the strip is often parked
      // far from the right (browsing older tabs, then opening a note that isn't
      // open yet), and jumping straight to scrollWidth teleported it by up to
      // 1098px in a single frame. Duration matches editor-tab-slot-enter.
      const from = scrollEl.scrollLeft;
      const start = performance.now();
      let raf = 0;
      const followRightEdge = () => {
        const p = Math.min(1, (performance.now() - start) / TAB_ANIM_MS);
        const eased = 1 - (1 - p) ** 3;
        const max = scrollEl.scrollWidth - scrollEl.clientWidth;
        scrollEl.scrollLeft = from + (max - from) * eased;
        if (p < 1) raf = requestAnimationFrame(followRightEdge);
      };
      followRightEdge();
      return () => cancelAnimationFrame(raf);
    }
    // The entrance that just ended already parked the strip at its right edge.
    // Without this guard, clearing the entering flag re-ran the effect and fired
    // a second, smooth scroll on the exact frame the entrance landed. Keyed on
    // the tab that was entering, not a bare flag: switching to a different tab
    // mid-entrance also clears isEnteringActiveTab, and that tab does still need
    // to be scrolled into view.
    const entranceOwner = entranceScrollOwnerRef.current;
    entranceScrollOwnerRef.current = null;
    if (entranceOwner === note.id) return;
    // Otherwise keep the active tab in view when it changes (e.g. activated via
    // keyboard or the sidebar while scrolled off-screen).
    const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [tabs, note.id, isEnteringActiveTab]);

  useEffect(() => {
    const scrollEl = tabStripRef.current;
    const frameEl = tabStripFrameRef.current;
    if (!scrollEl || !frameEl) return;
    // The strip clips overflowing tabs with a hidden scrollbar, so a window
    // resize can silently push the active tab out of view. Re-snap it whenever
    // the space available to the strip changes.
    //
    // Observe the frame, not the strip. The strip is shrink-to-fit, so its own
    // width tracks its content and it resizes on every frame of a tab
    // enter/exit — observing it re-snapped and re-measured on those frames
    // (measured: 22 callbacks per entrance) while the entrance's rAF was
    // writing scrollLeft. The frame is the flex-1 wrapper, so it only changes
    // with the window, sidebar, or right panel: exactly the cases that need a
    // re-snap, and none of the cases the animations already handle.
    //
    // Only a tab the resize itself pushed out is put back. If the user had
    // scrolled the active tab away, every sidebar drag or toggle yanked the
    // strip back to it; their scroll position is theirs to keep.
    const fade = attachEdgeFade(scrollEl, { axis: 'x', end: true });
    edgeFadeRef.current = fade;
    activeTabInViewRef.current = isActiveTabInView(scrollEl);
    // Scroll events arrive a frame late. The one our own correction raises
    // lands after the strip has shrunk again, reads the tab as out of view,
    // and would pass for the user scrolling away — so it is skipped by the
    // position it wrote.
    let correctedScrollLeft: number | null = null;
    const handleScroll = () => {
      if (scrollEl.scrollLeft === correctedScrollLeft) return;
      correctedScrollLeft = null;
      activeTabInViewRef.current = isActiveTabInView(scrollEl);
    };
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      applyTabFitWidth();
      if (activeTabInViewRef.current && !isActiveTabInView(scrollEl)) {
        const active = scrollEl.querySelector<HTMLElement>('[data-active-tab="true"]');
        active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        correctedScrollLeft = scrollEl.scrollLeft;
      }
      activeTabInViewRef.current = isActiveTabInView(scrollEl);
      fade.refresh();
    });
    observer.observe(frameEl);
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      observer.disconnect();
      fade.dispose();
      edgeFadeRef.current = null;
    };
  }, [applyTabFitWidth]);

  useLayoutEffect(() => { applyTabFitWidth(); }, [settledTabCount, applyTabFitWidth]);

  // Tabs entering or leaving change how much the strip overflows without
  // scrolling it, and no scroll event reports that.
  useLayoutEffect(() => { edgeFadeRef.current?.refresh(); }, [tabs, anyTabAnimating]);
  // Switching to a tab that is already in view scrolls nothing, so no scroll
  // event would refresh the record the resize observer reads.
  useLayoutEffect(() => {
    const scrollEl = tabStripRef.current;
    if (scrollEl) activeTabInViewRef.current = isActiveTabInView(scrollEl);
  }, [tabs, note.id]);

  return (
    <div
      className={`h-11 flex items-center justify-between shrink-0 z-10 font-redaction overflow-visible gap-3 relative ${liftTabStrip ? '-mt-11 noa-editor-header-floor' : ''} ${liftTabStrip && reserveTitlebarTraffic ? 'noa-editor-header-floor-reserved' : ''} ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}
      style={{
        ...dragRegion,
        // 4px here plus the strip's own 4px puts the first pill 8px from the
        // sidebar edge, the same gutter the right column's cards keep.
        paddingLeft: '0.25rem',
        paddingRight: '0.5rem',
        marginLeft: liftTabStrip && reserveTitlebarTraffic ? 'var(--noa-titlebar-reserve)' : undefined,
        marginRight: reserveTitlebarActions ? '7.25rem' : undefined,
        // Two edges, two clocks. The left reservation is the sidebar's traffic
        // -light clearance and has to arrive exactly when the sidebar edge does
        // — under a translucent sidebar the titlebar is transparent, so a strip
        // that lands early sits over the wrong plane in plain sight. It stays
        // margin (a padding reservation would put the header's box over the
        // titlebar buttons and swallow their clicks) and a pointer-events-none
        // pseudo extends the header's own floor across the margin gap instead
        // — otherwise the translucent window's compositor leaves the native
        // material showing in that band until the strip arrives (a gray ghost
        // riding the tab strip). The right reservation belongs to the right
        // panel, which slides on the same 400ms clock as the sidebar. A
        // `margin` shorthand cannot hold both.
        transition: liftTabStrip
          ? 'margin-left 400ms ease-in-out, margin-right 400ms ease-in-out'
          : undefined,
      }}
    >
      {/* Tab strip */}
      <div
        ref={tabStripFrameRef}
        className="min-w-0 flex-1 flex items-center overflow-visible"
        style={{
          marginLeft: liftTabStrip && reserveTitlebarTraffic
            ? 'var(--noa-titlebar-search-extra, 0px)'
            : undefined,
          transition: liftTabStrip ? 'margin-left 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
        }}
      >
        {/* z-[1] keeps the strip above the header's bottom line even when the
            mask-image below forces this subtree into its own stacking context */}
        <div className="relative z-[1] min-w-0 flex items-center overflow-visible">
          <div
            ref={tabStripRef}
            data-tab-resizing={tabLayout.resizing || undefined}
            className="noa-edge-fade-x min-w-0 flex-1 flex items-center overflow-x-auto overflow-y-visible [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            style={{ scrollPaddingInline: '10px' }}
          >
            {/* py-1 and px-1 are room for the active pill's ring and shadow,
                which this scroller would otherwise cut off at its edge.
                w-max, not w-full: at the scroller's width the tabs overflow
                this row once the strip scrolls, and overflowing children do
                not carry their parent's padding — the last pill then ends
                flush against the clip edge and loses its right side. */}
            <div className="flex items-center py-1 px-1 w-max min-w-full shrink-0">
            {tabs && tabs.length > 0 ? (
              tabs.map((tab, idx) => {
                const isActiveTab = tab.id === note.id;
                const prevTab = idx > 0 ? tabs[idx - 1] : null;
                const prevIsActive = prevTab?.id === note.id;
                const prevIsEntering = Boolean(prevTab && enteringTabIdSet.has(prevTab.id));
                const isEnteringFromTab = enteringFromTabIdSet.has(tab.id);
                const prevIsEnteringFromTab = Boolean(prevTab && enteringFromTabIdSet.has(prevTab.id));
                const showDivider = idx > 0 && !isActiveTab && !prevIsActive;
                const isEnteringTab = enteringTabIdSet.has(tab.id);
                const isClosingTab = closingTabIdSet.has(tab.id);
                const prevIsClosing = Boolean(prevTab && closingTabIdSet.has(prevTab.id));
                const showSettledDivider = showDivider && !isEnteringTab && !prevIsEntering && !isEnteringFromTab && !prevIsEnteringFromTab && !isClosingTab && !prevIsClosing;
                const sourceIndex = tabDrag?.sourceIndex ?? -1;
                const targetIndex = tabDrag?.targetIndex ?? -1;
                const positions = tabDrag?.positions;
                const shift = positions ? tabMakeRoomShift(positions, sourceIndex, targetIndex, idx) : 0;
                return (
                  <React.Fragment key={tab.id}>
                    {idx > 0 && (
                      <div
                        className={`editor-tab-divider self-center h-3.5 w-px shrink-0 bg-[var(--divider-subtle)] mx-0.5 ${showSettledDivider ? 'opacity-100' : 'opacity-0'}`}
                        aria-hidden="true"
                        style={tabDrag && idx !== sourceIndex ? { transform: `translateX(${shift}px)`, transition: 'transform 150ms ease-out' } : undefined}
                      />
                    )}
                    <div
                      data-tab-id={tab.id}
                      data-active-tab={isActiveTab}
                      data-closing-tab={isClosingTab || undefined}
                      data-dragging-tab={tabDrag?.id === tab.id || undefined}
                      data-closing-active-tab={isClosingTab && tab.id === tabLayout.closingActiveId ? true : undefined}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || tabDrag || !onTabReorder || tabs.length < 2 || anyTabAnimating || isEditingTitle || (event.target as HTMLElement).closest('button, input')) return;
                        const strip = tabStripRef.current;
                        if (!strip) return;
                        const stripLeft = strip.getBoundingClientRect().left - strip.scrollLeft;
                        const positions = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'), (element) => {
                          const rect = element.getBoundingClientRect();
                          return { left: rect.left - stripLeft, width: rect.width };
                        });
                        if (positions.length !== tabs.length) return;
                        tabPointerRef.current = { id: tab.id, pointerId: event.pointerId, startX: event.clientX - stripLeft, clientX: event.clientX, sourceIndex: idx, targetIndex: idx, positions, element: event.currentTarget, dragging: false, frame: null };
                      }}
                      onPointerMove={(event) => {
                        const drag = tabPointerRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        drag.clientX = event.clientX;
                        if (!drag.dragging) {
                          const strip = tabStripRef.current;
                          if (!strip || Math.abs(event.clientX - (drag.startX + strip.getBoundingClientRect().left - strip.scrollLeft)) < 5) return;
                          drag.dragging = true;
                          drag.element.setPointerCapture(event.pointerId);
                          tickTabDrag();
                        }
                        event.preventDefault();
                      }}
                      onPointerUp={(event) => {
                        const drag = tabPointerRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        drag.clientX = event.clientX;
                        finishTabDrag(true);
                      }}
                      onPointerCancel={(event) => { if (tabPointerRef.current?.pointerId === event.pointerId) finishTabDrag(false); }}
                      onClick={() => {
                        if (suppressTabClickRef.current) { suppressTabClickRef.current = false; return; }
                        if (!isClosingTab) onTabChange?.(tab.id);
                      }}
                      // Middle-click closes, as in a browser. mousedown is
                      // where autoscroll starts, so it is cancelled there.
                      onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
                      onAuxClick={(event) => {
                        if (event.button !== 1 || tabDrag || isClosingTab) return;
                        event.preventDefault();
                        onTabClose?.(tab.id);
                      }}
                      onAnimationEnd={(event) => {
                        if (event.currentTarget !== event.target) return;
                        if (isClosingTab) onTabCloseAnimationComplete?.(tab.id);
                        if (isEnteringTab) onTabEnterComplete?.(tab.id);
                      }}
                      className={`group editor-tab ${isEnteringTab ? 'editor-tab-enter' : ''} ${isClosingTab ? 'editor-tab-exit' : ''} flex items-center gap-1.5 h-[26px] rounded-lg cursor-pointer transition-colors relative flex-none w-[var(--noa-tab-w)] ${
                        // The active pill's surface and ring come from
                        // .editor-tab[data-active-tab] in index.css — a literal
                        // bg-[#F9F9F7] here would be remapped to the page colour
                        // and the pill would vanish into the bar.
                        isActiveTab
                          ? `z-[1] ${isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]'}`
                          : isDark ? 'text-[#F9F9F7]/55 hover:text-[#F9F9F7]/80' : 'text-[#2D2D2B]/50 hover:text-[#2D2D2B]/80'
                      }`}
                      style={tabDrag ? {
                        ...noDragRegion,
                        transform: tabDrag.id === tab.id ? 'translateX(var(--noa-tab-drag-x, 0px))' : `translateX(${shift}px)`,
                        transition: tabDrag.id === tab.id ? 'none' : 'transform 150ms ease-out',
                        zIndex: tabDrag.id === tab.id ? 2 : undefined,
                      } : noDragRegion}
                    >
                      {isActiveTab && isEditingTitle ? (
                        <input
                          ref={titleInputRef}
                          type="text"
                          value={titleInput}
                          onChange={(e) => onTitleInputChange(e.target.value)}
                          onBlur={handleTitleBlur}
                          onKeyDown={handleTitleKeyDownGuarded}
                          onCompositionStart={handleCompositionStart}
                          onCompositionEnd={handleCompositionEnd}
                          disabled={readOnly}
                          className={`text-xs font-bold bg-transparent outline-none border-b w-28 min-w-0 ${isDark ? 'text-[#F9F9F7] border-[#CC7D5E]' : 'text-[#2D2D2B] border-[#CC7D5E]'}`}
                        />
                      ) : (
                        <span
                          className="text-xs font-bold truncate min-w-0 flex-1"
                          onDoubleClick={isActiveTab && !readOnly ? () => onSetEditingTitle(true) : undefined}
                          title={isActiveTab && !readOnly ? 'Double-click to rename' : tab.title}
                        >
                          {tab.title || 'Untitled'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTabClose?.(tab.id);
                        }}
                        className={`shrink-0 ${isActiveTab ? '' : 'opacity-0 pointer-events-none'} group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity active:opacity-70 ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/40 hover:text-[#D45555]'}`}
                        aria-label={`Close ${tab.title || 'Untitled'} tab`}
                        title="Close tab"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </React.Fragment>
                );
              })
            ) : (
              /* Fallback: single tab (legacy mode) */
              <div
                data-active-tab="true"
                className="editor-tab flex items-center gap-1.5 h-[26px] px-3 rounded-lg relative z-[1] shrink-0"
                style={noDragRegion}
              >
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={titleInput}
                    onChange={(e) => onTitleInputChange(e.target.value)}
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDownGuarded}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    disabled={readOnly}
                    className={`text-xs font-bold bg-transparent outline-none border-b w-28 shrink min-w-0 ${isDark ? 'text-[#F9F9F7] border-[#CC7D5E]' : 'text-[#2D2D2B] border-[#CC7D5E]'}`}
                  />
                ) : (
                  <span
                    className={`text-xs font-bold cursor-text truncate max-w-[120px] ${isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]'}`}
                    onClick={readOnly ? undefined : () => onSetEditingTitle(true)}
                    title={readOnly ? note.title : 'Click to rename'}
                  >
                    {note.title || 'Untitled'}
                  </span>
                )}
                {onClose && (
                  <button onClick={onClose} className={`shrink-0 transition-colors active:opacity-70 ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/40 hover:text-[#D45555]'}`} aria-label="Close tab" title="Close tab">
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
        {onNewTab && (
          <button
            onClick={onNewTab}
            className={`flex items-center justify-center w-6 h-6 ml-1 rounded-md shrink-0 self-center transition-[background-color,color,transform] duration-200 ease-out active:scale-95 active:opacity-80 ${isDark ? 'text-[#F9F9F7]/30 hover:text-[#F9F9F7]/75 hover:bg-[#F9F9F7]/[0.07]' : 'text-[#2D2D2B]/35 hover:text-[#2D2D2B]/80 hover:bg-[#2D2D2B]/[0.05]'}`}
            style={noDragRegion}
            title="New tab"
            aria-label="New tab"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
