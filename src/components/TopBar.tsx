import React, { CSSProperties, useSyncExternalStore } from 'react';
import { TITLEBAR_NOTE_ACTIONS_SLOT_ID, TITLEBAR_PANEL_TABS_SLOT_ID, type PaneBadges, type RightTab } from '../constants/rightTabs';
import { useIsDark } from '../hooks/useIsDark';
import type { NoteHistory } from '../hooks/useNoteHistory';
import { themeSurfaces } from '../lib/themePalette';
import { AppSettings } from '../types';
import { PaneMenu } from './rightPanel/PaneMenu';
import { Search, PanelLeft, PanelRight, X, LayoutList, ArrowLeft, ArrowRight } from '@/src/lib/icons';

const dragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'drag' };
const noDragRegion: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' };

interface TopBarProps {
  settings: AppSettings;
  onToggleSidebar: () => void;
  sidebarToggleRef: React.RefObject<HTMLButtonElement | null>;
  onSidebarPreviewEnter: () => void;
  onSidebarPreviewLeave: () => void;
  onToggleRightPanel: () => void;
  /** Cards currently showing in the right column; empty while it is collapsed. */
  activePanes: readonly RightTab[];
  onTogglePane: (id: RightTab) => void;
  paneBadges: PaneBadges;
  /** A card is expanded over the editor and this bar; the menu button goes
   *  under it rather than floating on top of the card. */
  isRightPanelCovering: boolean;
  isSidebarOpen: boolean;
  isSidebarMaterialActive: boolean;
  isRightPanelOpen: boolean;
  /** The Calendar and Tags rail; its toggle sits beside the panel menu. */
  isNoteRailOpen?: boolean;
  onToggleNoteRail?: () => void;
  /** Set while the right column opens or closes, so the actions ride its edge. */
  rightPanelEdgeTransition?: string;
  isMobile: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  onCloseSearch: () => void;
  onSearchBlur: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  /** The sidebar is showing its own search field, so the titlebar drops its search toggle. */
  hideSearch?: boolean;
  /** Back/forward through opened notes; omitted where the titlebar has no room for it (mobile). */
  noteHistory?: { history: NoteHistory; liveIds: ReadonlySet<string>; navigate: (dir: -1 | 1) => void };
}

