import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TITLEBAR_PANEL_TABS_SLOT_ID, type RightTab } from '../constants/rightTabs';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useIsDark } from '../hooks/useIsDark';
import { computeOutgoingLinks } from '../hooks/useOutgoingLinks';
import { buildGraphModel, pruneGraphTagFilter } from '../lib/graphModel';
import { computeTopologySignature, getBacklinks } from '../lib/noteUtils';
import { GlobalTask, Note, Folder, AppSettings } from '../types';
import GraphView, { type GraphColorMode } from './GraphView';
import { BacklinksPanel } from './rightPanel/BacklinksPanel';
import { OutgoingLinksPanel } from './rightPanel/OutgoingLinksPanel';
import { PropertiesPanel } from './rightPanel/PropertiesPanel';
import { TasksPanel } from './rightPanel/TasksPanel';
import { CheckSquare, Network, Search, BarChart, Circle, SlidersHorizontal, Filter } from '@/src/lib/icons';
export type RightPanelTab = RightTab;

// Shared chrome for the two knowledge-matrix panels. They stack directly on top
// of each other, so any drift in height, padding, icon weight or label styling
// reads as a misalignment — keep both headers going through here.
function MatrixPanelHeader({
  icon: Icon,
  label,
  isDark,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  isDark?: boolean;
  children?: React.ReactNode;
}) {
  return (
    // Neither a fill nor a rule: both draw an edge across the card. The header
    // separates by whitespace alone — it shares the panel's surface and sits in
    // a band taller than its 10px label needs, so the air around the label does
    // the work a bar or a border used to.
    <div className="h-9 flex items-center px-2.5 gap-1.5 shrink-0">
      {/* Full accent, not a softened one. The label beside it was pushed UP to a
          contrast floor (see below); dimming the icon in the same header would
          have moved the two in opposite directions. At 80%/70% this mark lands
          at 2.4:1 / 2.9:1 — under the 3:1 that WCAG 1.4.11 asks of a meaningful
          graphic. It is decorative here, so that is not a violation, but full
          strength costs nothing and keeps the header internally consistent. */}
      <Icon size={12} className="shrink-0 text-[#CC7D5E]" />
      {/* 70% is the floor here, not a style choice: at 10px this label clears
          4.5:1 on the light surface only from ~67% up (45% lands at 2.6:1). */}
      <span className={`text-[10px] font-bold uppercase tracking-[0.14em] font-redaction mr-auto whitespace-nowrap shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.75)]' : 'text-[#2D2D2B]/70'}`}>{label}</span>
      {children}
    </div>
  );
}

// Backlinks: single link with a bold arrow pointing IN (incoming links)
function BacklinksIcon({ size = 14, strokeWidth = 2, className = '' }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 8.5l1-1a4 4 0 0 1 5.66 5.66l-2.83 2.83a4 4 0 0 1-5.66 0" />
      <path d="M12 16l-8-8" />
      <path d="M4 13v-5h5" />
    </svg>
  );
}

// Outgoing: single link with a bold arrow pointing OUT (outgoing links)
function OutgoingIcon({ size = 14, strokeWidth = 2, className = '' }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 15.5l-1 1a4 4 0 0 1-5.66-5.66l2.83-2.83a4 4 0 0 1 5.66 0" />
      <path d="M12 8l8 8" />
      <path d="M20 11v5h-5" />
    </svg>
  );
}

interface RightPanelProps {
  tasks: GlobalTask[];
  onToggleTask: (task: GlobalTask) => void;
  onNavigateToNoteById: (id: string) => void;
  activeNote?: Note;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  notes: Note[];
  folders?: Folder[];
  settings: AppSettings;
  activeNoteId?: string;
  onUpdateNote?: (content: string) => void;
  /** Desktop with the titlebar visible: render the tab strip up in the titlebar. */
  tabsInTitlebar?: boolean;
}

