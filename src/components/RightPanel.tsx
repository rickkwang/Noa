import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Network, Search, GitBranch, Circle, SlidersHorizontal, Filter } from 'lucide-react';
import { GlobalTask, Note, AppSettings } from '../types';
import GraphView, { type GraphColorMode } from './GraphView';
import { buildTitleToIdsMap } from '../lib/noteUtils';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useIsDark } from '../hooks/useIsDark';
import { useOutgoingLinks } from '../hooks/useOutgoingLinks';
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
  settings: AppSettings;
  activeNoteId?: string;
  onUpdateNote?: (content: string) => void;
}

export default function RightPanel({
  tasks, onToggleTask, onNavigateToNoteById, activeNote,
  activeTab, onTabChange, notes, settings, activeNoteId, onUpdateNote,
}: RightPanelProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const [hideIsolated, setHideIsolated] = useState(false);
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
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 320, height: 400 });

  const activeTasks = useMemo(() => tasks.filter(t => !t.completed), [tasks]);
  const backlinksCount = useMemo(() => {
    if (!activeNote) return 0;
    return notes.filter(n =>
      n.id !== activeNote.id &&
      ((n.linkRefs ?? []).includes(activeNote.id) || (n.links ?? []).includes(activeNote.title))
    ).length;
  }, [activeNote, notes]);
  const { resolved: outgoingResolved } = useOutgoingLinks(activeNote, notes);
  const outgoingCount = outgoingResolved.length;

  useEffect(() => {
    if (activeTab !== 'graph' || !graphContainerRef.current) return;
    const syncGraphSize = () => {
      if (!graphContainerRef.current) return;
      const rect = graphContainerRef.current.getBoundingClientRect();
      setGraphDimensions({ width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) });
    };
    syncGraphSize();
    const observer = new ResizeObserver(syncGraphSize);
    observer.observe(graphContainerRef.current);
    window.addEventListener('resize', syncGraphSize);
    return () => { observer.disconnect(); window.removeEventListener('resize', syncGraphSize); };
  }, [activeTab]);

  return (
    <div className={`w-full h-full flex flex-col shrink-0 relative ${isDark ? 'bg-[#262624]' : 'bg-[#EAE8E0]'}`}>
      {/* Tab bar — full-width segmented control */}
      <div
        className="h-8 flex items-stretch shrink-0 overflow-hidden border-b"
        style={{
          background: isDark ? '#1E1E1C' : '#DCD9CE',
          borderColor: isDark ? 'rgba(240,237,230,0.18)' : '#2D2D2D',
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
              ? `1px solid ${isDark ? 'rgba(240,237,230,0.08)' : 'rgba(45,45,45,0.15)'}`
              : undefined,
          };
          const activeStyle: React.CSSProperties = isActive
            ? {
                background: isDark ? '#262624' : '#EAE8E0',
                color: isDark ? '#F0EDE6' : '#2D2D2D',
              }
            : {
                color: isDark ? 'rgba(240,237,230,0.55)' : 'rgba(45,45,45,0.55)',
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
                  : isDark ? 'hover:text-[#F0EDE6] hover:bg-[#F0EDE6]/[0.04]' : 'hover:text-[#2D2D2D] hover:bg-[#EAE8E0]/50'
              }`}
              style={{ ...baseStyle, ...activeStyle }}
            >
              <tab.icon size={15} className="shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
              {tab.badge !== null && (
                <span
                  aria-label={`${tab.badge} pending`}
                  className="absolute top-1 right-1.5 text-[8px] font-bold leading-none tabular-nums text-[#B89B5E]"
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
          <OutgoingLinksPanel activeNote={activeNote} notes={notes} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
        </div>
      )}
      {activeTab === 'properties' && (
        <div key="properties" className="tab-fade-in flex flex-col flex-1 min-h-0">
          <PropertiesPanel activeNote={activeNote} onUpdateNote={onUpdateNote} isDark={isDark} />
        </div>
      )}
      {activeTab === 'graph' && (
        <div key="graph" className="tab-fade-in flex-1 flex flex-col overflow-hidden p-3 gap-3">
          {showGraphGuide && (
            <div className={`border px-3 py-2 text-[11px] leading-relaxed ${isDark ? 'border-[rgba(240,237,230,0.15)] bg-[#242420] text-[rgba(240,237,230,0.65)]' : 'border-[#2D2D2D]/30 bg-[#DCD9CE] text-[#2D2D2D]/80'}`}>
              <div className={`font-bold uppercase tracking-wider text-[10px] mb-1 ${isDark ? 'text-[rgba(240,237,230,0.75)]' : 'text-[#2D2D2D]/60'}`}>Graph Guide</div>
              <div>Node size reflects connectivity. Use "filter..." to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
              <button
                onClick={() => {
                  setShowGraphGuide(false);
                  try { localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1'); } catch { /* quota exceeded */ }
                }}
                className={`mt-2 text-[10px] uppercase tracking-wider font-bold border px-2 py-0.5 ${isDark ? 'border-[rgba(240,237,230,0.25)] hover:border-[rgba(240,237,230,0.6)] text-[rgba(240,237,230,0.5)]' : 'border-[#2D2D2D]/40 hover:border-[#2D2D2D]'}`}
              >
                Got It
              </button>
            </div>
          )}
          <div className="flex flex-col border" style={{ height: '55%', minHeight: 180, borderColor: isDark ? 'rgba(240,237,230,0.15)' : 'rgba(45,45,45,0.56)' }}>
            <div className={`h-7 border-b flex items-center px-2 gap-1.5 shrink-0 ${isDark ? 'bg-[#222220] border-[rgba(240,237,230,0.1)]' : 'bg-[#DCD9CE] border-[#2D2D2D]/50'}`}>
              <Network size={11} className="text-[#B89B5E] shrink-0" />
              <span className={`text-[10px] font-bold uppercase tracking-wider font-redaction mr-auto ${isDark ? 'text-[rgba(240,237,230,0.75)]' : 'text-[#2D2D2D]/70'}`}>Knowledge Matrix</span>
              <div className="flex items-center gap-1 h-5 px-1.5"
                style={{ border: `1px solid ${isDark ? 'rgba(240,237,230,0.15)' : 'rgba(45,45,45,0.2)'}`, background: isDark ? 'rgba(240,237,230,0.05)' : 'rgba(45,45,45,0.05)' }}>
                <Search size={9} style={{ color: isDark ? 'rgba(240,237,230,0.4)' : 'rgba(45,45,45,0.5)' }} className="shrink-0" />
                <input type="text" value={graphSearch} onChange={e => setGraphSearch(e.target.value)}
                  placeholder="filter..." className="bg-transparent outline-none text-[10px] font-redaction w-16"
                  style={{ color: isDark ? '#F0EDE6' : '#2D2D2D' }} />
              </div>
              <button onClick={() => setHideIsolated(v => !v)} title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                className="flex items-center justify-center w-5 h-5 active:opacity-70 transition-colors"
                style={hideIsolated
                  ? { background: isDark ? '#F0EDE6' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#F0EDE6' : '#2D2D2D'}` }
                  : { border: `1px solid ${isDark ? 'rgba(240,237,230,0.2)' : 'rgba(45,45,45,0.4)'}`, color: isDark ? 'rgba(240,237,230,0.4)' : 'rgba(45,45,45,0.5)' }
                }>
                <Network size={10} />
              </button>
              <button onClick={() => setShowFilters(v => !v)} title={showFilters ? 'Hide filters' : 'Show filters'}
                className="flex items-center justify-center w-5 h-5 active:opacity-70 transition-colors"
                style={showFilters
                  ? { background: isDark ? '#F0EDE6' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#F0EDE6' : '#2D2D2D'}` }
                  : { border: `1px solid ${isDark ? 'rgba(240,237,230,0.2)' : 'rgba(45,45,45,0.4)'}`, color: isDark ? 'rgba(240,237,230,0.4)' : 'rgba(45,45,45,0.5)' }
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
                allTags={allTags}
                tagFilter={tagFilter}
                onTagFilterChange={setTagFilter}
              />
            )}
            <div ref={graphContainerRef} className="flex-1 overflow-hidden">
              <GraphView notes={notes} onNavigateToNoteById={onNavigateToNoteById} settings={settings}
                searchQuery={deferredGraphSearch} activeNoteId={activeNoteId}
                width={graphDimensions.width} height={graphDimensions.height} hideIsolated={hideIsolated}
                localDepth={localDepth} tagFilter={tagFilter} colorMode={colorMode} sizeByDegree={sizeByDegree} />
            </div>
          </div>
          <GraphInfoPanel notes={notes} activeNoteId={activeNoteId} onNavigateToNoteById={onNavigateToNoteById} isDark={isDark} />
        </div>
      )}
    </div>
  );
}

