import React, { CSSProperties } from 'react';
import { useIsDark } from '../hooks/useIsDark';
import { AppSettings } from '../types';

const dragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };
const noDragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };
import { Search, Settings, PanelLeft, PanelRight, X, Calendar } from '@/src/lib/icons';

interface TopBarProps {
  settings: AppSettings;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  searchQuery: string;
  onSearchChange?: (query: string) => void;
  showDailyNote?: boolean;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onOpenDailyNote?: () => void;
}

export default function TopBar({ settings, onOpenSettings, onToggleSidebar, onToggleRightPanel, isSidebarOpen, isRightPanelOpen, searchQuery, onSearchChange, showDailyNote = true, searchInputRef, onOpenDailyNote }: TopBarProps) {
  const isDark = useIsDark(settings.appearance.theme);
  // Accent coral is the active-state color everywhere else, but on the dark
  // charcoal titlebar it reads as too loud right next to the traffic lights —
  // use a bright neutral instead so "open" still reads as brighter-than-idle.
  const activeToggleClass = isDark ? 'text-[#EEEDEA]' : 'text-[#CC7D5E]';
  return (
    <div className="h-8 border-b grid grid-cols-3 items-center shrink-0 bg-[#EAE8E0] font-redaction" style={{ ...dragRegion, borderBottomColor: 'var(--panel-divider, #2D2D2D)' }}>
      {/* Left Section: Traffic lights space + icon + title */}
      <div className="flex items-center justify-start pl-[78px] pr-4">
        <div className="flex items-center gap-2" style={noDragRegion}>
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 text-[#2D2D2D]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer ${isSidebarOpen ? activeToggleClass : ''}`}
            title="Toggle Sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>
      </div>

      {/* Center Section: Search */}
      <div className="flex items-center justify-center min-w-0 px-4" style={noDragRegion}>
        <div className="flex items-center border border-[#2D2D2D] bg-[#EAE8E0] px-3 py-0.5 rounded-lg shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] w-full max-w-md min-w-0">
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
              className="text-[#2D2D2D]/40 hover:text-[#CC7D5E] active:opacity-70 shrink-0 ml-1"
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
            className="p-1.5 text-[#2D2D2D]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
            title="Today's note"
          >
            <Calendar size={16} />
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="p-1.5 text-[#2D2D2D]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
          title="Settings"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={onToggleRightPanel}
          className={`p-1.5 text-[#2D2D2D]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer ${isRightPanelOpen ? activeToggleClass : ''}`}
          title="Toggle Panel"
        >
          <PanelRight size={16} className="scale-x-[-1]" />
        </button>
      </div>
    </div>
  );
}
