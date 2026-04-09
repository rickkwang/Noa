import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Link, Network, Search, GitBranch, Circle, SlidersHorizontal } from 'lucide-react';
import { GlobalTask, Note } from '../types';
import { AppSettings } from '../types';
import GraphView from './GraphView';
import { buildTitleToIdsMap } from '../lib/noteUtils';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { useIsDark } from '../hooks/useIsDark';
import { TasksPanel } from './rightPanel/TasksPanel';
import { BacklinksPanel } from './rightPanel/BacklinksPanel';
import { PropertiesPanel } from './rightPanel/PropertiesPanel';

export type RightPanelTab = 'tasks' | 'backlinks' | 'graph' | 'properties';

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
    <div className="w-full h-full border-l border-[#2D2D2D] flex flex-col bg-[#EAE8E0] shrink-0 relative">
      {/* Tab bar */}
      <div className="h-8 border-b border-[#2D2D2D] flex items-center bg-[#DCD9CE] shrink-0 overflow-hidden">
        <button onClick={() => onTabChange('tasks')} title="Tasks"
          className={`flex-1 flex items-center justify-center gap-1 h-full text-xs font-bold uppercase tracking-wider border-r border-[#2D2D2D]/30 transition-colors active:opacity-70 font-redaction relative ${activeTab === 'tasks' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}>
          <CheckSquare size={12} className="text-[#B89B5E] shrink-0" />
          <span>Tasks</span>
          {activeTasks.length > 0 && <span className="absolute top-0.5 right-1 text-[9px] font-bold text-[#B89B5E] leading-none">{activeTasks.length}</span>}
        </button>
        <button onClick={() => onTabChange('backlinks')} title="Backlinks"
          className={`flex-1 flex items-center justify-center gap-1 h-full text-xs font-bold uppercase tracking-wider border-r border-[#2D2D2D]/30 transition-colors active:opacity-70 font-redaction relative ${activeTab === 'backlinks' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}>
          <Link size={12} className="text-[#B89B5E] shrink-0" />
          <span>Links</span>
          {backlinksCount > 0 && <span className="absolute top-0.5 right-1 text-[9px] font-bold text-[#B89B5E] leading-none">{backlinksCount}</span>}
        </button>
        <button onClick={() => onTabChange('graph')} title="Graph"
          className={`flex-1 flex items-center justify-center gap-1 h-full text-xs font-bold uppercase tracking-wider border-r border-[#2D2D2D]/30 transition-colors active:opacity-70 font-redaction ${activeTab === 'graph' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}>
          <Network size={12} className="text-[#B89B5E] shrink-0" />
          <span>Graph</span>
        </button>
        <button onClick={() => onTabChange('properties')} title="Properties"
          className={`flex-1 flex items-center justify-center gap-1 h-full text-xs font-bold uppercase tracking-wider transition-colors active:opacity-70 font-redaction ${activeTab === 'properties' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}>
          <SlidersHorizontal size={12} className="text-[#B89B5E] shrink-0" />
          <span>Props</span>
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'tasks' && (
        <TasksPanel tasks={tasks} onToggleTask={onToggleTask} onNavigateToNoteById={onNavigateToNoteById} />
      )}
      {activeTab === 'backlinks' && (
        <BacklinksPanel activeNote={activeNote} notes={notes} onNavigateToNoteById={onNavigateToNoteById} />
      )}
      {activeTab === 'properties' && (
        <PropertiesPanel activeNote={activeNote} onUpdateNote={onUpdateNote} />
      )}
      {activeTab === 'graph' && (
        <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
          {showGraphGuide && (
            <div className="border border-[#2D2D2D]/30 bg-[#DCD9CE] px-3 py-2 text-[11px] text-[#2D2D2D]/80 leading-relaxed">
              <div className="font-bold uppercase tracking-wider text-[10px] text-[#2D2D2D]/60 mb-1">Graph Guide</div>
              <div>Node size reflects connectivity. Use "filter..." to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
              <button
                onClick={() => {
                  setShowGraphGuide(false);
                  try { localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1'); } catch { /* quota exceeded */ }
                }}
                className="mt-2 text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2D]/40 px-2 py-0.5 hover:border-[#2D2D2D]"
              >
                Got It
              </button>
            </div>
          )}
          <div className="flex flex-col border border-[#2D2D2D]/90" style={{ height: '55%', minHeight: 180 }}>
            <div className="h-7 bg-[#DCD9CE] border-b border-[#2D2D2D]/50 flex items-center px-2 gap-1.5 shrink-0">
              <Network size={11} className="text-[#B89B5E] shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#2D2D2D]/70 font-redaction mr-auto">Knowledge Graph</span>
              <div className="flex items-center gap-1 px-1.5 py-0.5"
                style={{ border: `1px solid ${isDark ? 'rgba(240,237,230,0.15)' : 'rgba(45,45,45,0.2)'}`, background: isDark ? 'rgba(240,237,230,0.05)' : 'rgba(45,45,45,0.05)' }}>
                <Search size={9} style={{ color: isDark ? 'rgba(240,237,230,0.4)' : 'rgba(45,45,45,0.5)' }} className="shrink-0" />
                <input type="text" value={graphSearch} onChange={e => setGraphSearch(e.target.value)}
                  placeholder="filter..." className="bg-transparent outline-none text-[10px] font-redaction w-16"
                  style={{ color: isDark ? '#F0EDE6' : '#2D2D2D' }} />
              </div>
              <button onClick={() => setHideIsolated(v => !v)} title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                className="px-1.5 py-0.5 text-[9px] font-bold font-redaction active:opacity-70 transition-colors"
                style={hideIsolated
                  ? { background: isDark ? '#F0EDE6' : '#2D2D2D', color: isDark ? '#262624' : '#EAE8E0', border: `1px solid ${isDark ? '#F0EDE6' : '#2D2D2D'}` }
                  : { border: `1px solid ${isDark ? 'rgba(240,237,230,0.2)' : 'rgba(45,45,45,0.4)'}`, color: isDark ? 'rgba(240,237,230,0.4)' : 'rgba(45,45,45,0.5)' }
                }>
                <Network size={9} />
              </button>
            </div>
            <div ref={graphContainerRef} className="flex-1 overflow-hidden">
              <GraphView notes={notes} onNavigateToNoteById={onNavigateToNoteById} settings={settings}
                searchQuery={deferredGraphSearch} activeNoteId={activeNoteId}
                width={graphDimensions.width} height={graphDimensions.height} hideIsolated={hideIsolated} />
            </div>
          </div>
          <GraphInfoPanel notes={notes} activeNoteId={activeNoteId} onNavigateToNoteById={onNavigateToNoteById} />
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
}

function GraphInfoPanel({ notes, activeNoteId, onNavigateToNoteById }: GraphInfoPanelProps) {
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
        const ids = titleToIds.get(targetTitle);
        if (ids && ids.length === 1 && degreeMap.has(ids[0])) targets.add(ids[0]);
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
      const ids = titleToIds.get(title);
      if (ids && ids.length === 1) out.add(ids[0]);
    });
    notes.forEach(candidate => {
      if (candidate.id === note.id) return;
      if ((candidate.linkRefs ?? []).includes(note.id)) inc.add(candidate.id);
      if ((candidate.links ?? []).includes(note.title)) inc.add(candidate.id);
    });
    return [...new Set([...out, ...inc])];
  }, [notes, activeNoteId, titleToIds]);

  return (
    <div className="flex-1 overflow-y-auto border border-[#2D2D2D]/90 font-redaction min-h-0">
      <div className="h-7 bg-[#DCD9CE] border-b border-[#2D2D2D]/50 flex items-center px-2 gap-1.5 shrink-0">
        <GitBranch size={11} className="text-[#B89B5E] shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#2D2D2D]/70">Graph Stats</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[{ label: 'Notes', value: stats.totalNotes }, { label: 'Links', value: stats.totalLinks }, { label: 'Isolated', value: stats.isolated }].map(({ label, value }) => (
            <div key={label} className="border border-[#2D2D2D] p-2 text-center">
              <div className="text-sm font-bold text-[#2D2D2D] leading-none tabular-nums">{value}</div>
              <div className="text-[9px] uppercase tracking-wider text-[#2D2D2D]/50 mt-1">{label}</div>
            </div>
          ))}
        </div>
        {activeNoteId && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[#2D2D2D]/50 mb-1.5 font-bold">
              Active · {notes.find(n => n.id === activeNoteId)?.title ?? 'Unknown'}
            </div>
            {activeConnections.length === 0 ? (
              <div className="text-[10px] text-[#2D2D2D]/40 italic">No connections</div>
            ) : (
              <div className="space-y-1">
                {activeConnections.slice(0, 6).map(id => {
                  const target = notes.find(n => n.id === id);
                  if (!target) return null;
                  return (
                    <button key={id} onClick={() => onNavigateToNoteById(id)}
                      className="flex items-center gap-1.5 w-full text-left text-[11px] text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors">
                      <Circle size={5} className="shrink-0 fill-[#B89B5E] text-[#B89B5E]" />
                      <span className="truncate">{target.title}</span>
                      <span className="ml-auto text-[9px] text-[#2D2D2D]/30 tabular-nums shrink-0">{stats.degreeMap.get(id) ?? 0}</span>
                    </button>
                  );
                })}
                {activeConnections.length > 6 && (
                  <div className="text-[9px] text-[#2D2D2D]/40 pl-3">+{activeConnections.length - 6} more</div>
                )}
              </div>
            )}
          </div>
        )}
        {stats.ranked.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[#2D2D2D]/50 mb-1.5 font-bold">Most Connected</div>
            <div className="space-y-1">
              {stats.ranked.map(([id, degree]) => {
                const target = notes.find(n => n.id === id);
                if (!target) return null;
                return (
                  <button key={id} onClick={() => onNavigateToNoteById(id)}
                    className="flex items-center gap-1.5 w-full text-left text-[11px] text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors">
                    <div className="shrink-0 bg-[#B89B5E]" style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }} />
                    <span className="truncate">{target.title}</span>
                    <span className="ml-auto text-[9px] text-[#2D2D2D]/40 tabular-nums shrink-0">{degree}</span>
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
