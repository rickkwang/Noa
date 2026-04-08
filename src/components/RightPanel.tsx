import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, ExternalLink, Check, Link, Network, Search, GitBranch, Circle } from 'lucide-react';
import { GlobalTask, Note } from '../types';
import { AppSettings } from '../types';
import GraphView from './GraphView';
import { buildTitleToIdsMap } from '../lib/noteUtils';
import { STORAGE_KEYS } from '../constants/storageKeys';

interface RightPanelProps {
  tasks: GlobalTask[];
  onToggleTask: (task: GlobalTask) => void;
  onNavigateToNoteById: (id: string) => void;
  activeNote?: Note;
  activeTab: 'tasks' | 'backlinks' | 'graph';
  onTabChange: (tab: 'tasks' | 'backlinks' | 'graph') => void;
  notes: Note[];
  settings: AppSettings;
  activeNoteId?: string;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'border-red-400 text-red-500',
  medium: 'border-[#B89B5E] text-[#B89B5E]',
  low: 'border-[#2D2D2D]/40 text-[#2D2D2D]/60',
};

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'none') return null;
  return (
    <span className={`text-[10px] uppercase tracking-wider border px-1 font-bold font-redaction ${PRIORITY_STYLES[priority] ?? ''}`}>
      {priority}
    </span>
  );
}

