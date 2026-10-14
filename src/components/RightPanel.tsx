import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { RIGHT_TABS, RIGHT_TAB_LABELS, type PaneBadges, type RightTab } from '../constants/rightTabs';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useIsDark } from '../hooks/useIsDark';
import { buildGraphModel, pruneGraphTagFilter, type GraphGroup } from '../lib/graphModel';
import { computeTopologySignature } from '../lib/noteUtils';
import { THEME_SURFACES } from '../lib/themePalette';
import { GlobalTask, Note, Folder, AppSettings } from '../types';
import GraphView, { DEFAULT_GRAPH_FORCES, DEFAULT_LABEL_FADE_THRESHOLD, DEFAULT_LINK_THICKNESS, DEFAULT_NODE_SIZE, TAG_PALETTE, type GraphColorMode, type GraphForces } from './GraphView';
import { BacklinksPanel } from './rightPanel/BacklinksPanel';
import { OutgoingLinksPanel } from './rightPanel/OutgoingLinksPanel';
import { PaneTabs } from './rightPanel/PaneTabs';
import { PropertiesPanel } from './rightPanel/PropertiesPanel';
import { TasksPanel } from './rightPanel/TasksPanel';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Network, Search, Filter, X } from '@/src/lib/icons';
export type RightPanelTab = RightTab;

// Neither card of a split may shrink below this share of the column.
const PANE_SPLIT_MIN = 0.2;

type PaneSlotState = 'open' | 'minimized' | 'hidden';

/**
 * Turns the list of open cards into per-card presence and position.
 *
 * Cards render in a fixed DOM order and are placed with CSS `order`, so the
 * graph can stay mounted while closed without pinning where it reappears.
 * `order` follows `open`: a newly opened card lands at the bottom, and
 * dragging a card by its handle reorders `open` itself.
 */
function usePaneSlots(open: readonly RightTab[]) {
  return {
    isOpen: (id: RightTab) => open.includes(id),
    orderOf: (id: RightTab) => open.indexOf(id) + 1,
  };
}

// Card move, measured on Claude Code's tiles: the drag starts after 3px, the held card then follows the pointer
// on both axes, and the other card yields once the pointer crosses its centre. Yielding, release and Escape all
// ride one critically damped spring (ω ≈ 22/s: ~90% of the way in 200ms, at rest by ~450ms).
const PANE_MOVE_THRESHOLD = 3;
const PANE_MOVE_SPRING = 22;

