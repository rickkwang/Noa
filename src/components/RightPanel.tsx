import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RIGHT_TABS, RIGHT_TAB_LABELS, type PaneBadges, type RightTab } from '../constants/rightTabs';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useIsDark } from '../hooks/useIsDark';
import { buildGraphModel, pruneGraphTagFilter } from '../lib/graphModel';
import { computeTopologySignature } from '../lib/noteUtils';
import { GlobalTask, Note, Folder, AppSettings } from '../types';
import GraphView, { TAG_PALETTE, type GraphColorMode } from './GraphView';
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
 * `order` is the sequence in which cards were opened: the newest always lands
 * at the bottom. Nothing is animated — a card is there or it is not.
 */
function usePaneSlots(open: readonly RightTab[]) {
  const sequenceRef = useRef(0);
  const orderRef = useRef(new Map<RightTab, number>());

  for (const id of [...orderRef.current.keys()]) {
    if (!open.includes(id)) orderRef.current.delete(id);
  }
  for (const id of open) {
    if (!orderRef.current.has(id)) orderRef.current.set(id, ++sequenceRef.current);
  }

  return {
    isOpen: (id: RightTab) => open.includes(id),
    orderOf: (id: RightTab) => orderRef.current.get(id) ?? 0,
  };
}

// One floating card in the right column. Its surface is one step off the
// page in both themes — white on the light page, #313130 on the dark one — so
// the card reads as raised rather than as a hole cut in the page. The header is the same on every card
// so two stacked cards line up; anything card-specific goes in `actions`.
function PaneCard({
  id,
  state,
  order,
  grow,
  isDark,
  actions,
  isExpanded,
  onToggleExpand,
  onClose,
  children,
}: {
  id: RightTab;
  state: PaneSlotState;
  order: number;
  /** Share of the column when two cards split it. */
  grow?: number;
  isDark: boolean;
  actions?: React.ReactNode;
  isExpanded?: boolean;
  /** Absent in the phone drawer, which is already the whole screen. */
  onToggleExpand?: () => void;
  /** Absent in the phone drawer, where the tab strip is the only switch. */
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const title = RIGHT_TAB_LABELS[id];
  // 20px in a 28px row: the hover wash clears the card's top edge by 4px and
  // stays off its rounded corner. A 24px square crowded the corner.
  const controlClass = `flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer ${
    isDark
      ? 'text-[rgba(249,249,247,0.45)] hover:text-[#F9F9F7] hover:bg-[rgba(249,249,247,0.07)]'
      : 'text-[#2D2D2B]/45 hover:text-[#2D2D2B] hover:bg-[#2D2D2B]/[0.06]'
  }`;
  return (
    <section
      aria-label={`${title} panel`}
      data-pane={id}
      data-state={state}
      inert={state === 'open' ? undefined : true}
      className={`noa-pane-card flex flex-col overflow-hidden rounded-[10px] ${isDark ? 'bg-[#313130]' : 'bg-white'}`}
      style={{ order, flexGrow: grow }}
    >
      {/* 28px under the card's 8px top gutter centres this row on 22px — the
          centre line of the 44px titlebar beside it, so the card title and its
          controls sit level with the tabs and the panel menu. */}
      {/* Every card's content keeps a 12px inset on both sides, and this row
          sets it: the title starts at 12px, and pr-1.5 lands the close
          glyph's drawn strokes there too (the X is inset ~2.5px inside its
          13px box), so title, section labels, counts and the close button
          share two vertical lines. */}
      {/* The column is lifted over the titlebar and has to be no-drag as a
          whole (see App.tsx), which took the window's drag strip away along
          its width. The header gives it back: the bar itself drags the
          window, its controls opt out. */}
      <header className="h-7 shrink-0 flex items-center gap-0.5 pl-3 pr-1.5" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <h2 className={`mr-auto truncate text-[12.5px] font-medium font-redaction ${isDark ? 'text-[rgba(249,249,247,0.85)]' : 'text-[#2D2D2B]/85'}`}>{title}</h2>
        <div className="flex min-w-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {actions}
        {onToggleExpand && (
          <button
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
            aria-pressed={isExpanded}
            className={`${controlClass} ${isExpanded ? (isDark ? 'bg-[rgba(249,249,247,0.10)] text-[#F9F9F7]' : 'bg-[#2D2D2B]/[0.07] text-[#2D2D2B]') : ''}`}
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
  /** Cards in the column, oldest first. */
  openPanes: readonly RightTab[];
  onTogglePane: (tab: RightPanelTab) => void;
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
}

export default function RightPanel({
  tasks, onToggleTask, onNavigateToNoteById, activeNote,
  openPanes, onTogglePane, onShowOnlyPane, badges, single = false,
  expandedPane, onToggleExpandPane,
  notes, folders, settings, activeNoteId, onUpdateNote,
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
  const [sizeByDegree, setSizeByDegree] = useState(true);
  useEffect(() => {
    if (!showGraphSearch) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!graphSearchRef.current?.contains(event.target as Node)) setShowGraphSearch(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showGraphSearch]);
  // Drawer settings that drop nodes. Colour and size are display-only, and
  // search / hide-isolated already show their state in the header. Depth with
  // no active note has no anchor, so GraphView ignores it.
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

  // Topology-stable snapshot of notes/folders. The notes array gets a new
  // identity on every keystroke (debounce only guards storage writes, not
  // state), but the tag chips and graph only depend on structural data
  // (titles/links/linkRefs/tags/folders). Key their inputs on the topology
  // signature so content-only edits skip every downstream recompute —
  // including GraphView/GraphInfoPanel's own signature guards, which now see a
  // stable array identity and bail before hashing.
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
  // Same first-appearance order GraphView uses for its tag → colour map, so a
  // chip's dot is the legend for the node's dot.
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
  // Mirrors PaneCard's own header controls.
  const graphToggleClass = `relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer ${
    isDark
      ? 'text-[rgba(249,249,247,0.45)] hover:text-[#F9F9F7] hover:bg-[rgba(249,249,247,0.07)]'
      : 'text-[#2D2D2B]/45 hover:text-[#2D2D2B] hover:bg-[#2D2D2B]/[0.06]'
  }`;

  // Once the graph card is opened, keep it mounted while closed so the force
  // simulation and viewport survive — otherwise reopening replays the "explode
  // and zoom-to-fit" animation every time.
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
    // The drag writes flex-grow straight onto the two cards, once per frame,
    // and only commits to state on release: re-rendering the whole panel on
    // every pointer event is what made the edge trail the cursor.
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
      grow: splitPair && state === 'open' ? (splitPair[0] === id ? split : 1 - split) : undefined,
      isDark,
      isExpanded: expanded === id,
      onToggleExpand: single ? undefined : () => onToggleExpandPane(id),
      onClose: single ? undefined : () => onTogglePane(id),
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
            <BacklinksPanel activeNote={activeNote} notes={notes} folders={folders} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
          </PaneCard>
        );
      case 'outgoing':
        return (
          <PaneCard key={id} {...card}>
            <OutgoingLinksPanel activeNote={activeNote} notes={notes} folders={folders} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
          </PaneCard>
        );
      case 'properties':
        return (
          <PaneCard key={id} {...card}>
            <PropertiesPanel activeNote={activeNote} onUpdateNote={onUpdateNote} isDark={isDark} />
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
                      <div className={`noa-floating-panel absolute right-0 top-full z-30 mt-1.5 flex h-7 w-44 items-center gap-1.5 rounded-lg border border-[var(--divider-subtle)] pl-2 pr-1 font-redaction ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}>
                        <Search size={11} className={`shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.4)]' : 'text-[#2D2D2B]/40'}`} />
                        <input autoFocus type="text" value={graphSearch} onChange={e => setGraphSearch(e.target.value)}
                          aria-label="Filter graph nodes" placeholder="Filter nodes…"
                          className={`min-w-0 flex-1 bg-transparent text-[12px] outline-none ${isDark ? 'placeholder:text-[rgba(249,249,247,0.35)]' : 'placeholder:text-[#2D2D2B]/35'}`}
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
                  {/* Name stays fixed and aria-pressed carries the state. Letting the
                      name flip too (as `title` does) would have a screen reader
                      announce "Show all nodes, pressed" — the label and the state
                      then contradict each other. `title` still flips: as a tooltip
                      it should say what the click will do. */}
                  <button onClick={() => setHideIsolated(v => !v)} title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                    aria-label="Hide isolated nodes"
                    aria-pressed={hideIsolated}
                    className={graphToggleClass}
                    style={hideIsolated ? { color: '#CC7D5E' } : undefined}>
                    <Network size={13} />
                  </button>
                  {/* Colour says the drawer is open; the dot says filters are
                      applied, which has to stay visible once the drawer closes.
                      Unlike hide-isolated above, the name may carry the count:
                      "Filters, 2 active, pressed" doesn't contradict itself. */}
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
                <div className={`mx-2 mb-2 shrink-0 rounded-md border border-[var(--divider-subtle)] px-3 py-2 text-xs leading-relaxed ${isDark ? 'bg-[#252523] text-[rgba(249,249,247,0.65)]' : 'bg-[#EFEAE3] text-[#2D2D2B]/80'}`}>
                  <div className={`font-bold uppercase tracking-[0.14em] text-[10px] mb-1 ${isDark ? 'text-[rgba(249,249,247,0.75)]' : 'text-[#2D2D2B]/60'}`}>Graph Guide</div>
                  <div>Node size reflects connectivity. Use the search icon to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
                  <button
                    onClick={() => {
                      setShowGraphGuide(false);
                      try { localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1'); } catch { /* quota exceeded */ }
                    }}
                    // Same button as the storage notice's "Got it" (App.tsx), except the
                    // hover wash: this card's light floor is already #EFEAE3, so the
                    // notice's hover:bg-[#EFEAE3] would give no feedback here.
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
                  sizeByDegree={sizeByDegree}
                  onSizeByDegreeChange={setSizeByDegree}
                  showUnresolved={showUnresolved}
                  onShowUnresolvedChange={setShowUnresolved}
                  allTags={allTags}
                  tagColors={tagColors}
                  tagFilter={tagFilter}
                  onTagFilterChange={setTagFilter}
                />
              )}
              {/* The canvas gets everything the summary row below does not
                  need. The connection lists open over it rather than beside
                  it: GraphView deliberately doesn't re-fit on resize, so
                  taking height from the canvas would just crop nodes. */}
              <div className="flex-1 min-h-[120px] overflow-hidden">
                <GraphView notes={topologyNotes} folders={topologyFolders} onNavigateToNoteById={onNavigateToNoteById} settings={settings}
                  searchQuery={deferredGraphSearch} activeNoteId={activeNoteId}
                  hideIsolated={hideIsolated} localDepth={localDepth} tagFilter={tagFilter}
                  colorMode={colorMode} sizeByDegree={sizeByDegree} showUnresolved={showUnresolved}
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
    <div className={`w-full h-full min-h-0 flex flex-col shrink-0 relative ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}>
      {single && (
        <div className="h-10 shrink-0 flex items-center px-2">
          <div
            className="w-full flex items-stretch gap-0.5 rounded-md p-0.5"
            style={{
              background: isDark ? '#252523' : '#ECEAE6',
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
  // Same guard as GraphView: topologyKey stands in for `notes`, so content-only
  // edits (which change the notes array identity on every debounced save) don't
  // rebuild the whole graph model — only id/title/link/tag/folder changes do.
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
  // topologyKey is a stable hash standing in for `notes`/`folders` (see
  // stableNotesRef pattern above); depending on the arrays directly would
  // recompute graphModel on every parent re-render with new array identities.
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
          ? 'hover:bg-[rgba(249,249,247,0.07)] hover:text-[#F9F9F7]'
          : 'hover:bg-[#2D2D2B]/[0.06] hover:text-[#2D2D2B]'
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
    <div className="relative shrink-0 font-redaction">
      {isOpen && (
        <div
          id="noa-graph-connections"
          className={`absolute inset-x-0 bottom-full max-h-56 overflow-y-auto border-t border-[var(--divider-subtle)] ${isDark ? 'bg-[#313130]' : 'bg-white'}`}
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
                <div className={`text-[10px] uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50'}`}>
                  Active · {notesById.get(activeNoteId)?.title ?? 'Unknown'}
                </div>
                {activeConnections.length === 0 ? (
                  <div className={`text-[10px] italic ${isDark ? 'text-[rgba(249,249,247,0.55)]' : 'text-[#2D2D2B]/40'}`}>No connections</div>
                ) : (
                  <div className="space-y-1">
                    {activeConnections.slice(0, 6).map(id => {
                      const target = notesById.get(id);
                      if (!target) return null;
                      const degree = stats.degreeMap.get(id) ?? 0;
                      return (
                        <button key={id} onClick={() => onNavigateToNoteById(id)}
                          className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/70 hover:text-[#CC7D5E]'}`}>
                          {/* Same degree-sized square as Most Connected below, so both
                              lists speak one marker language. (A Phosphor Circle here
                              drew a hollow ring — `fill-*` can't fill its stroke path.) */}
                          <div className="shrink-0 bg-[#CC7D5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                          <span className="truncate">{target.title}</span>
                          <span className={`ml-auto text-[10px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/30'}`}>{degree}</span>
                        </button>
                      );
                    })}
                    {activeConnections.length > 6 && (
                      <div className={`text-[10px] pl-3 ${isDark ? 'text-[rgba(249,249,247,0.55)]' : 'text-[#2D2D2B]/40'}`}>+{activeConnections.length - 6} more</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {stats.ranked.length > 0 && (
              <div>
                <div className={`text-[10px] uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50'}`}>Most Connected</div>
                <div className="space-y-1">
                  {stats.ranked.map(([id, degree]) => {
                    const target = notesById.get(id);
                    if (!target) return null;
                    return (
                      <button key={id} onClick={() => onNavigateToNoteById(id)}
                        className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/70 hover:text-[#CC7D5E]'}`}>
                        <div className="shrink-0 bg-[#CC7D5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                        <span className="truncate">{target.title}</span>
                        <span className={`ml-auto text-[10px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/40'}`}>{degree}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className={`flex h-8 w-full items-center gap-1.5 pl-3 pr-1.5 text-[11px] ${muted}`}>
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
  colorMode: GraphColorMode;
  onColorModeChange: (v: GraphColorMode) => void;
  sizeByDegree: boolean;
  onSizeByDegreeChange: (v: boolean) => void;
  showUnresolved: boolean;
  onShowUnresolvedChange: (v: boolean) => void;
  allTags: string[];
  tagColors: Map<string, string>;
  tagFilter: string[];
  onTagFilterChange: (v: string[]) => void;
}

function GraphFilterPanel({
  isDark,
  localDepth,
  onLocalDepthChange,
  hasActiveNote,
  colorMode,
  onColorModeChange,
  sizeByDegree,
  onSizeByDegreeChange,
  showUnresolved,
  onShowUnresolvedChange,
  allTags,
  tagColors,
  tagFilter,
  onTagFilterChange,
}: GraphFilterPanelProps) {
  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  const labelCls = `text-[11px] w-12 shrink-0 ${muted}`;
  const toggleTag = (t: string) => {
    onTagFilterChange(tagFilter.includes(t) ? tagFilter.filter((x) => x !== t) : [...tagFilter, t]);
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
        {/* One raised thumb that slides between the two halves, instead of
            each button swapping its own background: the choice visibly moves
            rather than blinking from one side to the other. Each half is
            (track − 4px padding − 2px gap) / 2 wide, so the far position is
            the thumb's own width plus the gap. */}
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
              className={`relative flex-1 h-5 rounded text-[11px] transition-colors duration-200 cursor-pointer ${
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
  return (
    <div className="mx-3 mb-2 space-y-2 border-b border-[var(--divider-subtle)] pb-3 pt-1 shrink-0">
      {/* Local depth */}
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
        <span className={`text-[11px] tabular-nums w-10 text-right ${muted}`}>{hasActiveNote ? depthLabel : '—'}</span>
      </div>

      {segment('Color', colorMode, [['tag', 'By tag'], ['none', 'Off']], onColorModeChange)}
      {segment('Size', sizeByDegree, [[true, 'By degree'], [false, 'Uniform']], onSizeByDegreeChange)}
      {/* Unresolved link targets (ghost nodes) */}
      {segment('Ghosts', showUnresolved, [[true, 'Shown'], [false, 'Hidden']], onShowUnresolvedChange, "Show links to notes that don't exist yet")}

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="space-y-1.5 pt-0.5">
          <div className="flex items-center justify-between">
            <span className={`text-[11px] ${muted}`}>Tags</span>
            {tagFilter.length > 0 && (
              <button
                onClick={() => onTagFilterChange([])}
                className={`text-[11px] cursor-pointer ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/55 hover:text-[#CC7D5E]'}`}
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto [scrollbar-gutter:stable]">
            {allTags.map((t) => {
              const active = tagFilter.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 text-[11px] px-2 h-5 rounded-full transition-colors cursor-pointer ${
                    active
                      ? ''
                      : isDark
                        ? 'bg-[rgba(249,249,247,0.06)] text-[rgba(249,249,247,0.65)] hover:bg-[rgba(249,249,247,0.1)]'
                        : 'bg-[rgba(45,45,43,0.05)] text-[#2D2D2B]/70 hover:bg-[rgba(45,45,43,0.09)]'
                  }`}
                  // Selected is an accent tint, not a solid fill: the dot is the
                  // graph's colour legend and has to stay readable on it.
                  style={active
                    ? { background: 'color-mix(in srgb, var(--accent-color, #CC7D5E) 18%, transparent)', color: isDark ? '#F9F9F7' : '#2D2D2B', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #CC7D5E) 55%, transparent)' }
                    : undefined}
                >
                  {/* Same palette, same order as the node fill in GraphView. */}
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tagColors.get(t) }} />
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