export default function RightPanel({
  tasks, onToggleTask, onNavigateToNoteById, activeNote,
  activeTab, onTabChange, notes, settings, activeNoteId,
}: RightPanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [dueDateFilter, setDueDateFilter] = useState<'all' | 'today' | 'week' | 'overdue'>('all');
  const [hideIsolated, setHideIsolated] = useState(false);

  const activeTasks = useMemo(() => tasks.filter(t => !t.completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter(t => t.completed), [tasks]);

  const filteredActiveTasks = useMemo(() => activeTasks.filter(task => {
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (dueDateFilter !== 'all') {
      if (!task.dueDate) return false;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
      if (dueDateFilter === 'today' && due.getTime() !== today.getTime()) return false;
      if (dueDateFilter === 'week') {
        const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
        if (due < today || due > weekEnd) return false;
      }
      if (dueDateFilter === 'overdue' && due >= today) return false;
    }
    return true;
  }), [activeTasks, priorityFilter, dueDateFilter]);
  const [graphSearch, setGraphSearch] = useState('');
  const deferredGraphSearch = useDeferredValue(graphSearch);
  const [showGraphGuide, setShowGraphGuide] = useState(() => !localStorage.getItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN));
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 320, height: 400 });

  useEffect(() => {
    if (activeTab !== 'graph' || !graphContainerRef.current) return;

    const syncGraphSize = () => {
      if (!graphContainerRef.current) return;
      const rect = graphContainerRef.current.getBoundingClientRect();
      setGraphDimensions({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    syncGraphSize();

    const observer = new ResizeObserver(syncGraphSize);
    observer.observe(graphContainerRef.current);
    window.addEventListener('resize', syncGraphSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncGraphSize);
    };
  }, [activeTab]);

  const backlinks = useMemo(() => {
    if (!activeNote) return [];
    return notes.filter(n =>
      n.id !== activeNote.id &&
      ((n.linkRefs ?? []).includes(activeNote.id) || (n.links ?? []).includes(activeNote.title))
    );
  }, [activeNote, notes]);

  const getSnippet = (note: Note, targetTitle: string) => {
    const lines = note.content.split('\n');
    const idx = lines.findIndex(l => l.includes(`[[${targetTitle}]]`));
    if (idx === -1) return '';
    return lines.slice(Math.max(0, idx - 1), idx + 2).join('\n').trim();
  };

  const backlinkSnippets = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeNote) return map;
    backlinks.forEach((note) => {
      map.set(note.id, getSnippet(note, activeNote.title));
    });
    return map;
  }, [activeNote, backlinks]);

  return (
    <div className="w-full h-full border-l border-[#2D2D2D] flex flex-col bg-[#EAE8E0] shrink-0 relative">
      <div className="h-8 border-b border-[#2D2D2D] flex items-center bg-[#DCD9CE] shrink-0 overflow-hidden">
        <button
          onClick={() => onTabChange('tasks')}
          className={`flex-1 flex items-center justify-center space-x-1.5 h-full text-xs font-bold uppercase tracking-wider border-r border-[#2D2D2D]/30 transition-colors active:opacity-70 font-redaction ${activeTab === 'tasks' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}
        >
          <CheckSquare size={13} className="text-[#B89B5E] shrink-0" />
          <span>Tasks {activeTasks.length > 0 && `(${activeTasks.length})`}</span>
        </button>
        <button
          onClick={() => onTabChange('backlinks')}
          className={`flex-1 flex items-center justify-center space-x-1.5 h-full text-xs font-bold uppercase tracking-wider border-r border-[#2D2D2D]/30 transition-colors active:opacity-70 font-redaction ${activeTab === 'backlinks' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}
        >
          <Link size={13} className="text-[#B89B5E] shrink-0" />
          <span>Backlinks {backlinks.length > 0 && `(${backlinks.length})`}</span>
        </button>
        <button
          onClick={() => onTabChange('graph')}
          className={`flex-1 flex items-center justify-center space-x-1.5 h-full text-xs font-bold uppercase tracking-wider transition-colors active:opacity-70 font-redaction ${activeTab === 'graph' ? 'bg-[#EAE8E0] text-[#2D2D2D]' : 'text-[#2D2D2D]/50 hover:text-[#2D2D2D]'}`}
        >
          <Network size={13} className="text-[#B89B5E] shrink-0" />
          <span>Graph</span>
        </button>
      </div>

      {activeTab === 'graph' ? (
        <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
          {showGraphGuide && (
            <div className="border border-[#2D2D2D]/30 bg-[#DCD9CE] px-3 py-2 text-[11px] text-[#2D2D2D]/80 leading-relaxed">
              <div className="font-bold uppercase tracking-wider text-[10px] text-[#2D2D2D]/60 mb-1">Graph Guide</div>
              <div>Node size reflects connectivity. Use "filter..." to narrow nodes. Toggle the network icon to hide isolated nodes.</div>
              <button
                onClick={() => {
                  setShowGraphGuide(false);
                  localStorage.setItem(STORAGE_KEYS.GRAPH_GUIDE_SEEN, '1');
                }}
                className="mt-2 text-[10px] uppercase tracking-wider font-bold border border-[#2D2D2D]/40 px-2 py-0.5 hover:border-[#2D2D2D]"
              >
                Got It
              </button>
            </div>
          )}
          {/* Graph window with border */}
          <div className="flex flex-col border border-[#2D2D2D]/90" style={{ height: '55%', minHeight: 180 }}>
            {/* Graph toolbar */}
            <div className="h-7 bg-[#DCD9CE] border-b border-[#2D2D2D]/50 flex items-center px-2 gap-1.5 shrink-0">
              <Network size={11} className="text-[#B89B5E] shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#2D2D2D]/70 font-redaction mr-auto">Knowledge Graph</span>
              <div className="flex items-center gap-1 border border-[#2D2D2D]/50 px-1.5 py-0.5 bg-[#EAE8E0]/60">
                <Search size={9} className="text-[#2D2D2D]/50 shrink-0" />
                <input
                  type="text"
                  value={graphSearch}
                  onChange={e => setGraphSearch(e.target.value)}
                  placeholder="filter..."
                  className="bg-transparent outline-none text-[10px] text-[#2D2D2D] placeholder-[#2D2D2D]/40 font-redaction w-16"
                />
              </div>
              <button
                onClick={() => setHideIsolated(v => !v)}
                title={hideIsolated ? 'Show all nodes' : 'Hide isolated nodes'}
                className={`border px-1.5 py-0.5 text-[9px] font-bold font-redaction active:opacity-70 transition-colors ${hideIsolated ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}
              >
                <Network size={9} />
              </button>
            </div>
            {/* Graph canvas */}
            <div ref={graphContainerRef} className="flex-1 overflow-hidden">
              <GraphView
                notes={notes}
                onNavigateToNoteById={onNavigateToNoteById}
                settings={settings}
                searchQuery={deferredGraphSearch}
                activeNoteId={activeNoteId}
                width={graphDimensions.width}
                height={graphDimensions.height}
                hideIsolated={hideIsolated}
              />
            </div>
          </div>

          {/* Info panel */}
          <GraphInfoPanel
            notes={notes}
            activeNoteId={activeNoteId}
            onNavigateToNoteById={onNavigateToNoteById}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-redaction">
          {activeTab === 'backlinks' && (
            <>
              {!activeNote ? (
                <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">Open a note to see backlinks.</div>
              ) : backlinks.length === 0 ? (
                <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">No backlinks found for<br/><span className="font-bold text-[#2D2D2D]/70">"{activeNote.title}"</span></div>
              ) : (
                <div className="space-y-3">
                  {backlinks.map(note => (
                    <div key={note.id} className="border-2 border-[#2D2D2D] bg-[#EAE8E0] p-3">
                      <button
                        onClick={() => onNavigateToNoteById(note.id)}
                        className="font-bold text-sm text-[#2D2D2D] hover:text-[#B89B5E] transition-colors flex items-center space-x-1.5 w-full text-left"
                      >
                        <ExternalLink size={12} className="shrink-0" />
                        <span className="truncate">{note.title}</span>
                      </button>
                      {backlinkSnippets.get(note.id) && (
                        <p className="mt-1.5 text-xs text-[#2D2D2D]/60 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                          {backlinkSnippets.get(note.id)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {activeTab === 'tasks' && (
            <>
              {tasks.length === 0 && (
                <div className="text-center text-[#2D2D2D]/50 mt-10 text-sm">
                  No tasks found.<br/>Add "- [ ] task" in any note!
                </div>
              )}

              {tasks.length > 0 && (
                <div className="flex flex-col gap-1.5 pb-3 border-b border-[#2D2D2D]/20">
                  <div className="flex gap-1">
                    {(['all', 'high', 'medium', 'low'] as const).map(p => (
                      <button key={p} onClick={() => setPriorityFilter(p)}
                        className={`flex-1 text-[10px] uppercase tracking-wider border px-1 py-0.5 font-bold font-redaction active:opacity-70 transition-colors ${priorityFilter === p ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}>
                        {p === 'all' ? 'All' : p}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {(['all', 'today', 'week', 'overdue'] as const).map(d => (
                      <button key={d} onClick={() => setDueDateFilter(d)}
                        className={`flex-1 text-[10px] uppercase tracking-wider border px-1 py-0.5 font-bold font-redaction active:opacity-70 transition-colors ${dueDateFilter === d ? 'bg-[#2D2D2D] text-[#EAE8E0] border-[#2D2D2D]' : 'border-[#2D2D2D]/40 text-[#2D2D2D]/50 hover:border-[#2D2D2D]'}`}>
                        {d === 'all' ? 'All' : d === 'today' ? 'Today' : d === 'week' ? 'Week' : 'Late'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredActiveTasks.length === 0 && activeTasks.length > 0 && (
                <div className="text-center text-[#2D2D2D]/50 mt-6 text-sm">No tasks match the current filter.</div>
              )}

              {filteredActiveTasks.length > 0 && (
                <div className="space-y-2">
                  {filteredActiveTasks.map(task => (
                    <div key={task.id} className="group flex flex-col p-2 border-2 border-[#2D2D2D] bg-[#EAE8E0] transition-all duration-150">
                      <div className="flex items-start space-x-2">
                        <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 cursor-pointer">
                          <div className="w-4 h-4 border-2 border-[#2D2D2D] bg-[#EAE8E0] hover:bg-[#DCD9CE] transition-all duration-150 active:bg-[#2D2D2D]/20"></div>
                        </button>
                        <span className="flex-1 text-sm leading-tight">{task.content}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5 pl-6 text-xs text-[#2D2D2D]/60">
                        <div className="flex items-center gap-x-2">
                          <PriorityBadge priority={task.priority} />
                          {task.dueDate && (
                            <span className="text-[10px] text-[#2D2D2D]/50 tabular-nums whitespace-nowrap">{task.dueDate}</span>
                          )}
                        </div>
                        <button
                          onClick={() => onNavigateToNoteById(task.noteId)}
                          className="flex items-center space-x-1 hover:text-[#B89B5E] transition-colors cursor-pointer shrink-0"
                        >
                          <ExternalLink size={10} />
                          <span>{task.noteTitle}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {completedTasks.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-[#2D2D2D]/20">
                  <div className="text-[#2D2D2D]/40 text-xs font-bold mb-2 uppercase tracking-wider">
                    Completed ({completedTasks.length})
                  </div>
                  {completedTasks.map(task => (
                    <div key={task.id} className="group flex flex-col p-2 border border-[#2D2D2D]/20 opacity-50 transition-all duration-150">
                      <div className="flex items-start space-x-2">
                        <button onClick={() => onToggleTask(task)} className="mt-0.5 shrink-0 cursor-pointer">
                          <div className="w-4 h-4 border-2 border-[#2D2D2D]/60 bg-[#2D2D2D]/60 flex items-center justify-center text-[#EAE8E0] transition-all duration-150">
                            <Check size={12} strokeWidth={4} />
                          </div>
                        </button>
                        <span className="flex-1 text-sm leading-tight line-through text-[#2D2D2D]/50">{task.content}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5 pl-6 text-xs text-[#2D2D2D]/40">
                        <div className="flex items-center gap-x-2">
                          <PriorityBadge priority={task.priority} />
                          {task.dueDate && (
                            <span className="text-[10px] tabular-nums">{task.dueDate}</span>
                          )}
                        </div>
                        <button
                          onClick={() => onNavigateToNoteById(task.noteId)}
                          className="flex items-center space-x-1 hover:text-[#B89B5E] transition-colors cursor-pointer shrink-0"
                        >
                          <ExternalLink size={10} />
                          <span>{task.noteTitle}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
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
      (note.linkRefs ?? []).forEach((id) => {
        if (degreeMap.has(id)) targets.add(id);
      });
      (note.links ?? []).forEach((targetTitle) => {
        const ids = titleToIds.get(targetTitle);
        if (ids && ids.length === 1 && degreeMap.has(ids[0])) targets.add(ids[0]);
      });
      targets.forEach((targetId) => {
        if (degreeMap.has(targetId)) {
          totalLinks++;
          degreeMap.set(targetId, (degreeMap.get(targetId) ?? 0) + 1);
          degreeMap.set(note.id, (degreeMap.get(note.id) ?? 0) + 1);
        }
      });
    });

    notes.forEach(n => { if ((degreeMap.get(n.id) ?? 0) === 0) isolated++; });

    // top connected notes
    const ranked = [...degreeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .filter(([, d]) => d > 0);

    return { totalNotes: notes.length, totalLinks, isolated, ranked, degreeMap };
  }, [notes, titleToIds]);

  const activeConnections = useMemo(() => {
    if (!activeNoteId) return [];
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return [];
    const out = new Set<string>();
    const inc = new Set<string>();
    (note.linkRefs ?? []).forEach((id) => out.add(id));
    (note.links ?? []).forEach((title) => {
      const ids = titleToIds.get(title);
      if (ids && ids.length === 1) out.add(ids[0]);
    });
    notes.forEach((candidate) => {
      if (candidate.id === note.id) return;
      if ((candidate.linkRefs ?? []).includes(note.id)) inc.add(candidate.id);
      if ((candidate.links ?? []).includes(note.title)) inc.add(candidate.id);
    });
    return [...new Set([...out, ...inc])];
  }, [notes, activeNoteId, titleToIds]);

  return (
    <div className="flex-1 overflow-y-auto border border-[#2D2D2D]/90 font-redaction min-h-0">
      {/* Header */}
      <div className="h-7 bg-[#DCD9CE] border-b border-[#2D2D2D]/50 flex items-center px-2 gap-1.5 shrink-0">
        <GitBranch size={11} className="text-[#B89B5E] shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#2D2D2D]/70">Graph Stats</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Notes', value: stats.totalNotes },
            { label: 'Links', value: stats.totalLinks },
            { label: 'Isolated', value: stats.isolated },
          ].map(({ label, value }) => (
            <div key={label} className="border border-[#2D2D2D] p-2 text-center">
              <div className="text-sm font-bold text-[#2D2D2D] leading-none tabular-nums">{value}</div>
              <div className="text-[9px] uppercase tracking-wider text-[#2D2D2D]/50 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Active note connections */}
        {activeNoteId && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[#2D2D2D]/50 mb-1.5 font-bold">
              Active · {notes.find((n) => n.id === activeNoteId)?.title ?? 'Unknown'}
            </div>
            {activeConnections.length === 0 ? (
              <div className="text-[10px] text-[#2D2D2D]/40 italic">No connections</div>
            ) : (
              <div className="space-y-1">
                {activeConnections.slice(0, 6).map((id) => {
                  const target = notes.find((n) => n.id === id);
                  if (!target) return null;
                  return (
                  <button
                    key={id}
                    onClick={() => onNavigateToNoteById(id)}
                    className="flex items-center gap-1.5 w-full text-left text-[11px] text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors"
                  >
                    <Circle size={5} className="shrink-0 fill-[#B89B5E] text-[#B89B5E]" />
                    <span className="truncate">{target.title}</span>
                    <span className="ml-auto text-[9px] text-[#2D2D2D]/30 tabular-nums shrink-0">
                      {stats.degreeMap.get(id) ?? 0}
                    </span>
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

        {/* Top connected */}
        {stats.ranked.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[#2D2D2D]/50 mb-1.5 font-bold">Most Connected</div>
            <div className="space-y-1">
              {stats.ranked.map(([id, degree]) => {
                const target = notes.find((n) => n.id === id);
                if (!target) return null;
                return (
                <button
                  key={id}
                  onClick={() => onNavigateToNoteById(id)}
                  className="flex items-center gap-1.5 w-full text-left text-[11px] text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors"
                >
                  <div
                    className="shrink-0 bg-[#B89B5E]"
                    style={{ width: Math.min(8, 3 + degree), height: Math.min(8, 3 + degree) }}
                  />
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
