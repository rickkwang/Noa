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
  const activeToggleClass = isDark ? 'text-[#F9F9F7]' : 'text-[#CC7D5E]';
  return (
    <div className="h-8 border-b grid grid-cols-3 items-center shrink-0 font-redaction" style={{ ...dragRegion, backgroundColor: isDark ? '#2D2D2B' : '#F9F9F7', borderBottomColor: 'var(--panel-divider, #2D2D2B)' }}>
      {/* Left Section: Traffic lights space + icon + title */}
      <div className="flex items-center justify-start pl-[78px] pr-4">
        <div className="flex items-center gap-2" style={noDragRegion}>
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer ${isSidebarOpen ? activeToggleClass : ''}`}
            title="Toggle Sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>
      </div>

      {/* Center Section: Search */}
      <div className="flex items-center justify-center min-w-0 px-4">
        <div className="flex h-[22px] items-center border px-3 rounded-md shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] w-full max-w-md min-w-0" style={{ ...noDragRegion, backgroundColor: isDark ? '#2D2D2B' : '#F9F9F7', borderColor: 'var(--panel-divider, #2D2D2B)' }}>
          <Search size={14} className="text-[#2D2D2B]/50 mr-2 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            placeholder="Search notes, tags..."
            className="h-full bg-transparent outline-none w-full text-[#2D2D2B] placeholder-[#2D2D2B]/50 font-redaction leading-none min-w-0"
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange && onSearchChange('')}
              className="text-[#2D2D2B]/40 hover:text-[#CC7D5E] active:opacity-70 shrink-0 ml-1"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Right Section: Actions */}
      <div className="flex items-center justify-end pr-4">
        <div className="flex items-center space-x-2" style={noDragRegion}>
          {showDailyNote && (
            <button
              onClick={onOpenDailyNote}
              className="p-1.5 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
              title="Today's note"
            >
              <Calendar size={16} />
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={onToggleRightPanel}
            className={`p-1.5 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer ${isRightPanelOpen ? activeToggleClass : ''}`}
            title="Toggle Panel"
          >
            <PanelRight size={16} className="scale-x-[-1]" />
          </button>
        </div>
      </div>
    </div>
  );
}
