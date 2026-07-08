import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Network, Search, GitBranch, Circle, SlidersHorizontal, Filter } from '@/src/lib/icons';
import { GlobalTask, Note, Folder, AppSettings } from '../types';
import GraphView, { type GraphColorMode } from './GraphView';
import { buildGraphModel } from '../lib/graphModel';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useIsDark } from '../hooks/useIsDark';
import { useOutgoingLinks } from '../hooks/useOutgoingLinks';
import { computeTopologySignature, getBacklinks } from '../lib/noteUtils';
import { TasksPanel } from './rightPanel/TasksPanel';
import { BacklinksPanel } from './rightPanel/BacklinksPanel';
import { OutgoingLinksPanel } from './rightPanel/OutgoingLinksPanel';
import { PropertiesPanel } from './rightPanel/PropertiesPanel';

import type { RightTab } from '../constants/rightTabs';
export type RightPanelTab = RightTab;

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
}

export default function RightPanel({
  tasks, onToggleTask, onNavigateToNoteById, activeNote,
  activeTab, onTabChange, notes, folders, settings, activeNoteId, onUpdateNote,
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

  // All tags across notes (ordered by first appearance for stable chip order).
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of notes) {
      for (const t of n.tags ?? []) {
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
    return out;
  }, [notes]);
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

  const activeTasks = useMemo(() => tasks.filter(t => !t.completed), [tasks]);
  const backlinksCount = useMemo(() => getBacklinks(activeNote, notes).length, [activeNote, notes]);
  const { resolved: outgoingResolved } = useOutgoingLinks(activeNote, notes, folders);
  const outgoingCount = outgoingResolved.length;

  return (
    <div className={`w-full h-full flex flex-col shrink-0 relative ${isDark ? 'bg-[#262624]' : 'bg-[#EAE8E0]'}`}>
      {/* Tab bar — full-width segmented control */}
      <div
        className="h-8 flex items-stretch shrink-0 overflow-hidden border-b"
        style={{
          background: isDark ? '#1E1E1C' : '#DCD9CE',
          borderColor: isDark ? 'rgba(238,237,234,0.18)' : '#2D2D2D',
        }}
      >
        {([
          { id: 'tasks', label: 'Tasks', icon: CheckSquare, badge: activeTasks.length > 0 ? activeTasks.length : null },
          { id: 'backlinks', label: 'Backlinks', icon: BacklinksIcon, badge: backlinksCount > 0 ? backlinksCount : null },
          { id: 'outgoing', label: 'Outgoing', icon: OutgoingIcon, badge: outgoingCount > 0 ? outgoingCount : null },
          { id: 'graph', label: 'Graph', icon: Network, badge: null },
          { id: 'properties', label: 'Properties', icon: SlidersHorizontal, badge: null },
        ] as const).map((tab, idx) => {
          const isActive = activeTab === tab.id;
          const baseStyle: React.CSSProperties = {
            borderLeft: idx > 0
              ? `1px solid ${isDark ? 'rgba(238,237,234,0.08)' : 'rgba(45,45,45,0.15)'}`
              : undefined,
          };
          const activeStyle: React.CSSProperties = isActive
            ? {
                background: isDark ? '#262624' : '#EAE8E0',
                color: isDark ? '#EEEDEA' : '#2D2D2D',
              }
            : {
                color: isDark ? 'rgba(238,237,234,0.55)' : 'rgba(45,45,45,0.55)',
              };
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              title={tab.id === 'outgoing' ? 'Outgoing Links' : tab.label}
              aria-label={tab.label}
              aria-pressed={isActive}
              className={`relative flex-1 flex items-center justify-center transition-colors active:opacity-70 ${
                isActive
                  ? ''
                  : isDark ? 'hover:text-[#EEEDEA] hover:bg-[#EEEDEA]/[0.04]' : 'hover:text-[#2D2D2D] hover:bg-[#EAE8E0]/50'
              }`}
              style={{ ...baseStyle, ...activeStyle }}
            >
              <tab.icon size={15} className="shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
              {tab.badge !== null && (
                <span
                  aria-label={`${tab.badge} pending`}
                  className="absolute top-1 right-1.5 text-[10px] font-bold leading-none tabular-nums text-[#CC7D5E]"
                >
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

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
          className="flex-1 flex-col overflow-hidden p-3 gap-3"
          style={{ display: activeTab === 'graph' ? 'flex' : 'none' }}
        >
          {showGraphGuide && (
            <div className={`border px-3 py-2 text-xs leading-relaxed ${isDark ? 'border-[rgba(238,237,234,0.15)] bg-[#1E1E1C] text-[rgba(238,237,234,0.65)]' : 'border-[#2D2D2D]/30 bg-[#DCD9CE] text-[#2D2D2D]/80'}`}>
              <div className={`font-bold uppercase tracking-wider text-[10px] mb-1 ${isDark ? 'text-[rgba(238,237,234,0.75)]' : 'text-[#2D2D2D]/60'}`}>Graph Guide</div>
              <div>Node size reflects connectivity. Use "filter..." to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
              <button
                onClick={() => {
                  setShowGraphGuide(false);
                  try { localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1'); } catch { /* quota exceeded */ }
                }}
                className={`mt-2 text-[10px] uppercase tracking-wider font-bold border px-2 py-0.5 ${isDark ? 'border-[rgba(238,237,234,0.25)] hover:border-[rgba(238,237,234,0.6)] text-[rgba(238,237,234,0.5)]' : 'border-[#2D2D2D]/40 hover:border-[#2D2D2D]'}`}
              >
                Got It
              </button>
            </div>
          )}
          <div className="flex flex-col border" style={{ height: '55%', minHeight: 180, borderColor: isDark ? 'rgba(238,237,234,0.15)' : 'rgba(45,45,45,0.9)' }}>
            <div className={`h-7 border-b flex items-center px-2 gap-1.5 shrink-0 ${isDark ? 'bg-[#222220] border-[rgba(238,237,234,0.1)]' : 'bg-[#DCD9CE] border-[#2D2D2D]/50'}`}>
              <Network size={11} className="text-[#CC7D5E] shrink-0" />
              <span className={`text-[10px] font-bold uppercase tracking-wider font-redaction mr-auto whitespace-nowrap shrink-0 ${isDark ? 'text-[rgba(238,237,234,0.75)]' : 'text-[#2D2D2D]/70'}`}>Knowledge Matrix</span>
              <div className={`flex items-center gap-1 h-5 px-1.5 rounded-md border focus-within:border-[#CC7D5E] transition-colors ${isDark ? 'border-[rgba(238,237,234,0.15)]' : 'border-[rgba(45,45,45,0.2)]'}`}
                style={{ background: isDark ? 'rgba(238,237,234,0.05)' : 'rgba(45,45,45,0.05)' }}>
                <Search size={9} style={{ color: isDark ? 'rgba(238,237,234,0.4)' : 'rgba(45,45,45,0.5)' }} className="shrink-0" />
                <input type="text" value={graphSearch} onChange={e => setGraphSearch(e.target.value)}
                  placeholder="filter..." className="bg-transparent outline-none text-[10px] font-redaction w-12 min-w-0"
                  style={{ color: isDark ? '#EEEDEA' : '#2D2D2D' }} />
              </div>
              <button onClick={() => setHideIsolated(v => !v)} title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                className="flex items-center justify-center w-5 h-5 rounded-md active:opacity-70 transition-colors shrink-0"
                style={hideIsolated
                  ? { background: '#CC7D5E', color: '#FFFFFF', border: '1px solid #CC7D5E' }
                  : { border: `1px solid ${isDark ? 'rgba(238,237,234,0.15)' : 'rgba(45,45,45,0.2)'}`, background: isDark ? 'rgba(238,237,234,0.05)' : 'rgba(45,45,45,0.05)', color: isDark ? 'rgba(238,237,234,0.4)' : 'rgba(45,45,45,0.5)' }
                }>
                <Network size={10} />
              </button>
              <button onClick={() => setShowFilters(v => !v)} title={showFilters ? 'Hide filters' : 'Show filters'}
                className="flex items-center justify-center w-5 h-5 rounded-md active:opacity-70 transition-colors shrink-0"
                style={showFilters
                  ? { background: '#CC7D5E', color: '#FFFFFF', border: '1px solid #CC7D5E' }
                  : { border: `1px solid ${isDark ? 'rgba(238,237,234,0.15)' : 'rgba(45,45,45,0.2)'}`, background: isDark ? 'rgba(238,237,234,0.05)' : 'rgba(45,45,45,0.05)', color: isDark ? 'rgba(238,237,234,0.4)' : 'rgba(45,45,45,0.5)' }
                }>
                <Filter size={10} />
              </button>
            </div>
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
              <GraphView notes={notes} folders={folders} onNavigateToNoteById={onNavigateToNoteById} settings={settings}
                searchQuery={deferredGraphSearch} activeNoteId={activeNoteId}
                hideIsolated={hideIsolated} localDepth={localDepth} tagFilter={tagFilter}
                colorMode={colorMode} sizeByDegree={sizeByDegree} showUnresolved={showUnresolved} />
            </div>
          </div>
          <GraphInfoPanel
            notes={notes}
            folders={folders}
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
    <div className={`flex-1 overflow-y-auto border font-redaction min-h-0 ${isDark ? 'border-[rgba(238,237,234,0.15)] bg-[#262624]' : 'border-[#2D2D2D]/90 bg-[#EAE8E0]'}`}>
      <div className={`h-7 border-b flex items-center px-2 gap-1.5 shrink-0 ${isDark ? 'bg-[#222220] border-[rgba(238,237,234,0.1)]' : 'bg-[#DCD9CE] border-[#2D2D2D]/50'}`}>
        <GitBranch size={11} className="text-[#CC7D5E] shrink-0" />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[rgba(238,237,234,0.75)]' : 'text-[#2D2D2D]/70'}`}>Knowledge Matrix Stats</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[{ label: 'Notes', value: stats.totalNotes }, { label: 'Links', value: stats.totalLinks }, { label: 'Isolated', value: stats.isolated }].map(({ label, value }) => (
            <div key={label} className={`border p-2 text-center ${isDark ? 'border-[rgba(238,237,234,0.15)]' : 'border-[#2D2D2D]'}`}>
              <div className={`text-sm font-bold leading-none tabular-nums ${isDark ? 'text-[#EEEDEA]' : 'text-[#2D2D2D]'}`}>{value}</div>
              <div className={`text-[10px] uppercase tracking-wider mt-1 ${isDark ? 'text-[rgba(238,237,234,0.5)]' : 'text-[#2D2D2D]/50'}`}>{label}</div>
            </div>
          ))}
        </div>
        {activeNoteId && (
          <div>
            <div className={`text-[10px] uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(238,237,234,0.5)]' : 'text-[#2D2D2D]/50'}`}>
              Active · {notesById.get(activeNoteId)?.title ?? 'Unknown'}
            </div>
            {activeConnections.length === 0 ? (
              <div className={`text-[10px] italic ${isDark ? 'text-[rgba(238,237,234,0.55)]' : 'text-[#2D2D2D]/40'}`}>No connections</div>
            ) : (
              <div className="space-y-1">
                {activeConnections.slice(0, 6).map(id => {
                  const target = notesById.get(id);
                  if (!target) return null;
                  return (
                    <button key={id} onClick={() => onNavigateToNoteById(id)}
                      className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(238,237,234,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2D]/70 hover:text-[#CC7D5E]'}`}>
                      <Circle size={5} className="shrink-0 fill-[#CC7D5E] text-[#CC7D5E]" />
                      <span className="truncate">{target.title}</span>
                      <span className={`ml-auto text-[10px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(238,237,234,0.5)]' : 'text-[#2D2D2D]/30'}`}>{stats.degreeMap.get(id) ?? 0}</span>
                    </button>
                  );
                })}
                {activeConnections.length > 6 && (
                  <div className={`text-[10px] pl-3 ${isDark ? 'text-[rgba(238,237,234,0.55)]' : 'text-[#2D2D2D]/40'}`}>+{activeConnections.length - 6} more</div>
                )}
              </div>
            )}
          </div>
        )}
        {stats.ranked.length > 0 && (
          <div>
            <div className={`text-[10px] uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(238,237,234,0.5)]' : 'text-[#2D2D2D]/50'}`}>Most Connected</div>
            <div className="space-y-1">
              {stats.ranked.map(([id, degree]) => {
                const target = notesById.get(id);
                if (!target) return null;
                return (
                  <button key={id} onClick={() => onNavigateToNoteById(id)}
                    className={`flex items-center gap-1.5 w-full text-left text-xs transition-colors ${isDark ? 'text-[rgba(238,237,234,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2D]/70 hover:text-[#CC7D5E]'}`}>
                    <div className="shrink-0 bg-[#CC7D5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                    <span className="truncate">{target.title}</span>
                    <span className={`ml-auto text-[10px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(238,237,234,0.5)]' : 'text-[#2D2D2D]/40'}`}>{degree}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
  const labelCls = `text-[10px] uppercase tracking-wider font-bold ${isDark ? 'text-[rgba(238,237,234,0.55)]' : 'text-[#2D2D2D]/55'}`;
  const valueCls = `text-[10px] tabular-nums ${isDark ? 'text-[rgba(238,237,234,0.75)]' : 'text-[#2D2D2D]/80'}`;
  const borderCol = isDark ? 'rgba(238,237,234,0.12)' : 'rgba(45,45,45,0.45)';
  const toggleTag = (t: string) => {
    onTagFilterChange(tagFilter.includes(t) ? tagFilter.filter((x) => x !== t) : [...tagFilter, t]);
  };
  const depthLabel = localDepth === 0 ? 'all' : `${localDepth} hop${localDepth > 1 ? 's' : ''}`;
  return (
    <div
      className="px-2.5 py-2 border-b space-y-2 shrink-0"
      style={{ borderColor: borderCol, background: isDark ? '#1E1E1C' : '#E2E0D6' }}
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
                  ? { background: isDark ? '#EEEDEA' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#EEEDEA' : '#2D2D2D'}` }
                  : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(238,237,234,0.55)' : 'rgba(45,45,45,0.6)' }
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
            ? { background: isDark ? '#EEEDEA' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#EEEDEA' : '#2D2D2D'}` }
            : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(238,237,234,0.55)' : 'rgba(45,45,45,0.6)' }
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
            ? { background: isDark ? '#EEEDEA' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#EEEDEA' : '#2D2D2D'}` }
            : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(238,237,234,0.55)' : 'rgba(45,45,45,0.6)' }
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
                className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-[rgba(238,237,234,0.5)] hover:text-[#CC7D5E]' : 'text-[#2D2D2D]/55 hover:text-[#CC7D5E]'}`}
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {allTags.map((t) => {
              const active = tagFilter.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className="text-[10px] px-1.5 h-4 uppercase tracking-wider font-bold transition-colors active:opacity-70"
                  style={active
                    ? { background: '#CC7D5E', color: isDark ? '#1E1E1C' : '#FFFFFF', border: '1px solid #CC7D5E' }
                    : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(238,237,234,0.55)' : 'rgba(45,45,45,0.65)' }
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