// ── Graph Info Panel ──────────────────────────────────────────────────────────

interface GraphInfoPanelProps {
  notes: Note[];
  activeNoteId?: string;
  onNavigateToNoteById: (id: string) => void;
  isDark?: boolean;
}

function GraphInfoPanel({ notes, activeNoteId, onNavigateToNoteById, isDark = false }: GraphInfoPanelProps) {
  const titleToIds = useMemo(() => buildTitleToIdsMap(notes), [notes]);

  const stats = useMemo(() => {
    let totalLinks = 0;
    let isolated = 0;
    const degreeMap = new Map<string, number>();
    notes.forEach(n => degreeMap.set(n.id, 0));
    notes.forEach(note => {
      const targets = new Set<string>();
      (note.linkRefs ?? []).forEach(id => { if (degreeMap.has(id)) targets.add(id); });
      (note.links ?? []).forEach(targetTitle => {
        const ids = titleToIds.get(targetTitle) ?? [];
        ids.forEach((id) => {
          if (degreeMap.has(id)) targets.add(id);
        });
      });
      targets.forEach(targetId => {
        if (degreeMap.has(targetId)) {
          totalLinks++;
          degreeMap.set(targetId, (degreeMap.get(targetId) ?? 0) + 1);
          degreeMap.set(note.id, (degreeMap.get(note.id) ?? 0) + 1);
        }
      });
    });
    notes.forEach(n => { if ((degreeMap.get(n.id) ?? 0) === 0) isolated++; });
    const ranked = [...degreeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, d]) => d > 0);
    return { totalNotes: notes.length, totalLinks, isolated, ranked, degreeMap };
  }, [notes, titleToIds]);

  const activeConnections = useMemo(() => {
    if (!activeNoteId) return [];
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return [];
    const out = new Set<string>();
    const inc = new Set<string>();
    (note.linkRefs ?? []).forEach(id => out.add(id));
    (note.links ?? []).forEach(title => {
      const ids = titleToIds.get(title) ?? [];
      ids.forEach((id) => out.add(id));
    });
    notes.forEach(candidate => {
      if (candidate.id === note.id) return;
      if ((candidate.linkRefs ?? []).includes(note.id)) inc.add(candidate.id);
      if ((candidate.links ?? []).includes(note.title)) inc.add(candidate.id);
    });
    return [...new Set([...out, ...inc])];
  }, [notes, activeNoteId, titleToIds]);

  return (
    <div className={`flex-1 overflow-y-auto border font-redaction min-h-0 ${isDark ? 'border-[rgba(240,237,230,0.15)] bg-[#262624]' : 'border-[#2D2D2D]/90 bg-[#EAE8E0]'}`}>
      <div className={`h-7 border-b flex items-center px-2 gap-1.5 shrink-0 ${isDark ? 'bg-[#222220] border-[rgba(240,237,230,0.1)]' : 'bg-[#DCD9CE] border-[#2D2D2D]/50'}`}>
        <GitBranch size={11} className="text-[#B89B5E] shrink-0" />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[rgba(240,237,230,0.75)]' : 'text-[#2D2D2D]/70'}`}>Knowledge Matrix Stats</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[{ label: 'Notes', value: stats.totalNotes }, { label: 'Links', value: stats.totalLinks }, { label: 'Isolated', value: stats.isolated }].map(({ label, value }) => (
            <div key={label} className={`border p-2 text-center ${isDark ? 'border-[rgba(240,237,230,0.15)]' : 'border-[#2D2D2D]'}`}>
              <div className={`text-sm font-bold leading-none tabular-nums ${isDark ? 'text-[#E8E0D0]' : 'text-[#2D2D2D]'}`}>{value}</div>
              <div className={`text-[9px] uppercase tracking-wider mt-1 ${isDark ? 'text-[rgba(240,237,230,0.5)]' : 'text-[#2D2D2D]/50'}`}>{label}</div>
            </div>
          ))}
        </div>
        {activeNoteId && (
          <div>
            <div className={`text-[9px] uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(240,237,230,0.5)]' : 'text-[#2D2D2D]/50'}`}>
              Active · {notes.find(n => n.id === activeNoteId)?.title ?? 'Unknown'}
            </div>
            {activeConnections.length === 0 ? (
              <div className={`text-[10px] italic ${isDark ? 'text-[rgba(240,237,230,0.55)]' : 'text-[#2D2D2D]/40'}`}>No connections</div>
            ) : (
              <div className="space-y-1">
                {activeConnections.slice(0, 6).map(id => {
                  const target = notes.find(n => n.id === id);
                  if (!target) return null;
                  return (
                    <button key={id} onClick={() => onNavigateToNoteById(id)}
                      className={`flex items-center gap-1.5 w-full text-left text-[11px] transition-colors ${isDark ? 'text-[rgba(240,237,230,0.5)] hover:text-[#B89B5E]' : 'text-[#2D2D2D]/70 hover:text-[#B89B5E]'}`}>
                      <Circle size={5} className="shrink-0 fill-[#B89B5E] text-[#B89B5E]" />
                      <span className="truncate">{target.title}</span>
                      <span className={`ml-auto text-[9px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(240,237,230,0.5)]' : 'text-[#2D2D2D]/30'}`}>{stats.degreeMap.get(id) ?? 0}</span>
                    </button>
                  );
                })}
                {activeConnections.length > 6 && (
                  <div className={`text-[9px] pl-3 ${isDark ? 'text-[rgba(240,237,230,0.55)]' : 'text-[#2D2D2D]/40'}`}>+{activeConnections.length - 6} more</div>
                )}
              </div>
            )}
          </div>
        )}
        {stats.ranked.length > 0 && (
          <div>
            <div className={`text-[9px] uppercase tracking-wider mb-1.5 font-bold ${isDark ? 'text-[rgba(240,237,230,0.5)]' : 'text-[#2D2D2D]/50'}`}>Most Connected</div>
            <div className="space-y-1">
              {stats.ranked.map(([id, degree]) => {
                const target = notes.find(n => n.id === id);
                if (!target) return null;
                return (
                  <button key={id} onClick={() => onNavigateToNoteById(id)}
                    className={`flex items-center gap-1.5 w-full text-left text-[11px] transition-colors ${isDark ? 'text-[rgba(240,237,230,0.5)] hover:text-[#B89B5E]' : 'text-[#2D2D2D]/70 hover:text-[#B89B5E]'}`}>
                    <div className="shrink-0 bg-[#B89B5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                    <span className="truncate">{target.title}</span>
                    <span className={`ml-auto text-[9px] tabular-nums shrink-0 ${isDark ? 'text-[rgba(240,237,230,0.5)]' : 'text-[#2D2D2D]/40'}`}>{degree}</span>
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
  allTags,
  tagFilter,
  onTagFilterChange,
}: GraphFilterPanelProps) {
  const labelCls = `text-[9px] uppercase tracking-wider font-bold ${isDark ? 'text-[rgba(240,237,230,0.55)]' : 'text-[#2D2D2D]/55'}`;
  const valueCls = `text-[10px] tabular-nums ${isDark ? 'text-[rgba(240,237,230,0.75)]' : 'text-[#2D2D2D]/80'}`;
  const borderCol = isDark ? 'rgba(240,237,230,0.12)' : 'rgba(45,45,45,0.45)';
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
          className="flex-1 h-1 accent-[#B89B5E] disabled:opacity-40"
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
                className="flex-1 h-5 text-[9px] uppercase tracking-wider font-bold transition-colors active:opacity-70"
                style={active
                  ? { background: isDark ? '#F0EDE6' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#F0EDE6' : '#2D2D2D'}` }
                  : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(240,237,230,0.55)' : 'rgba(45,45,45,0.6)' }
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
          className="flex-1 h-5 text-[9px] uppercase tracking-wider font-bold transition-colors active:opacity-70"
          style={sizeByDegree
            ? { background: isDark ? '#F0EDE6' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#F0EDE6' : '#2D2D2D'}` }
            : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(240,237,230,0.55)' : 'rgba(45,45,45,0.6)' }
          }
        >
          {sizeByDegree ? 'By Degree' : 'Uniform'}
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
                className={`text-[9px] uppercase tracking-wider ${isDark ? 'text-[rgba(240,237,230,0.5)] hover:text-[#B89B5E]' : 'text-[#2D2D2D]/55 hover:text-[#B89B5E]'}`}
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
                  className="text-[9px] px-1.5 h-4 uppercase tracking-wider font-bold transition-colors active:opacity-70"
                  style={active
                    ? { background: '#B89B5E', color: isDark ? '#1E1E1C' : '#FFFFFF', border: '1px solid #B89B5E' }
                    : { border: `1px solid ${borderCol}`, color: isDark ? 'rgba(240,237,230,0.55)' : 'rgba(45,45,45,0.65)' }
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
