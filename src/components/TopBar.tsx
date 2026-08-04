import React, { CSSProperties } from 'react';
import { TITLEBAR_PANEL_TABS_SLOT_ID } from '../constants/rightTabs';
import { useIsDark } from '../hooks/useIsDark';
import { AppSettings } from '../types';
import { Search, Settings, PanelLeft, PanelRight, X } from '@/src/lib/icons';

const dragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };
const noDragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };

interface TopBarProps {
  settings: AppSettings;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  sidebarToggleRef: React.RefObject<HTMLButtonElement | null>;
  onSidebarPreviewEnter: () => void;
  onSidebarPreviewLeave: () => void;
  onToggleRightPanel: () => void;
  isSidebarOpen: boolean;
  isSidebarMaterialActive: boolean;
  isSidebarPreviewOpen: boolean;
  isRightPanelOpen: boolean;
  isMobile: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  onCloseSearch: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function TopBar({ settings, onOpenSettings, onToggleSidebar, sidebarToggleRef, onSidebarPreviewEnter, onSidebarPreviewLeave, onToggleRightPanel, isSidebarOpen, isSidebarMaterialActive, isSidebarPreviewOpen, isRightPanelOpen, isMobile, searchQuery, onSearchChange, isSearchOpen, onToggleSearch, onCloseSearch, searchInputRef }: TopBarProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const isSidebarVisible = isSidebarOpen || isSidebarPreviewOpen;
  const titlebarBaseColor = isDark ? '#2D2D2B' : '#F9F9F7';
  // Accent coral is the active-state color everywhere else, but on the dark
  // charcoal titlebar it reads as too loud right next to the traffic lights —
  // use a bright neutral instead so "open" still reads as brighter-than-idle.
  const activeToggleClass = isDark ? 'text-[#F9F9F7]' : 'text-[#CC7D5E]';
  return (
    <div
      data-translucent-sidebar-titlebar={isSidebarMaterialActive ? 'true' : undefined}
      className={`h-8 grid items-center shrink-0 font-redaction relative after:absolute after:right-0 after:bottom-0 after:h-px ${!isMobile && isSidebarVisible ? 'after:left-[var(--noa-sidebar-width,325px)]' : 'after:left-0'} ${isMobile ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-3'} ${isDark ? 'after:bg-[#F9F9F7]/15' : 'after:bg-[#E6E2DA]'}`}
      style={{
        ...dragRegion,
        backgroundColor: titlebarBaseColor,
      }}
    >
      {/* Left Section: Traffic lights space + icon + title */}
      <div className={`flex min-w-0 items-center justify-start ${isMobile ? 'pl-2 pr-1' : 'pl-[82.5px] pr-4'}`}>
        <div className={`relative z-50 flex min-w-0 items-center gap-0.5 ${isMobile ? 'w-full' : ''}`} style={noDragRegion}>
          <button
            ref={sidebarToggleRef}
            onClick={onToggleSidebar}
            onMouseEnter={onSidebarPreviewEnter}
            onMouseLeave={onSidebarPreviewLeave}
            className={`p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer ${isSidebarOpen ? activeToggleClass : ''}`}
            title="Toggle Sidebar"
            aria-label="Toggle sidebar"
            aria-pressed={isSidebarOpen}
          >
            <PanelLeft size={16} />
          </button>
          <div
            className={`flex h-7 min-w-7 items-center overflow-hidden rounded-md border transition-[width] duration-200 ${isMobile && isSearchOpen ? 'flex-1' : ''}`}
            style={{
              width: isSearchOpen
                ? (isMobile ? 'auto' : 'max(1.75rem, min(11rem, calc(100vw - 12rem)))')
                : '1.75rem',
              backgroundColor: isSearchOpen ? 'var(--bg-primary, #F9F9F7)' : 'transparent',
              borderColor: isSearchOpen ? 'var(--divider-subtle, #E6E2DA)' : 'transparent',
            }}
          >
            <button
              onMouseDown={(event) => {
                if (isSearchOpen) event.preventDefault();
              }}
              onClick={onToggleSearch}
              className="flex h-7 w-7 shrink-0 items-center justify-center text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
              title="Search notes"
              aria-label="Search notes"
              aria-pressed={isSearchOpen}
            >
              <Search size={16} />
            </button>
            {isSearchOpen && (
              <>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  placeholder="Search notes, tags..."
                  aria-label="Search notes"
                  className="noa-titlebar-search-input h-5 min-w-0 flex-1 bg-transparent pr-1.5 text-xs font-redaction"
                  onChange={(event) => onSearchChange(event.target.value)}
                  onBlur={onCloseSearch}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      onSearchChange('');
                      onCloseSearch();
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSearchChange('')}
                    className="ml-1 shrink-0 rounded p-0.5 text-[#2D2D2B]/40 hover:text-[#CC7D5E] active:opacity-70"
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {!isMobile && <div aria-hidden="true" className="min-w-0" />}

      {/* Portal target for the right panel's tab strip — RightPanel fills this
          while it is open on desktop, so the tabs share the titlebar row
          instead of stacking a second band of chrome beneath it. Anchored to
          the panel's own left edge (not the grid column) so the strip reads as
          belonging to the panel it controls. */}
      <div
        id={TITLEBAR_PANEL_TABS_SLOT_ID}
        className="absolute inset-y-0 z-20 flex items-center pl-1"
        style={{
          ...noDragRegion,
          left: 'calc(100% - var(--noa-right-panel-width, 310px))',
          // Travel with the panel on collapse instead of popping out: same
          // distance, same curve. Opacity clears well before the strip reaches
          // the actions on the right, so the two never visibly overlap.
          transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(var(--noa-right-panel-width, 310px))',
          opacity: isRightPanelOpen ? 1 : 0,
          // visibility (not just opacity) keeps the hidden tabs out of the tab
          // order and the a11y tree; it flips only after the slide finishes.
          visibility: isRightPanelOpen ? 'visible' : 'hidden',
          transition: isRightPanelOpen
            ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease-out 60ms, visibility 0s'
            : 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease-out, visibility 0s linear 220ms',
        }}
      />

      {/* Right Section: Actions */}
      <div className="flex items-center justify-end pr-3">
        <div className="relative z-30 flex items-center gap-1" style={noDragRegion}>
          <button
            onClick={onOpenSettings}
            className="p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={onToggleRightPanel}
            className={`p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer ${isRightPanelOpen ? activeToggleClass : ''}`}
            title="Toggle Panel"
            aria-label="Toggle right panel"
            aria-pressed={isRightPanelOpen}
          >
            <PanelRight size={16} className="scale-x-[-1]" />
          </button>
        </div>
      </div>
    </div>
  );
}
