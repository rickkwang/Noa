import React, { CSSProperties, useEffect, useState } from 'react';

const dragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };
const noDragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };
import { Search, Settings, PanelLeft, PanelRight, Network, X, Calendar } from 'lucide-react';

interface TopBarProps {
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  searchQuery: string;
  onSearchChange?: (query: string) => void;
  onToggleGraphView: () => void;
  isGraphViewOpen?: boolean;
  showGraphView?: boolean;
  showDailyNote?: boolean;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  onOpenDailyNote?: () => void;
  workspaceName?: string;
  fsLastSyncAt?: string | null;
  hasFsHandle?: boolean;
}

export default function TopBar({ onOpenSettings, onToggleSidebar, onToggleRightPanel, isSidebarOpen, isRightPanelOpen, searchQuery, onSearchChange, onToggleGraphView, isGraphViewOpen, showGraphView = true, showDailyNote = true, searchInputRef, onOpenDailyNote, workspaceName, fsLastSyncAt, hasFsHandle }: TopBarProps) {
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="h-12 border-b border-[#2D2D2D] grid grid-cols-3 items-center shrink-0 bg-[#EAE8E0] font-redaction" style={dragRegion}>
      {/* Left Section: Traffic lights space + icon + title */}
      <div className="flex items-center justify-start pl-[90px] pr-4">
        <div className="flex items-center gap-2" style={noDragRegion}>
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 text-[#2D2D2D]/70 hover:text-[#B89B5E] active:opacity-70 transition-colors cursor-pointer ${isSidebarOpen ? 'text-[#B89B5E]' : ''}`}
            title="Toggle Sidebar"
          >
            <PanelLeft size={16} />
          </button>
          {(() => {
            const mins = hasFsHandle && fsLastSyncAt
              ? Math.floor((nowTick - new Date(fsLastSyncAt).getTime()) / 60000)
              : null;
            const stale = mins != null && mins > 30;
            const tooltip = [
              workspaceName,
              mins != null ? `${stale ? '⚠ ' : ''}Last synced: ${mins < 1 ? 'just now' : `${mins}m ago`}` : null,
            ].filter(Boolean).join('\n');
            return (
              <span
                className="text-sm font-bold leading-tight cursor-default"
                title={tooltip || undefined}
                style={stale ? { color: '#d97706' } : undefined}
              >
                Noa{stale ? ' ⚠' : ''}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Center Section: Search */}
      <div className="flex items-center justify-center min-w-0 px-4" style={noDragRegion}>
        <div className="flex items-center border border-[#2D2D2D] bg-[#EAE8E0] px-3 py-1.5 shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] w-full max-w-md focus-within:ring-1 ring-[#B89B5E] transition-all min-w-0">
          <Search size={14} className="text-[#2D2D2D]/50 mr-2 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            placeholder="Search notes, tags..."
            className="bg-transparent outline-none w-full text-[#2D2D2D] placeholder-[#2D2D2D]/50 font-redaction min-w-0"
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange && onSearchChange('')}
              className="text-[#2D2D2D]/40 hover:text-[#B89B5E] active:opacity-70 shrink-0 ml-1"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Right Section: Actions */}
      <div className="flex items-center justify-end space-x-2 pr-4" style={noDragRegion}>
        {showDailyNote && (
          <button
            onClick={onOpenDailyNote}
            className="p-1.5 text-[#2D2D2D]/70 hover:text-[#B89B5E] active:opacity-70 transition-colors cursor-pointer"
            title="Today's note"
          >
            <Calendar size={16} />
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="p-1.5 text-[#2D2D2D]/70 hover:text-[#B89B5E] active:opacity-70 transition-colors cursor-pointer"
          title="Settings"
        >
          <Settings size={16} />
        </button>
        {showGraphView && (
          <button
            onClick={onToggleGraphView}
            className={`p-1.5 text-[#2D2D2D]/70 hover:text-[#B89B5E] active:opacity-70 transition-colors cursor-pointer ${isGraphViewOpen ? 'text-[#B89B5E]' : ''}`}
            title="Toggle Graph View"
          >
            <Network size={16} />
          </button>
        )}
        <button 
          onClick={onToggleRightPanel}
          className={`p-1.5 text-[#2D2D2D]/70 hover:text-[#B89B5E] active:opacity-70 transition-colors cursor-pointer ${isRightPanelOpen ? 'text-[#B89B5E]' : ''}`}
          title="Toggle Panel"
        >
          <PanelRight size={16} />
        </button>
      </div>
    </div>
  );
}