export default function RightPanel({
  tasks, onToggleTask, onNavigateToNoteById, activeNote,
  activeTab, onTabChange, notes, folders, settings, activeNoteId, onUpdateNote,
  tabsInTitlebar = false,
}: RightPanelProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [graphSearch, setGraphSearch] = useState('');
  const deferredGraphSearch = useDeferredValue(graphSearch);
  const [showFilters, setShowFilters] = useState(false);
  const [localDepth, setLocalDepth] = useState(0);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [colorMode, setColorMode] = useState<GraphColorMode>('tag');
  const [sizeByDegree, setSizeByDegree] = useState(true);

  // Topology-stable snapshot of notes/folders. The notes array gets a new
  // identity on every keystroke (debounce only guards storage writes, not
  // state), but the tab badges, tag chips and graph only depend on structural
  // data (titles/links/linkRefs/tags/folders). Key their inputs on the
  // topology signature so content-only edits skip every downstream recompute
  // — including GraphView/GraphInfoPanel's own signature guards, which now
  // see a stable array identity and bail before hashing.
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
  useLayoutEffect(() => {
    setTagFilter((selected) => pruneGraphTagFilter(selected, allTags));
  }, [allTags]);
  const [showGraphGuide, setShowGraphGuide] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN); } catch { return true; }
  });
  // Once the graph tab is opened, keep it mounted across tab switches so the
  // force simulation and viewport survive — otherwise switching back replays the
  // "explode and zoom-to-fit" animation every time.
  const [hasVisitedGraph, setHasVisitedGraph] = useState(activeTab === 'graph');
  useEffect(() => {
    if (activeTab === 'graph') setHasVisitedGraph(true);
  }, [activeTab]);

  // The slot lives in TopBar, which unmounts in focus mode — re-resolve on every
  // toggle rather than caching the node once. Layout effect so the portal is in
  // place before first paint; a passive effect would let the in-panel fallback
  // strip render for a frame on cold start.
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTitlebarSlot(tabsInTitlebar ? document.getElementById(TITLEBAR_PANEL_TABS_SLOT_ID) : null);
  }, [tabsInTitlebar]);

  const activeTasks = useMemo(() => tasks.filter(t => !t.completed), [tasks]);
  // Badge counts only read structural fields (linkRefs/links/titles), so
  // resolve the active note inside the topology snapshot — keying on the
  // fresh activeNote object would recompute per keystroke.
  const backlinksCount = useMemo(() => {
    const active = activeNoteId ? topologyNotes.find((n) => n.id === activeNoteId) : undefined;
    return getBacklinks(active, topologyNotes).length;
  }, [topologyNotes, activeNoteId]);
  const outgoingCount = useMemo(() => {
    const active = activeNoteId ? topologyNotes.find((n) => n.id === activeNoteId) : undefined;
    return computeOutgoingLinks(active, topologyNotes, topologyFolders ?? []).resolved.length;
  }, [topologyNotes, topologyFolders, activeNoteId]);

  const tabs = ([
    { id: 'backlinks', label: 'Backlinks', icon: BacklinksIcon, badge: backlinksCount > 0 ? backlinksCount : null },
    { id: 'outgoing', label: 'Outgoing', icon: OutgoingIcon, badge: outgoingCount > 0 ? outgoingCount : null },
    { id: 'graph' as const, label: 'Graph', icon: Network, badge: null },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare, badge: activeTasks.length > 0 ? activeTasks.length : null },
    { id: 'properties', label: 'Properties', icon: SlidersHorizontal, badge: null },
  ] as const);

  const renderTab = (tab: typeof tabs[number], variant: 'titlebar' | 'segmented') => {
    const isActive = activeTab === tab.id;
    const inTitlebar = variant === 'titlebar';
    // Titlebar tabs sit on the bare bar, so the active state is a soft filled
    // chip. The in-panel segmented control instead raises the active tab out of
    // an inset track, which needs a shadow to read.
    const style: React.CSSProperties = isActive
      ? {
          background: inTitlebar
            ? (isDark ? 'rgba(249,249,247,0.10)' : 'rgba(45,45,43,0.07)')
            : (isDark ? '#3A3A37' : '#FBFAF6'),
          color: isDark ? '#F9F9F7' : '#2D2D2B',
          boxShadow: inTitlebar
            ? undefined
            : isDark
              ? '0 1px 2px rgba(0,0,0,0.28), 0 0 0 1px rgba(249,249,247,0.06)'
              : '0 1px 2px rgba(45,45,43,0.1), 0 0 0 1px rgba(45,45,43,0.04)',
        }
      : { color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.55)' };
    return (
      <button
        key={tab.id}
        onClick={() => onTabChange(tab.id)}
        title={tab.id === 'outgoing' ? 'Outgoing Links' : tab.label}
        aria-label={tab.label}
        aria-pressed={isActive}
        className={`relative flex items-center justify-center transition-colors active:opacity-70 ${
          inTitlebar ? 'h-[26px] w-9 shrink-0 cursor-pointer rounded' : 'flex-1 h-6 rounded-md'
        } ${
          isActive
            ? ''
            : isDark ? 'hover:text-[#F9F9F7] hover:bg-[#F9F9F7]/[0.05]' : 'hover:text-[#2D2D2B] hover:bg-[#2D2D2B]/[0.05]'
        }`}
        style={style}
      >
        <tab.icon size={inTitlebar ? 17 : 15} className="shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
        {tab.badge !== null && (
          <span
            aria-label={`${tab.badge} pending`}
            className={`absolute text-[10px] font-bold leading-none tabular-nums text-[#CC7D5E] ${inTitlebar ? 'top-0.5 right-0.5' : 'top-0 right-1'}`}
          >
            {tab.badge > 9 ? '9+' : tab.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={`w-full h-full min-h-0 flex flex-col shrink-0 relative ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}>
      {tabsInTitlebar && titlebarSlot
        ? (
          <>
            {createPortal(
              <div className="flex items-center gap-0.5">
                {tabs.map((tab) => renderTab(tab, 'titlebar'))}
              </div>,
              titlebarSlot,
            )}
            {/* The tab row used to supply the gap under the titlebar divider.
                With the tabs moved up, match the panel's own px-2 gutter so
                content is inset the same on all four sides. */}
            <div aria-hidden="true" className="h-2 shrink-0" />
          </>
        )
        : (
          /* Fallback (mobile / titlebar hidden) — segmented control inside the panel */
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
              {tabs.map((tab) => renderTab(tab, 'segmented'))}
            </div>
          </div>
        )}

      {/* Tab content — key={activeTab} forces remount on every tab switch, triggering fade-in */}
      {activeTab === 'tasks' && (
        <div key="tasks" className="tab-fade-in flex flex-col flex-1 min-h-0">
          <TasksPanel tasks={tasks} onToggleTask={onToggleTask} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
        </div>
      )}
      {activeTab === 'backlinks' && (
        <div key="backlinks" className="tab-fade-in flex flex-col flex-1 min-h-0">
          <BacklinksPanel activeNote={activeNote} notes={notes} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
        </div>
      )}
      {activeTab === 'outgoing' && (
        <div key="outgoing" className="tab-fade-in flex flex-col flex-1 min-h-0">
          <OutgoingLinksPanel activeNote={activeNote} notes={notes} folders={folders} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
        </div>
      )}
      {activeTab === 'properties' && (
        <div key="properties" className="tab-fade-in flex flex-col flex-1 min-h-0">
          <PropertiesPanel activeNote={activeNote} onUpdateNote={onUpdateNote} isDark={isDark} />
        </div>
      )}
      {(hasVisitedGraph || activeTab === 'graph') && (
        <div
          className="flex-1 flex-col overflow-hidden px-2 pb-2 pt-0 gap-2"
          style={{ display: activeTab === 'graph' ? 'flex' : 'none' }}
        >
          {showGraphGuide && (
            <div className={`border border-[var(--divider-subtle)] px-3 py-2 text-xs leading-relaxed ${isDark ? 'bg-[#252523] text-[rgba(249,249,247,0.65)]' : 'bg-[#EFEAE3] text-[#2D2D2B]/80'}`}>
              <div className={`font-bold uppercase tracking-wider text-[10px] mb-1 ${isDark ? 'text-[rgba(249,249,247,0.75)]' : 'text-[#2D2D2B]/60'}`}>Graph Guide</div>
              <div>Node size reflects connectivity. Use "filter..." to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
              <button
                onClick={() => {
                  setShowGraphGuide(false);
                  try { localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1'); } catch { /* quota exceeded */ }
                }}
                className={`mt-2 text-[10px] uppercase tracking-wider font-bold border px-2 py-0.5 ${isDark ? 'border-[rgba(249,249,247,0.25)] hover:border-[rgba(249,249,247,0.6)] text-[rgba(249,249,247,0.5)]' : 'border-[#2D2D2B]/40 hover:border-[#2D2D2B]'}`}
              >
                Got It
              </button>
            </div>
          )}
          <div className={`noa-elevated-panel flex flex-col border rounded-md overflow-hidden ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`} style={{ height: '55%', minHeight: 180, borderColor: 'var(--divider-subtle, #E6E2DA)' }}>
            <MatrixPanelHeader icon={Network} label="Knowledge Matrix" isDark={isDark}>
              <div className="noa-graph-control-surface flex items-center h-5 gap-0.5 rounded-[3px] p-0.5"
                role="group"
                aria-label="Graph filter controls">
                <div className="flex items-center gap-1 pl-1 pr-0.5">
                  <Search size={10} style={{ color: isDark ? 'rgba(249,249,247,0.6)' : 'rgba(45,45,43,0.6)' }} className="shrink-0" />
                  <input type="text" value={graphSearch} onChange={e => setGraphSearch(e.target.value)}
                    aria-label="Filter graph nodes"
                    placeholder="filter..." className="bg-transparent outline-none text-[10px] font-redaction w-11 min-w-0"
                    style={{ color: isDark ? '#F9F9F7' : '#2D2D2B' }} />
                </div>
                {/* Name stays fixed and aria-pressed carries the state. Letting the
                    name flip too (as `title` does) would have a screen reader
                    announce "Show all nodes, pressed" — the label and the state
                    then contradict each other. `title` still flips: as a tooltip
                    it should say what the click will do. */}
                <button onClick={() => setHideIsolated(v => !v)} title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                  aria-label="Hide isolated nodes"
                  aria-pressed={hideIsolated}
                  className="noa-graph-control-button flex items-center justify-center w-4 h-4 rounded-[2px] active:opacity-70 transition-colors shrink-0"
                  style={{ color: hideIsolated ? '#CC7D5E' : (isDark ? 'rgba(249,249,247,0.6)' : 'rgba(45,45,43,0.6)') }}>
                  <Network size={10} />
                </button>
                <button onClick={() => setShowFilters(v => !v)} title={showFilters ? 'Hide filters' : 'Show filters'}
                  aria-label="Filters"
                  aria-pressed={showFilters}
                  className="noa-graph-control-button flex items-center justify-center w-4 h-4 rounded-[2px] active:opacity-70 transition-colors shrink-0"
                  style={{ color: showFilters ? '#CC7D5E' : (isDark ? 'rgba(249,249,247,0.6)' : 'rgba(45,45,43,0.6)') }}>
                  <Filter size={10} />
                </button>
              </div>
            </MatrixPanelHeader>
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
                tagFilter={tagFilter}
                onTagFilterChange={setTagFilter}
              />
            )}
            <div className="flex-1 overflow-hidden">
              <GraphView notes={topologyNotes} folders={topologyFolders} onNavigateToNoteById={onNavigateToNoteById} settings={settings}
                searchQuery={deferredGraphSearch} activeNoteId={activeNoteId}
                hideIsolated={hideIsolated} localDepth={localDepth} tagFilter={tagFilter}
                colorMode={colorMode} sizeByDegree={sizeByDegree} showUnresolved={showUnresolved} />
            </div>
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
      )}
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

  return (
    <div className={`noa-elevated-panel flex-1 flex flex-col border border-[var(--divider-subtle)] rounded-md overflow-hidden font-redaction min-h-0 ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}>
      <MatrixPanelHeader icon={BarChart} label="Matrix Stats" isDark={isDark} />
      {/* No scrollbar-gutter here, unlike the other scrollers: the gutter is
          carved out of the content box, so it survives any padding and offsets
          the body relative to the header above (which sits outside this
          scroller and cannot reserve a matching one). Dropping it lets p-2
          set both insets to 8px and line the cards up with the header's px-2.
          macOS overlay scrollbars float over that padding; on classic
          scrollbars they overlap the 8px inset rather than shifting content. */}
      <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-2 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {[{ label: 'Notes', value: stats.totalNotes }, { label: 'Links', value: stats.totalLinks }, { label: 'Isolated', value: stats.isolated }].map(({ label, value }) => (
            <div key={label} className="border border-[var(--divider-subtle)] rounded-[3px] p-2 text-center">
              <div className={`text-sm font-bold leading-none tabular-nums ${isDark ? 'text-[#F9F9F7]' : 'text-[#2D2D2B]'}`}>{value}</div>
              <div className={`text-[10px] uppercase tracking-wider mt-1 ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50'}`}>{label}</div>
            </div>
          ))}
        </div>
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
                  return (
                    <button key={id} onClick={() => onNavigateToNoteById(id)}
                      className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/70 hover:text-[#CC7D5E]'}`}>
                      <Circle size={5} className="shrink-0 fill-[#CC7D5E] text-[#CC7D5E]" />
                      <span className="truncate">{target.title}</span>
                      <span className={`ml-auto text-[10px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/30'}`}>{stats.degreeMap.get(id) ?? 0}</span>
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
  tagFilter,
  onTagFilterChange,
}: GraphFilterPanelProps) {
  const labelCls = `text-[10px] uppercase tracking-wider font-bold ${isDark ? 'text-[rgba(249,249,247,0.55)]' : 'text-[#2D2D2B]/55'}`;
  const valueCls = `text-[10px] tabular-nums ${isDark ? 'text-[rgba(249,249,247,0.75)]' : 'text-[#2D2D2B]/80'}`;
  const borderCol = 'var(--divider-subtle, #E6E2DA)';
  const toggleTag = (t: string) => {
    onTagFilterChange(tagFilter.includes(t) ? tagFilter.filter((x) => x !== t) : [...tagFilter, t]);
  };
  const depthLabel = localDepth === 0 ? 'all' : `${localDepth} hop${localDepth > 1 ? 's' : ''}`;
  return (
    <div
      className="px-2.5 py-2 border-b space-y-2 shrink-0"
      style={{ borderColor: borderCol, background: isDark ? '#252523' : '#E2E0D6' }}
    >
      {/* Local depth */}
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-12 shrink-0`}>Depth</span>
        <input
          type="range"
          min={0}
          max={3}
          step={1}
          value={localDepth}
          onChange={(e) => onLocalDepthChange(Number(e.target.value))}
          disabled={!hasActiveNote}
          className="flex-1 h-1 accent-[#CC7D5E] disabled:opacity-40"
        />
        <span className={`${valueCls} w-10 text-right`}>{hasActiveNote ? depthLabel : '—'}</span>
      </div>

      {/* Color mode */}
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-12 shrink-0`}>Color</span>
        <div className="flex gap-px flex-1">
          {(['tag', 'none'] as const).map((m) => {
            const active = colorMode === m;
            return (
              <button
                key={m}
                onClick={() => onColorModeChange(m)}
                className="flex-1 h-5 text-[10px] uppercase tracking-wider font-bold transition-colors active:opacity-70"
                style={active
                  ? { background: isDark ? '#F9F9F7' : '#2D2D2B', color: isDark ? '#2D2D2B' : '#F9F9F7', border: `1px solid ${isDark ? '#F9F9F7' : '#2D2D2B'}` }
                  : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.6)' }
                }
              >
                {m === 'tag' ? 'Tag' : 'Off'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Size by degree */}
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-12 shrink-0`}>Size</span>
        <button
          onClick={() => onSizeByDegreeChange(!sizeByDegree)}
          className="flex-1 h-5 text-[10px] uppercase tracking-wider font-bold transition-colors active:opacity-70"
          style={sizeByDegree
            ? { background: isDark ? '#F9F9F7' : '#2D2D2B', color: isDark ? '#2D2D2B' : '#F9F9F7', border: `1px solid ${isDark ? '#F9F9F7' : '#2D2D2B'}` }
            : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.6)' }
          }
        >
          {sizeByDegree ? 'By Degree' : 'Uniform'}
        </button>
      </div>

      {/* Unresolved link targets (ghost nodes) */}
      <div className="flex items-center gap-2">
        <span className={`${labelCls} w-12 shrink-0`}>Ghosts</span>
        <button
          onClick={() => onShowUnresolvedChange(!showUnresolved)}
          title="Show links to notes that don't exist yet"
          className="flex-1 h-5 text-[10px] uppercase tracking-wider font-bold transition-colors active:opacity-70"
          style={showUnresolved
            ? { background: isDark ? '#F9F9F7' : '#2D2D2B', color: isDark ? '#2D2D2B' : '#F9F9F7', border: `1px solid ${isDark ? '#F9F9F7' : '#2D2D2B'}` }
            : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.6)' }
          }
        >
          {showUnresolved ? 'Shown' : 'Hidden'}
        </button>
      </div>

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className={labelCls}>Tags</span>
            {tagFilter.length > 0 && (
              <button
                onClick={() => onTagFilterChange([])}
                className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-[rgba(249,249,247,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2B]/55 hover:text-[#CC7D5E]'}`}
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
                  className="text-[10px] px-1.5 h-4 uppercase tracking-wider font-bold transition-colors active:opacity-70"
                  style={active
                    ? { background: '#CC7D5E', color: isDark ? '#252523' : '#FFFFFF', border: '1px solid #CC7D5E' }
                    : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.65)' }
                  }
                >
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