// Subscribes on its own so a history step re-renders these two buttons, not the titlebar.
function HistoryButtons({ history, liveIds, navigate, buttonClass }: NonNullable<TopBarProps['noteHistory']> & { buttonClass: string }) {
  useSyncExternalStore(history.subscribe, history.getVersion);
  // aria-disabled rather than disabled: a button that disables under the keyboard drops focus to <body>.
  const className = `${buttonClass} aria-disabled:pointer-events-none aria-disabled:*:opacity-50`;
  return (
    <div className="flex items-center">
      {([[-1, 'Back', ArrowLeft], [1, 'Forward', ArrowRight]] as const).map(([dir, label, Icon]) => {
        const enabled = history.can(dir, liveIds);
        return (
          <button
            key={label}
            onClick={enabled ? () => navigate(dir) : undefined}
            className={className}
            title={label}
            aria-label={label}
            aria-disabled={!enabled || undefined}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

export default function TopBar({ settings, onToggleSidebar, sidebarToggleRef, onSidebarPreviewEnter, onSidebarPreviewLeave, onToggleRightPanel, activePanes, onTogglePane, paneBadges, isRightPanelCovering, isSidebarOpen, isSidebarMaterialActive, isRightPanelOpen, isNoteRailOpen = false, onToggleNoteRail, rightPanelEdgeTransition, isMobile, searchQuery, onSearchChange, isSearchOpen, onToggleSearch, onCloseSearch, onSearchBlur, searchInputRef, hideSearch = false, noteHistory }: TopBarProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const titlebarBaseColor = themeSurfaces(isDark).primary;
  // Titlebar buttons only answer the pointer: a 7.5% ink block on hover, never a lasting "open" fill or colour.
  const buttonClass = `flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors text-[var(--icon-ink,#52514E)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)]`;
  return (
    <div
      data-titlebar="true"
      data-translucent-sidebar-titlebar={isSidebarMaterialActive ? 'true' : undefined}
      className={`h-11 grid items-center shrink-0 font-ui relative ${isMobile ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-3'}`}
      style={{
        ...dragRegion,
        backgroundColor: titlebarBaseColor,
      }}
    >
      {/* Left Section: Traffic lights space + icon + title */}
      <div className={`flex min-w-0 items-center justify-start ${isMobile ? 'pl-2 pr-1' : 'pl-[var(--noa-titlebar-inset)] pr-4'}`}>
        <div className={`relative z-50 flex min-w-0 items-center gap-0.5 ${isMobile ? 'w-full' : ''}`} style={noDragRegion}>
          <button
            ref={sidebarToggleRef}
            onClick={onToggleSidebar}
            onMouseEnter={onSidebarPreviewEnter}
            onMouseLeave={onSidebarPreviewLeave}
            className={buttonClass}
            title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label="Toggle sidebar"
            aria-pressed={isSidebarOpen}
          >
            <PanelLeft size={16} />
          </button>
          {noteHistory && <HistoryButtons {...noteHistory} buttonClass={buttonClass} />}
          {!hideSearch && <div
            className={`flex h-[26px] min-w-7 items-center overflow-hidden rounded-md border-[0.5px] transition-[width,background-color,border-color] duration-200 ease-out ${isMobile && isSearchOpen ? 'flex-1' : ''}`}
            style={{
              width: isSearchOpen
                ? (isMobile ? 'auto' : 'max(1.75rem, min(11rem, calc(100vw - 12rem)))')
                : '1.75rem',
              backgroundColor: isSearchOpen ? 'var(--bg-primary, #FCFCFB)' : 'transparent',
              borderColor: isSearchOpen ? 'var(--divider-subtle, #E6E2DA)' : 'transparent',
            }}
          >
            <button
              // Prevent focus: the 28px icon overflows the 26px shell by 2px, and focusing it would scroll the shell and jerk the icon mid-expand.
              onMouseDown={(event) => event.preventDefault()}
              onClick={onToggleSearch}
              className="flex h-7 w-7 shrink-0 items-center justify-center text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)] hover:text-[var(--accent-color,#CC7D5E)] noa-press transition-colors cursor-pointer"
              title="Search notes"
              aria-label="Search notes"
              aria-pressed={isSearchOpen}
            >
              <Search size={16} />
            </button>
            {/* Kept mounted so open and close are the same animation reversed; unmounting made the text vanish early. */}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              placeholder="Search notes, tags..."
              aria-label="Search notes"
              aria-hidden={!isSearchOpen}
              // Only while collapsed, and never tabIndex={0}: a literal tabindex matches the global focus-visible ring and paints an outline inside the shell.
              tabIndex={isSearchOpen ? undefined : -1}
              className="noa-titlebar-search-input h-5 min-w-0 flex-1 bg-transparent pr-1.5 text-xs font-ui"
              onChange={(event) => onSearchChange(event.target.value)}
              onBlur={onSearchBlur}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onSearchChange('');
                  onCloseSearch();
                }
              }}
            />
            {isSearchOpen && searchQuery && (
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSearchChange('')}
                className="ml-1 shrink-0 rounded p-0.5 text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_40%,transparent)] hover:text-[var(--accent-color,#CC7D5E)] noa-press"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>}
        </div>
      </div>

      {!isMobile && <div aria-hidden="true" className="min-w-0" />}

      {/* Right actions stop at the column's left edge and travel with it. Positioned against the bar itself, not the grid cell, since the column can be wider than that cell.
          An expanded pane covers the note they act on, so they hide: with the sidebar closed the pane stops below the
          titlebar (App.tsx), and while the sidebar toggles its top slides between the two, either of which would leave
          them stranded mid-bar. */}
      <div
        className={isMobile ? 'flex items-center justify-end pr-4' : `absolute inset-y-0 flex items-center ${isRightPanelCovering ? 'z-30 invisible' : 'z-40'}`}
        data-right-panel-anchor={isMobile ? undefined : 'true'}
        style={isMobile ? undefined : {
          // Keep a fixed inset at the trailing edge of the actions.
          right: isRightPanelOpen ? 'calc(var(--noa-right-panel-width, 360px) + 15px)' : '15px',
          transition: rightPanelEdgeTransition,
        }}
      >
        {/* Note actions, rail toggle and panel menu share one row. */}
        <div className="relative flex items-center gap-0.5" style={noDragRegion}>
          {isMobile ? (
            // The phone drawer picks its card from a strip inside the panel,
            // so here the button only has the drawer to open.
            <button
              onClick={onToggleRightPanel}
              className={buttonClass}
              title="Toggle Panel"
              aria-label="Toggle right panel"
              aria-pressed={isRightPanelOpen}
            >
              <PanelRight size={16} className="scale-x-[-1]" />
            </button>
          ) : (
            <>
            {/* The editor portals its export and history menu here. */}
            <div id={TITLEBAR_NOTE_ACTIONS_SLOT_ID} className="flex items-center empty:hidden" />
            {onToggleNoteRail && (
              <button
                type="button"
                data-note-rail-toggle
                onClick={onToggleNoteRail}
                title={isNoteRailOpen ? 'Hide calendar and tags' : 'Show calendar and tags'}
                aria-label={isNoteRailOpen ? 'Hide calendar and tags' : 'Show calendar and tags'}
                aria-pressed={isNoteRailOpen}
                // Pressed is an ink wash under the glyph rather than a colour change, so it reads as a held toggle.
                className={`noa-press flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors ${
                  isNoteRailOpen
                    ? 'bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_15%,transparent)] text-[var(--text-primary,#2D2D2B)]'
                    : 'text-[var(--icon-ink,#52514E)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)]'
                }`}
              >
                <LayoutList size={16} />
              </button>
            )}
            <div id={TITLEBAR_PANEL_TABS_SLOT_ID} className="flex items-center">
              <PaneMenu
                activePanes={activePanes}
                onSelect={onTogglePane}
                badges={paneBadges}
                isDark={isDark}
                // Colour only, no background wash: the button jumps to the column's new edge in the same frame, and a fading wash would linger as a ghost.
                triggerClassName={`transition-[color] cursor-pointer ${isDark ? 'text-[rgba(249,249,247,0.7)] hover:text-[var(--ink-on-dark,#F9F9F7)]' : 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)] hover:text-[var(--text-primary,#2D2D2B)]'}`}
                isPanelOpen={isRightPanelOpen}
                onTogglePanel={onToggleRightPanel}
              />
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