/** Drives an element's translate with a critically damped spring; retargeting mid-flight keeps its velocity. */
function createSpring(el: HTMLElement, reduceMotion: boolean) {
  let x = 0, y = 0, vx = 0, vy = 0, tx = 0, ty = 0;
  let frame: number | null = null;
  let last = 0;
  let onRest: (() => void) | null = null;
  const apply = () => {
    el.style.transform = x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px)`;
  };
  const settle = () => {
    x = tx; y = ty; vx = 0; vy = 0;
    apply();
    frame = null;
    const done = onRest;
    onRest = null;
    done?.();
  };
  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const w = PANE_MOVE_SPRING;
    vx += (w * w * (tx - x) - 2 * w * vx) * dt;
    vy += (w * w * (ty - y) - 2 * w * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    if (Math.abs(tx - x) < 0.5 && Math.abs(ty - y) < 0.5 && Math.abs(vx) < 10 && Math.abs(vy) < 10) {
      settle();
      return;
    }
    apply();
    frame = requestAnimationFrame(step);
  };
  return {
    /** Pins the element to an offset with no motion (pointer tracking). */
    set(nx: number, ny: number) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      x = tx = nx; y = ty = ny; vx = 0; vy = 0;
      apply();
    },
    to(nx: number, ny: number, done?: () => void) {
      tx = nx; ty = ny;
      onRest = done ?? null;
      if (reduceMotion) {
        if (frame !== null) cancelAnimationFrame(frame);
        settle();
        return;
      }
      if (frame === null) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      onRest = null;
    },
  };
}

// One floating card in the right column, one step off the page in both themes so it reads as raised.
// The header is identical on every card so stacked cards line up; card-specific controls go in `actions`.
function PaneCard({
  id,
  state,
  order,
  dragsWindow,
  grow,
  isDark,
  actions,
  isExpanded,
  onToggleExpand,
  onClose,
  onMovePointerDown,
  isMoving = false,
  children,
}: {
  id: RightTab;
  state: PaneSlotState;
  order: number;
  /** Only the top card's header drags the window; the rest sit inside the content. */
  dragsWindow: boolean;
  /** Share of the column when two cards split it. */
  grow?: number;
  isDark: boolean;
  actions?: React.ReactNode;
  isExpanded?: boolean;
  /** Absent in the phone drawer, which is already the whole screen. */
  onToggleExpand?: () => void;
  /** Absent in the phone drawer, where the tab strip is the only switch. */
  onClose?: () => void;
  /** Present only while two cards share the column, so there is somewhere to move to. */
  onMovePointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  isMoving?: boolean;
  children: React.ReactNode;
}) {
  const title = RIGHT_TAB_LABELS[id];
  // 20px in a 28px row: the hover wash clears the card's top edge and rounded corner.
  const controlClass = `flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer ${
    isDark
      ? 'text-[rgba(249,249,247,0.45)] hover:text-[#F9F9F7] hover:bg-[var(--bg-sidebar-raised,#ECEBE8)]'
      : 'text-[#2D2D2B]/45 hover:text-[#2D2D2B] hover:bg-[var(--bg-sidebar-raised,#ECEBE8)]'
  }`;
  return (
    <section
      aria-label={`${title} panel`}
      data-pane={id}
      data-state={state}
      inert={state === 'open' ? undefined : true}
      className={`noa-pane-card relative flex flex-col overflow-hidden rounded-panel bg-[var(--bg-card,#FFFFFF)] ${isMoving ? 'z-20' : ''}`}
      style={{ order, flexGrow: grow }}
    >
      {onMovePointerDown && (
        // Hover target spans the header's top edge; the 32×3 pill inside is the visible affordance.
        <button
          type="button"
          aria-label="Move panel"
          onPointerDown={onMovePointerDown}
          className="noa-pane-move-handle absolute left-1/2 top-0 z-10 flex h-4 w-11 -translate-x-1/2 cursor-move touch-none items-center justify-center outline-none"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          data-active={isMoving || undefined}
        >
          <span className="noa-pane-move-pill h-[3px] w-8 rounded-full" />
        </button>
      )}
      {/* Header row: pl-3/pr-1.5 gives every card's content the same 12px inset. The column is
          no-drag as a whole (see App.tsx); the top card's header opts back in so the titlebar area stays draggable. */}
      <header className="h-7 shrink-0 flex items-center gap-0.5 pl-3 pr-1.5" style={dragsWindow ? { WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}>
        <h2 className={`mr-auto truncate text-body font-medium font-ui text-[var(--sidebar-text,#4A4947)]`}>{title}</h2>
        <div className="flex min-w-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {actions}
        {onToggleExpand && (
          <button
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
            aria-pressed={isExpanded}
            // No pressed wash: the glyph already flips, and a resting fill reads as a stuck hover.
            className={controlClass}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} title="Close" aria-label="Close panel" className={controlClass}>
            <X size={13} />
          </button>
        )}
        </div>
      </header>
      {children}
    </section>
  );
}

interface RightPanelProps {
  tasks: GlobalTask[];
  onToggleTask: (task: GlobalTask) => void;
  onNavigateToNoteById: (id: string, lineIndex?: number) => void;
  activeNote?: Note;
  /** Cards in the column, top first. */
  openPanes: readonly RightTab[];
  onTogglePane: (tab: RightPanelTab) => void;
  /** Swaps the two cards in the column. */
  onSwapPanes: () => void;
  /** Phone drawer: replace the single visible card. */
  onShowOnlyPane: (tab: RightPanelTab) => void;
  badges: PaneBadges;
  /** Phone drawer: one card, picked from a tab strip inside the panel. */
  single?: boolean;
  /** The card stretched over the editor's area, if any. */
  expandedPane: RightTab | null;
  onToggleExpandPane: (tab: RightPanelTab) => void;
  notes: Note[];
  folders?: Folder[];
  settings: AppSettings;
  activeNoteId?: string;
  onUpdateNote?: (content: string) => void;
  onFrontmatterChange?: (rawFrontmatter: string | undefined) => void;
}

export default function RightPanel({
  tasks, onToggleTask, onNavigateToNoteById, activeNote,
  openPanes, onTogglePane, onSwapPanes, onShowOnlyPane, badges, single = false,
  expandedPane, onToggleExpandPane,
  notes, folders, settings, activeNoteId, onUpdateNote, onFrontmatterChange,
}: RightPanelProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [graphSearch, setGraphSearch] = useState('');
  const [showGraphSearch, setShowGraphSearch] = useState(false);
  const graphSearchRef = useRef<HTMLDivElement>(null);
  const deferredGraphSearch = useDeferredValue(graphSearch);
  const [showFilters, setShowFilters] = useState(false);
  const [localDepth, setLocalDepth] = useState(0);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [colorMode, setColorMode] = useState<GraphColorMode>('tag');
  const [arrows, setArrows] = useState(false);
  const [nodeSize, setNodeSize] = useState(DEFAULT_NODE_SIZE);
  const [linkThickness, setLinkThickness] = useState(DEFAULT_LINK_THICKNESS);
  const [graphGroups, setGraphGroups] = useState<GraphGroup[]>([]);
  const [animateKey, setAnimateKey] = useState(0);
  const [graphForces, setGraphForces] = useState<GraphForces>(DEFAULT_GRAPH_FORCES);
  const [labelFadeThreshold, setLabelFadeThreshold] = useState(DEFAULT_LABEL_FADE_THRESHOLD);
  useEffect(() => {
    if (!showGraphSearch) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!graphSearchRef.current?.contains(event.target as Node)) setShowGraphSearch(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showGraphSearch]);
  // Counts only settings that drop nodes; colour and size are display-only.
  const activeFilterCount =
    (localDepth > 0 && activeNoteId ? 1 : 0) +
    (tagFilter.length > 0 ? 1 : 0) +
    (showUnresolved ? 0 : 1);
  const clearGraphFilters = () => {
    setGraphSearch('');
    setHideIsolated(false);
    setLocalDepth(0);
    setTagFilter([]);
    setShowUnresolved(true);
  };
  const restoreGraphDefaults = () => {
    clearGraphFilters();
    setColorMode('tag');
    setArrows(false);
    setNodeSize(DEFAULT_NODE_SIZE);
    setLinkThickness(DEFAULT_LINK_THICKNESS);
    setGraphGroups([]);
    setGraphForces(DEFAULT_GRAPH_FORCES);
    setLabelFadeThreshold(DEFAULT_LABEL_FADE_THRESHOLD);
  };

  // Topology-stable snapshot: notes gets a new identity on every keystroke, but the chips and graph
  // only depend on structure, so content-only edits skip the downstream recompute.
  const topologyKey = useMemo(() => computeTopologySignature(notes, folders), [notes, folders]);
  const stableTopologyRef = useRef<{ key: string; notes: Note[]; folders?: Folder[] }>({ key: '', notes: [], folders: undefined });
  if (stableTopologyRef.current.key !== topologyKey) {
    stableTopologyRef.current = { key: topologyKey, notes, folders };
  }
  const topologyNotes = stableTopologyRef.current.notes;
  const topologyFolders = stableTopologyRef.current.folders;

  // All tags across notes (ordered by first appearance for stable chip order).
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of topologyNotes) {
      for (const t of n.tags ?? []) {
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
    return out;
  }, [topologyNotes]);
  // Same first-appearance order as GraphView's tag colour map, so chip dots match node dots.
  const tagColors = useMemo(
    () => new Map(allTags.map((tag, i) => [tag, TAG_PALETTE[i % TAG_PALETTE.length]])),
    [allTags]
  );
  useLayoutEffect(() => {
    setTagFilter((selected) => pruneGraphTagFilter(selected, allTags));
  }, [allTags]);
  const [showGraphGuide, setShowGraphGuide] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN); } catch { return true; }
  });

  // The phone drawer shows the most recently opened card only.
  const visiblePanes = useMemo(
    () => (single ? openPanes.slice(-1) : openPanes),
    [single, openPanes]
  );
  const slots = usePaneSlots(visiblePanes);
  // The oldest card sits at the top of the column, under the titlebar, so its header is the only one that drags the window.
  const topPane = useMemo(
    () => [...visiblePanes].sort((a, b) => slots.orderOf(a) - slots.orderOf(b))[0],
    [visiblePanes, slots]
  );
  // Mirrors PaneCard's own header controls.
  const graphToggleClass = `relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer ${
    isDark
      ? 'text-[rgba(249,249,247,0.45)] hover:text-[#F9F9F7] hover:bg-[var(--bg-sidebar-raised,#ECEBE8)]'
      : 'text-[#2D2D2B]/45 hover:text-[#2D2D2B] hover:bg-[var(--bg-sidebar-raised,#ECEBE8)]'
  }`;

  // Once opened, the graph stays mounted while closed so its simulation and viewport survive.
  const isGraphOpen = visiblePanes.includes('graph');
  const [hasVisitedGraph, setHasVisitedGraph] = useState(isGraphOpen);
  useEffect(() => {
    if (isGraphOpen) setHasVisitedGraph(true);
  }, [isGraphOpen]);

  // An expanded card has the column to itself; the other stays mounted,
  // shrunk away, and comes back when the takeover ends.
  const expanded = !single && expandedPane !== null && visiblePanes.includes(expandedPane) ? expandedPane : null;
  // Escape gives the editor back. Not while a field in the card has focus:
  // there Escape belongs to the field.
  useEffect(() => {
    if (expanded === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      onToggleExpandPane(expanded);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expanded, onToggleExpandPane]);

  // Two cards split the column's height, and the gap between them is a drag
  // handle. `split` is the upper card's share.
  const cardsRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEYS.PANE_SPLIT));
      return saved >= PANE_SPLIT_MIN && saved <= 1 - PANE_SPLIT_MIN ? saved : 0.5;
    } catch { return 0.5; }
  });
  const [isSplitDragging, setIsSplitDragging] = useState(false);
  const splitPair = !single && expanded === null && visiblePanes.length === 2
    ? [...visiblePanes].sort((a, b) => slots.orderOf(a) - slots.orderOf(b))
    : null;
  const handleSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const column = cardsRef.current;
    if (!column || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    // Tells the graph this resize is a mask moving over it, not a new frame to
    // fit: it holds its scale and its place on screen (GraphView).
    document.documentElement.setAttribute('data-pane-split-drag', 'true');
    setIsSplitDragging(true);
    let latest = split;
    // Drag writes flex-grow straight to the two cards per frame and commits to state on release,
    // so the panel doesn't re-render on every pointer event.
    const upper = splitPair ? column.querySelector<HTMLElement>(`[data-pane="${splitPair[0]}"]`) : null;
    const lower = splitPair ? column.querySelector<HTMLElement>(`[data-pane="${splitPair[1]}"]`) : null;
    const rect = column.getBoundingClientRect();
    let frame: number | null = null;
    const paint = () => {
      frame = null;
      if (upper) upper.style.flexGrow = String(latest);
      if (lower) lower.style.flexGrow = String(1 - latest);
    };
    const move = (e: PointerEvent) => {
      if (rect.height <= 0) return;
      latest = Math.min(1 - PANE_SPLIT_MIN, Math.max(PANE_SPLIT_MIN, (e.clientY - rect.top) / rect.height));
      if (frame === null) frame = requestAnimationFrame(paint);
    };
    const end = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      paint();
      setSplit(latest);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      // A frame late, so the graph's resize observer sees the last size while
      // the flag is still up.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.documentElement.removeAttribute('data-pane-split-drag');
      }));
      setIsSplitDragging(false);
      try { localStorage.setItem(STORAGE_KEYS.PANE_SPLIT, String(latest)); } catch { /* quota exceeded */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  // Moving a card writes transforms straight to the two cards per pointer event, like the split drag,
  // and commits the new order to state only on release.
  const [movingPane, setMovingPane] = useState<RightTab | null>(null);
  // Tears down an in-flight move if the panel unmounts mid-drag or mid-settle, so the document-level
  // cursor/overflow override and the Escape listener don't outlive it.
  const moveCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => moveCleanupRef.current?.(), []);
  const handleMovePointerDown = (id: RightTab) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const column = cardsRef.current;
    // movingPane stays set until the settle commits; a grab during it would read mid-animation positions.
    if (!column || !splitPair || event.button !== 0 || movingPane !== null) return;
    const otherId = splitPair[0] === id ? splitPair[1] : splitPair[0];
    const held = column.querySelector<HTMLElement>(`[data-pane="${id}"]`);
    const other = column.querySelector<HTMLElement>(`[data-pane="${otherId}"]`);
    if (!held || !other) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heldRect = held.getBoundingClientRect();
    const otherRect = other.getBoundingClientRect();
    const heldIsUpper = splitPair[0] === id;
    // Where each card would sit after a swap, relative to where it sits now. Each card keeps its own height.
    const gap = heldIsUpper ? otherRect.top - heldRect.bottom : heldRect.top - otherRect.bottom;
    const heldShift = heldIsUpper ? otherRect.height + gap : -(otherRect.height + gap);
    const otherShift = heldIsUpper ? -(heldRect.height + gap) : heldRect.height + gap;
    const otherCentre = otherRect.top + otherRect.height / 2;
    const startX = event.clientX;
    const startY = event.clientY;
    const heldSpring = createSpring(held, reduceMotion);
    const otherSpring = createSpring(other, reduceMotion);
    let started = false;
    let swapped = false;
    let finished = false;

    const detach = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', release);
      handle.removeEventListener('pointercancel', abort);
      handle.removeEventListener('lostpointercapture', abort);
      document.removeEventListener('keydown', escape, true);
    };
    moveCleanupRef.current = () => {
      detach();
      heldSpring.stop();
      otherSpring.stop();
      document.documentElement.removeAttribute('data-pane-move-drag');
    };

    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!started) {
        if (Math.hypot(dx, dy) < PANE_MOVE_THRESHOLD) return;
        started = true;
        setMovingPane(id);
        document.documentElement.setAttribute('data-pane-move-drag', 'true');
      }
      heldSpring.set(dx, dy);
      const nextSwapped = heldIsUpper ? e.clientY > otherCentre : e.clientY < otherCentre;
      if (nextSwapped !== swapped) {
        swapped = nextSwapped;
        otherSpring.to(0, swapped ? otherShift : 0);
      }
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      detach();
      if (!started) {
        moveCleanupRef.current = null;
        return;
      }
      const doSwap = commit && swapped;
      if (!doSwap) otherSpring.to(0, 0);
      // Settle the held card into its slot, then swap the order in state and drop the transforms in one commit.
      heldSpring.to(0, doSwap ? heldShift : 0, () => {
        otherSpring.stop();
        flushSync(() => {
          if (doSwap) {
            onSwapPanes();
            const nextSplit = 1 - split;
            setSplit(nextSplit);
            try { localStorage.setItem(STORAGE_KEYS.PANE_SPLIT, String(nextSplit)); } catch { /* quota exceeded */ }
          }
          setMovingPane(null);
        });
        held.style.transform = '';
        other.style.transform = '';
        document.documentElement.removeAttribute('data-pane-move-drag');
        moveCleanupRef.current = null;
      });
    };
    const release = () => finish(true);
    const abort = () => finish(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !started) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', abort);
    // Capture can drop without a pointerup (the button re-rendering away, the OS taking the pointer); treat it as a cancel.
    handle.addEventListener('lostpointercapture', abort);
    document.addEventListener('keydown', escape, true);
  };

  const slotState = (id: RightTab): PaneSlotState | null => {
    if (slots.isOpen(id)) return expanded !== null && expanded !== id ? 'minimized' : 'open';
    if (id === 'graph' && hasVisitedGraph) return 'hidden';
    return null;
  };

  const renderCard = (id: RightTab) => {
    const state = slotState(id);
    if (state === null) return null;
    const card = {
      id,
      state,
      order: slots.orderOf(id),
      dragsWindow: id === topPane,
      grow: splitPair && state === 'open' ? (splitPair[0] === id ? split : 1 - split) : undefined,
      isDark,
      isExpanded: expanded === id,
      onToggleExpand: single ? undefined : () => onToggleExpandPane(id),
      onClose: single ? undefined : () => onTogglePane(id),
      onMovePointerDown: splitPair && state === 'open' ? handleMovePointerDown(id) : undefined,
      isMoving: movingPane === id,
    };
    switch (id) {
      case 'tasks':
        return (
          <PaneCard key={id} {...card}>
            <TasksPanel tasks={tasks} onToggleTask={onToggleTask} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
          </PaneCard>
        );
      case 'backlinks':
        return (
          <PaneCard key={id} {...card}>
            <BacklinksPanel activeNote={activeNote} notes={notes} folders={folders} onNavigateToNoteById={onNavigateToNoteById} />
          </PaneCard>
        );
      case 'outgoing':
        return (
          <PaneCard key={id} {...card}>
            <OutgoingLinksPanel activeNote={activeNote} notes={notes} folders={folders} onNavigateToNoteById={onNavigateToNoteById} />
          </PaneCard>
        );
      case 'properties':
        return (
          <PaneCard key={id} {...card}>
            <PropertiesPanel fontSize={settings.editor.fontSize} activeNote={activeNote} notes={notes} onUpdateNote={onUpdateNote} onFrontmatterChange={onFrontmatterChange} />
          </PaneCard>
        );
      case 'graph':
        return (
          <PaneCard
            key={id}
            {...card}
            actions={(
              <>
                <div className="mr-0.5 flex items-center gap-0.5"
                  role="group"
                  aria-label="Graph filter controls">
                  <div ref={graphSearchRef} className="relative"
                    onBlur={event => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setShowGraphSearch(false);
                    }}
                    onKeyDown={event => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      setShowGraphSearch(false);
                      graphSearchRef.current?.querySelector('button')?.focus();
                    }}>
                    <button onClick={() => setShowGraphSearch(v => !v)}
                      title="Search graph" aria-label="Search graph" aria-expanded={showGraphSearch}
                      className={graphToggleClass}
                      style={showGraphSearch || graphSearch ? { color: '#CC7D5E' } : undefined}>
                      <Search size={13} />
                    </button>
                    {showGraphSearch && (
                      // The same floating surface as the app's popup menus (PaneMenu):
                      // 10px corners, hairline, floating shadow, card colour. The
                      // field is one compact 28px row.
                      <div className={`noa-floating-panel absolute right-0 top-full z-30 mt-1.5 flex h-7 w-44 items-center gap-1.5 rounded-lg pl-2 pr-1 font-ui ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[#F9F9F7]'}`}>
                        <Search size={11} className={`shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.4)]' : 'text-[#2D2D2B]/40'}`} />
                        <input autoFocus type="text" value={graphSearch} onChange={e => setGraphSearch(e.target.value)}
                          aria-label="Filter graph nodes" placeholder="Filter nodes…"
                          className={`min-w-0 flex-1 bg-transparent text-xs leading-normal outline-none ${isDark ? 'placeholder:text-[rgba(249,249,247,0.35)]' : 'placeholder:text-[#2D2D2B]/35'}`}
                          style={{ color: isDark ? '#F9F9F7' : '#2D2D2B' }} />
                        {graphSearch && (
                          <button type="button" onClick={() => setGraphSearch('')}
                            title="Clear" aria-label="Clear filter"
                            className={`${graphToggleClass} !h-4 !w-4`}>
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Name stays fixed so aria-pressed carries the state without contradicting it; `title` flips as a tooltip. */}
                  <button onClick={() => setHideIsolated(v => !v)} title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                    aria-label="Hide isolated nodes"
                    aria-pressed={hideIsolated}
                    className={graphToggleClass}
                    style={hideIsolated ? { color: '#CC7D5E' } : undefined}>
                    <Network size={13} />
                  </button>
                  {/* Colour shows the drawer is open; the dot shows filters are applied. The name may carry the count. */}
                  <button onClick={() => setShowFilters(v => !v)}
                    title={`${showFilters ? 'Hide filters' : 'Show filters'}${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
                    aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
                    aria-pressed={showFilters}
                    className={graphToggleClass}
                    style={showFilters ? { color: '#CC7D5E' } : undefined}>
                    <Filter size={13} />
                    {activeFilterCount > 0 && (
                      <span aria-hidden="true" className="absolute top-px right-px w-1 h-1 rounded-full bg-[var(--accent-color,#CC7D5E)]" />
                    )}
                  </button>
                </div>
              </>
            )}
          >
            <div className="flex-1 min-h-0 flex flex-col">
              {showGraphGuide && (
                <div className={`mx-2 mb-2 shrink-0 rounded-md border border-[var(--divider-subtle)] px-3 py-2 text-xs leading-relaxed ${isDark ? 'bg-[var(--bg-secondary)] text-[rgba(249,249,247,0.65)]' : 'bg-[var(--bg-sidebar-raised,#ECEBE8)] text-[#2D2D2B]/80'}`}>
                  <div className={`font-bold uppercase tracking-[0.14em] text-micro mb-1 ${isDark ? 'text-[rgba(249,249,247,0.75)]' : 'text-[#2D2D2B]/60'}`}>Graph Guide</div>
                  <div>Node size reflects connectivity. Use the search icon to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
                  <button
                    onClick={() => {
                      setShowGraphGuide(false);
                      try { localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1'); } catch { /* quota exceeded */ }
                    }}
                    // Same button as the storage notice's "Got it" (App.tsx), except the
                    // hover wash: this card's light floor is already the sidebar-raised surface, the same
                    // as the notice's hover:bg-[var(--bg-sidebar-raised,#ECEBE8)], so it would give no feedback here.
                    className="mt-2 text-xs font-bold border border-[var(--divider-subtle)] px-3 py-1.5 rounded text-[#2D2D2B]/60 hover:text-[#2D2D2B] hover:bg-[var(--divider-subtle)] transition-colors"
                  >
                    Got it
                  </button>
                </div>
              )}
              {showFilters && (
                <GraphFilterPanel
                  isDark={isDark}
                  localDepth={localDepth}
                  onLocalDepthChange={setLocalDepth}
                  hasActiveNote={!!activeNoteId}
                  colorMode={colorMode}
                  onColorModeChange={setColorMode}
                  arrows={arrows}
                  onArrowsChange={setArrows}
                  nodeSize={nodeSize}
                  onNodeSizeChange={setNodeSize}
                  linkThickness={linkThickness}
                  onLinkThicknessChange={setLinkThickness}
                  groups={graphGroups}
                  onGroupsChange={setGraphGroups}
                  onAnimate={() => setAnimateKey((k) => k + 1)}
                  showUnresolved={showUnresolved}
                  onShowUnresolvedChange={setShowUnresolved}
                  forces={graphForces}
                  onForcesChange={setGraphForces}
                  labelFadeThreshold={labelFadeThreshold}
                  onLabelFadeThresholdChange={setLabelFadeThreshold}
                  allTags={allTags}
                  tagColors={tagColors}
                  tagFilter={tagFilter}
                  onTagFilterChange={setTagFilter}
                  onRestoreDefaults={restoreGraphDefaults}
                />
              )}
              {/* Lists open over the canvas rather than shrinking it: GraphView doesn't re-fit on resize, so height taken would crop nodes. */}
              <div className="flex-1 min-h-[120px] overflow-hidden">
                <GraphView notes={topologyNotes} folders={topologyFolders} onNavigateToNoteById={onNavigateToNoteById} settings={settings}
                  searchQuery={deferredGraphSearch} activeNoteId={activeNoteId}
                  hideIsolated={hideIsolated} localDepth={localDepth} tagFilter={tagFilter}
                  colorMode={colorMode} showUnresolved={showUnresolved}
                  arrows={arrows} nodeSize={nodeSize} linkThickness={linkThickness} groups={graphGroups}
                  animateKey={animateKey}
                  forces={graphForces} labelFadeThreshold={labelFadeThreshold}
                  onClearFilters={clearGraphFilters} onEnableHideIsolated={() => setHideIsolated(true)} />
              </div>
              <GraphInfoPanel
                notes={topologyNotes}
                folders={topologyFolders}
                activeNoteId={activeNoteId}
                onNavigateToNoteById={onNavigateToNoteById}
                isDark={isDark}
                hideIsolated={hideIsolated}
                localDepth={localDepth}
                tagFilter={tagFilter}
                searchQuery={deferredGraphSearch}
                showUnresolved={showUnresolved}
              />
            </div>
          </PaneCard>
        );
    }
  };

  return (
    <div className={`w-full h-full min-h-0 flex flex-col shrink-0 relative ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[#F9F9F7]'}`}>
      {single && (
        <div className="h-10 shrink-0 flex items-center px-2">
          <div
            className="w-full flex items-stretch gap-0.5 rounded-md p-0.5"
            style={{
              background: isDark ? THEME_SURFACES.dark.secondary : '#ECEAE6',
              boxShadow: isDark
                ? 'inset 0 0 0 1px rgba(249,249,247,0.08)'
                : 'inset 0 0 0 1px var(--divider-subtle, #E6E2DA)',
            }}
          >
            <PaneTabs activePanes={visiblePanes} onSelect={onShowOnlyPane} badges={badges} isDark={isDark} />
          </div>
        </div>
      )}
      {/* The cards float on the page: 8px of it shows on every side and
          between them. The gap above each card is its own margin rather than
          a flex gap, so a card shrinking out takes its gap with it. */}
      {/* The 8px of page above the first card drags the window too. */}
      {!single && <div aria-hidden="true" className="absolute inset-x-0 top-0 h-2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />}
      <div ref={cardsRef} className="flex-1 min-h-0 flex flex-col px-2 pb-2">
        {RIGHT_TABS.map(renderCard)}
        {splitPair && (
          // Zero-height, sharing the upper card's `order` and later in the DOM,
          // so it lands exactly on the 8px gap between the two cards.
          <div className="relative z-10 h-0 shrink-0" style={{ order: slots.orderOf(splitPair[0]) }}>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panels"
              onPointerDown={handleSplitPointerDown}
              onDoubleClick={() => {
                setSplit(0.5);
                try { localStorage.setItem(STORAGE_KEYS.PANE_SPLIT, '0.5'); } catch { /* quota exceeded */ }
              }}
              className="group absolute inset-x-0 top-0 flex h-2 cursor-row-resize touch-none items-center justify-center"
            >
              <span
                className={`h-[3px] w-9 rounded-full bg-[var(--text-primary,#2D2D2B)] transition-opacity duration-150 ${isSplitDragging ? 'opacity-70' : 'opacity-0 group-hover:opacity-50'}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Graph Info Panel ──────────────────────────────────────────────────────────

interface GraphInfoPanelProps {
  notes: Note[];
  folders?: Folder[];
  activeNoteId?: string;
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
  hideIsolated?: boolean;
  localDepth?: number;
  tagFilter?: string[];
  searchQuery?: string;
  showUnresolved?: boolean;
}

function GraphInfoPanel({
  notes,
  folders,
  activeNoteId,
  onNavigateToNoteById,
  isDark = false,
  hideIsolated = false,
  localDepth = 0,
  tagFilter,
  searchQuery,
  showUnresolved = true,
}: GraphInfoPanelProps) {
  // Same guard as GraphView: content-only edits don't rebuild the graph model.
  const topologyKey = useMemo(() => computeTopologySignature(notes, folders), [notes, folders]);
  const stableNotesRef = useRef<{ key: string; notes: Note[]; folders: Folder[] }>({ key: '', notes: [], folders: [] });
  if (stableNotesRef.current.key !== topologyKey) {
    stableNotesRef.current = { key: topologyKey, notes, folders: folders ?? [] };
  }
  const graphModel = useMemo(() => buildGraphModel(stableNotesRef.current.notes, {
    activeNoteId,
    hideIsolated,
    localDepth,
    tagFilter,
    searchQuery,
    folders: stableNotesRef.current.folders,
    showUnresolved,
  // topologyKey stands in for the notes/folders arrays (see stableNotesRef above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [topologyKey, activeNoteId, hideIsolated, localDepth, tagFilter, searchQuery, showUnresolved]);
  const { stats } = graphModel;
  // Lookup map so per-row title resolution is O(1) instead of scanning `notes`
  // for every connection / ranked entry on each render.
  const notesById = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes]);
  // Ghost connections have no note to list — drop them BEFORE slicing so the
  // rendered rows and the "+N more" count agree.
  const activeConnections = useMemo(
    () => graphModel.activeConnections.filter((id) => notesById.has(id)),
    [graphModel.activeConnections, notesById]
  );

  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.GRAPH_CONNECTIONS_OPEN) === '1'; } catch { return false; }
  });
  const toggleOpen = () => {
    setIsOpen((open) => {
      try { localStorage.setItem(STORAGE_KEYS.GRAPH_CONNECTIONS_OPEN, open ? '0' : '1'); } catch { /* quota exceeded */ }
      return !open;
    });
  };
  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  const strong = isDark ? 'text-[rgba(249,249,247,0.85)]' : 'text-[#2D2D2B]/85';
  const summary = [
    { label: 'notes', value: stats.totalNotes },
    { label: 'links', value: stats.totalLinks },
    { label: 'isolated', value: stats.isolated },
  ];

  // Only the chevron is the control: a 20px block like the header's, in the
  // same column as the close button above it.
  const toggle = (
    <button
      onClick={toggleOpen}
      aria-expanded={isOpen}
      aria-controls="noa-graph-connections"
      aria-label={isOpen ? 'Hide connections' : 'Show connections'}
      title={isOpen ? 'Hide connections' : 'Show connections'}
      className={`ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors ${
        isDark
          ? 'hover:bg-[var(--bg-sidebar-raised,#ECEBE8)] hover:text-[#F9F9F7]'
          : 'hover:bg-[var(--bg-sidebar-raised,#ECEBE8)] hover:text-[#2D2D2B]'
      }`}
    >
      {isOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
    </button>
  );
  return (
    // A one-line summary under the canvas. The lists are a drawer that opens
    // upward over the canvas's bottom edge, so the graph keeps its size.
    // No rule above the summary: expanded beside the sidebar it sat a few
    // pixels off the sidebar footer's own rule, two lines that almost met.
    <div className="relative shrink-0 font-ui">
      {isOpen && (
        <div
          id="noa-graph-connections"
          className={`absolute inset-x-0 bottom-full max-h-56 overflow-y-auto border-t-[0.5px] border-[var(--divider-subtle)] bg-[var(--bg-card,#FFFFFF)]`}
        >
          {/* Open, the toggle rides the drawer's top edge — where the thing
              it closes begins — and stays there while the lists scroll. The
              first heading is kept clear of it. */}
          <div className={`sticky top-0 z-10 flex h-0 justify-end pr-1.5 ${muted}`}>
            <span className="mt-[9px]">{toggle}</span>
          </div>
          <div className="px-3 pt-3 pb-2 space-y-3 [&>div:first-child>div:first-child]:pr-6">
        {activeNoteId && (
              <div>
                <div className={`text-micro uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50'}`}>
                  Active · {notesById.get(activeNoteId)?.title ?? 'Unknown'}
                </div>
                {activeConnections.length === 0 ? (
                  <div className={`text-micro italic ${isDark ? 'text-[rgba(249,249,247,0.55)]' : 'text-[#2D2D2B]/40'}`}>No connections</div>
                ) : (
                  <div className="space-y-1">
                    {activeConnections.slice(0, 6).map(id => {
                      const target = notesById.get(id);
                      if (!target) return null;
                      const degree = stats.degreeMap.get(id) ?? 0;
                      return (
                        <button key={id} onClick={() => onNavigateToNoteById(id)}
                          className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/70 hover:text-[#CC7D5E]'}`}>
                                        {/* Same degree-sized square as Most Connected below. A Phosphor Circle drew a hollow ring here. */}
                          <div className="shrink-0 bg-[#CC7D5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                          <span className="truncate">{target.title}</span>
                          <span className={`ml-auto text-micro tabular-nums shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/30'}`}>{degree}</span>
                        </button>
                      );
                    })}
                    {activeConnections.length > 6 && (
                      <div className={`text-micro pl-3 ${isDark ? 'text-[rgba(249,249,247,0.55)]' : 'text-[#2D2D2B]/40'}`}>+{activeConnections.length - 6} more</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {stats.ranked.length > 0 && (
              <div>
                <div className={`text-micro uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50'}`}>Most Connected</div>
                <div className="space-y-1">
                  {stats.ranked.map(([id, degree]) => {
                    const target = notesById.get(id);
                    if (!target) return null;
                    return (
                      <button key={id} onClick={() => onNavigateToNoteById(id)}
                        className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/70 hover:text-[#CC7D5E]'}`}>
                        <div className="shrink-0 bg-[#CC7D5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                        <span className="truncate">{target.title}</span>
                        <span className={`ml-auto text-micro tabular-nums shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/40'}`}>{degree}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className={`flex h-8 w-full items-center gap-1.5 pl-3 pr-1.5 text-caption ${muted}`}>
        {summary.map(({ label, value }, index) => (
          <React.Fragment key={label}>
            {index > 0 && <span aria-hidden="true">·</span>}
            <span><span className={`tabular-nums font-medium ${strong}`}>{value}</span> {label}</span>
          </React.Fragment>
        ))}
        {!isOpen && toggle}
      </div>
    </div>
  );
}

// ── Graph Filter Panel ────────────────────────────────────────────────────────

interface GraphFilterPanelProps {
  isDark: boolean;
  localDepth: number;
  onLocalDepthChange: (v: number) => void;
  hasActiveNote: boolean;
  showUnresolved: boolean;
  onShowUnresolvedChange: (v: boolean) => void;
  allTags: string[];
  tagColors: Map<string, string>;
  tagFilter: string[];
  onTagFilterChange: (v: string[]) => void;
  groups: GraphGroup[];
  onGroupsChange: (v: GraphGroup[]) => void;
  colorMode: GraphColorMode;
  onColorModeChange: (v: GraphColorMode) => void;
  arrows: boolean;
  onArrowsChange: (v: boolean) => void;
  labelFadeThreshold: number;
  onLabelFadeThresholdChange: (v: number) => void;
  nodeSize: number;
  onNodeSizeChange: (v: number) => void;
  linkThickness: number;
  onLinkThicknessChange: (v: number) => void;
  onAnimate: () => void;
  forces: GraphForces;
  onForcesChange: (v: GraphForces) => void;
  onRestoreDefaults: () => void;
}

// Collapsible block in the filter drawer. Local state: the drawer remounts on close, so sections re-open by default.
function GraphDrawerSection({ title, meta, isDark, defaultOpen = true, children }: {
  title: string;
  meta?: string;
  isDark: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between font-bold uppercase tracking-[0.14em] text-micro transition-colors cursor-pointer ${muted} ${isDark ? 'hover:text-[rgba(249,249,247,0.8)]' : 'hover:text-[#2D2D2B]/75'}`}
      >
        <span>{title}</span>
        <span className="flex items-center gap-1.5 normal-case tracking-normal font-normal">
          {meta && <span className="tabular-nums">{meta}</span>}
          <ChevronDown size={11} className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
        </span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </section>
  );
}

function GraphFilterPanel({
  isDark,
  localDepth,
  onLocalDepthChange,
  hasActiveNote,
  showUnresolved,
  onShowUnresolvedChange,
  allTags,
  tagColors,
  tagFilter,
  onTagFilterChange,
  groups,
  onGroupsChange,
  colorMode,
  onColorModeChange,
  arrows,
  onArrowsChange,
  labelFadeThreshold,
  onLabelFadeThresholdChange,
  nodeSize,
  onNodeSizeChange,
  linkThickness,
  onLinkThicknessChange,
  onAnimate,
  forces,
  onForcesChange,
  onRestoreDefaults,
}: GraphFilterPanelProps) {
  const [groupDraft, setGroupDraft] = useState('');
  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  const labelCls = `text-caption w-16 shrink-0 whitespace-nowrap ${muted}`;
  const resetCls = `text-caption cursor-pointer ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/55 hover:text-[#CC7D5E]'}`;
  const toggleTag = (t: string) => {
    onTagFilterChange(tagFilter.includes(t) ? tagFilter.filter((x) => x !== t) : [...tagFilter, t]);
  };
  const addGroup = () => {
    const query = groupDraft.trim();
    if (!query) return;
    // Colours cycle through the tag palette in creation order, as Obsidian assigns them.
    onGroupsChange([...groups, { query, color: TAG_PALETTE[groups.length % TAG_PALETTE.length] }]);
    setGroupDraft('');
  };
  const depthLabel = localDepth === 0 ? 'All' : `${localDepth} hop${localDepth > 1 ? 's' : ''}`;
  // One control for every two-way choice: a quiet inset track with the chosen
  // option raised out of it — the same idiom as the phone drawer's tab strip.
  // No active:opacity press-fade: the raised pill moving is the click feedback,
  // and dimming the label right before it lands reads as a flicker.
  const segment = <T extends string | boolean>(
    name: string,
    value: T,
    options: ReadonlyArray<readonly [T, string]>,
    onChange: (v: T) => void,
    title?: string,
  ) => (
    <div className="flex items-center gap-2">
      <span className={labelCls}>{name}</span>
      <div
        role="group"
        aria-label={name}
        title={title}
        className={`relative flex flex-1 gap-0.5 rounded-md p-0.5 ${isDark ? 'bg-[rgba(249,249,247,0.06)]' : 'bg-[rgba(45,45,43,0.05)]'}`}
      >
        {/* One raised thumb slides between halves so the choice visibly moves; far position = thumb width + gap. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-3px)] rounded transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          style={{
            transform: options.findIndex(([option]) => option === value) === 1 ? 'translateX(calc(100% + 2px))' : 'none',
            background: isDark ? '#41413F' : '#FFFFFF',
            boxShadow: isDark
              ? '0 1px 2px rgba(0,0,0,0.28), 0 0 0 1px rgba(249,249,247,0.06)'
              : '0 1px 2px rgba(45,45,43,0.08), 0 0 0 1px rgba(45,45,43,0.04)',
          }}
        />
        {options.map(([option, label]) => {
          const active = option === value;
          return (
            <button
              key={String(option)}
              onClick={() => onChange(option)}
              aria-pressed={active}
              className={`relative flex-1 h-5 rounded text-caption transition-colors duration-200 cursor-pointer ${
                active
                  ? (isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]')
                  : isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#F9F9F7]' : 'text-[#2D2D2B]/50 hover:text-[#2D2D2B]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
  const sliderRow = (name: string, value: number, min: number, max: number, step: number, format: (v: number) => string, onChange: (v: number) => void, title?: string) => (
    <div className="flex items-center gap-2" title={title}>
      <span className={labelCls}>{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={name}
        className="flex-1 h-1 accent-[#CC7D5E]"
      />
      <span className={`text-caption tabular-nums w-10 text-right ${muted}`}>{format(value)}</span>
    </div>
  );
  const formatMultiplier = (v: number) => `${v.toFixed(1)}×`;
  return (
    <div className="mx-3 mb-2 space-y-4 border-b-[0.5px] border-[var(--divider-subtle)] pb-4 pt-2 shrink-0">
      <GraphDrawerSection title="Filters" isDark={isDark}>
        <div className="flex items-center gap-2">
          <span className={labelCls}>Depth</span>
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={localDepth}
            onChange={(e) => onLocalDepthChange(Number(e.target.value))}
            disabled={!hasActiveNote}
            aria-label="Depth"
            className="flex-1 h-1 accent-[#CC7D5E] disabled:opacity-40"
          />
          <span className={`text-caption tabular-nums w-10 text-right ${muted}`}>{hasActiveNote ? depthLabel : '—'}</span>
        </div>
        {segment('Ghosts', showUnresolved, [[true, 'Shown'], [false, 'Hidden']], onShowUnresolvedChange, "Show links to notes that don't exist yet")}
        {allTags.length > 0 && (
          <GraphDrawerSection title="Tags" meta={tagFilter.length > 0 ? `${tagFilter.length} selected` : `${allTags.length}`} isDark={isDark} defaultOpen={false}>
            {tagFilter.length > 0 && (
              <div className="flex justify-end -mt-1">
                <button onClick={() => onTagFilterChange([])} className={resetCls}>
                  Clear
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) => {
                const active = tagFilter.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 text-caption px-2 h-5 rounded-full transition-colors cursor-pointer ${
                      active
                        ? ''
                        : isDark
                          ? 'bg-[rgba(249,249,247,0.06)] text-[rgba(249,249,247,0.65)] hover:bg-[rgba(249,249,247,0.1)]'
                          : 'bg-[rgba(45,45,43,0.05)] text-[#2D2D2B]/70 hover:bg-[rgba(45,45,43,0.09)]'
                    }`}
                    // Accent tint, not a solid fill, so the colour-legend dot stays readable.
                    style={active
                      ? { background: 'color-mix(in srgb, var(--accent-color, #CC7D5E) 18%, transparent)', color: isDark ? '#F9F9F7' : '#2D2D2B', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #CC7D5E) 55%, transparent)' }
                      : undefined}
                  >
                    {/* Same palette and order as GraphView's node fill. */}
                    <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tagColors.get(t) }} />
                    {t}
                  </button>
                );
              })}
            </div>
          </GraphDrawerSection>
        )}
      </GraphDrawerSection>

      <GraphDrawerSection title="Groups" meta={groups.length > 0 ? `${groups.length}` : undefined} isDark={isDark}>
        {groups.map((group, index) => (
          <div key={`${index}-${group.query}`} className="flex items-center gap-2">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: group.color }} />
            <span className={`min-w-0 flex-1 truncate text-caption ${isDark ? 'text-[rgba(249,249,247,0.8)]' : 'text-[#2D2D2B]/80'}`}>{group.query}</span>
            <button
              type="button"
              onClick={() => onGroupsChange(groups.filter((_, i) => i !== index))}
              aria-label={`Remove group ${group.query}`}
              title="Remove group"
              className={`text-body leading-none cursor-pointer ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/50 hover:text-[#CC7D5E]'}`}
            >
              ×
            </button>
          </div>
        ))}
        <input
          type="text"
          value={groupDraft}
          onChange={(e) => setGroupDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); }}
          aria-label="New group search"
          placeholder="Add group by title or tag…"
          className={`h-7 w-full rounded-md border border-[var(--divider-subtle)] bg-transparent px-2 text-caption outline-none ${isDark ? 'placeholder:text-[rgba(249,249,247,0.35)]' : 'placeholder:text-[#2D2D2B]/35'}`}
          style={{ color: isDark ? '#F9F9F7' : '#2D2D2B' }}
        />
      </GraphDrawerSection>

      <GraphDrawerSection title="Display" isDark={isDark}>
        {segment('Color', colorMode, [['tag', 'By tag'], ['none', 'Off']], onColorModeChange)}
        {segment('Arrows', arrows, [[true, 'Shown'], [false, 'Hidden']], onArrowsChange, 'Show direction on one-way links')}
        {sliderRow('Labels', labelFadeThreshold, 0.3, 1.5, 0.05, (v) => v.toFixed(2), onLabelFadeThresholdChange, 'Zoom at which labels fully appear')}
        {sliderRow('Node size', nodeSize, 0.5, 2, 0.1, formatMultiplier, onNodeSizeChange)}
        {sliderRow('Link width', linkThickness, 0.5, 3, 0.1, formatMultiplier, onLinkThicknessChange)}
        <div className="flex items-center gap-2">
          <span className={labelCls}>Animate</span>
          <button
            type="button"
            onClick={onAnimate}
            className={`h-5 rounded-md px-2 text-caption cursor-pointer transition-colors ${isDark ? 'bg-[rgba(249,249,247,0.06)] text-[rgba(249,249,247,0.7)] hover:text-[#CC7D5E]' : 'bg-[rgba(45,45,43,0.05)] text-[#2D2D2B]/70 hover:text-[#CC7D5E]'}`}
          >
            Play time-lapse
          </button>
        </div>
      </GraphDrawerSection>

      <GraphDrawerSection title="Forces" isDark={isDark} defaultOpen={false}>
        {sliderRow('Center', forces.center, 0, 3, 0.1, formatMultiplier, (v) => onForcesChange({ ...forces, center: v }), 'Pull toward the middle')}
        {sliderRow('Repel', forces.repel, 0, 3, 0.1, formatMultiplier, (v) => onForcesChange({ ...forces, repel: v }), 'Push nodes apart')}
        {sliderRow('Link', forces.link, 0, 3, 0.1, formatMultiplier, (v) => onForcesChange({ ...forces, link: v }), 'Pull linked nodes together')}
        {sliderRow('Distance', forces.distance, 0, 3, 0.1, formatMultiplier, (v) => onForcesChange({ ...forces, distance: v }), 'Target length of links')}
      </GraphDrawerSection>

      <div className="flex justify-end">
        <button type="button" onClick={onRestoreDefaults} className={resetCls}>
          Restore defaults
        </button>
      </div>
    </div>
  );
}
