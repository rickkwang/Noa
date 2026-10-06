import React, { CSSProperties } from 'react';
import { TITLEBAR_PANEL_TABS_SLOT_ID, type PaneBadges, type RightTab } from '../constants/rightTabs';
import { useIsDark } from '../hooks/useIsDark';
import { AppSettings } from '../types';
import { PaneMenu } from './rightPanel/PaneMenu';
import { Search, PanelLeft, PanelRight, X } from '@/src/lib/icons';

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
}

export default function TopBar({ settings, onToggleSidebar, sidebarToggleRef, onSidebarPreviewEnter, onSidebarPreviewLeave, onToggleRightPanel, activePanes, onTogglePane, paneBadges, isRightPanelCovering, isSidebarOpen, isSidebarMaterialActive, isRightPanelOpen, rightPanelEdgeTransition, isMobile, searchQuery, onSearchChange, isSearchOpen, onToggleSearch, onCloseSearch, onSearchBlur, searchInputRef }: TopBarProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const titlebarBaseColor = isDark ? '#2D2D2B' : '#FCFCFB';
  // Accent coral is the active-state color everywhere else, but on the dark
  // charcoal titlebar it reads as too loud right next to the traffic lights —
  // use a bright neutral instead so "open" still reads as brighter-than-idle.
  const activeToggleClass = isDark ? 'text-[#F9F9F7]' : 'text-[#CC7D5E]';
  const actionClass = 'p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors cursor-pointer';
  return (
    <div
      data-titlebar="true"
      data-translucent-sidebar-titlebar={isSidebarMaterialActive ? 'true' : undefined}
      className={`h-11 grid items-center shrink-0 font-redaction relative ${isMobile ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-3'}`}
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
            // No active:opacity here: the icon already recolours to
            // activeToggleClass the instant isSidebarOpen flips, and dimming
            // it for the press right before that lands is what reads as a
            // flicker, not a click.
            className={`p-1 text-[#2D2D2B]/70 hover:text-[#CC7D5E] transition-colors cursor-pointer ${isSidebarOpen ? activeToggleClass : ''}`}
            title="Toggle Sidebar"
            aria-label="Toggle sidebar"
            aria-pressed={isSidebarOpen}
          >
            <PanelLeft size={16} />
          </button>
          <div
            className={`flex h-[22px] min-w-7 items-center overflow-hidden rounded-md border transition-[width,background-color,border-color] duration-200 ease-out ${isMobile && isSearchOpen ? 'flex-1' : ''}`}
            style={{
              width: isSearchOpen
                ? (isMobile ? 'auto' : 'max(1.75rem, min(11rem, calc(100vw - 12rem)))')
                : '1.75rem',
              backgroundColor: isSearchOpen ? 'var(--bg-primary, #FCFCFB)' : 'transparent',
              borderColor: isSearchOpen ? 'var(--divider-subtle, #E6E2DA)' : 'transparent',
            }}
          >
            <button
              // The icon is 28px inside a 26px content box, so it always
              // overflows this overflow-hidden shell by 2px. Letting the button
              // take focus makes the browser scroll the shell to reveal it,
              // which visibly jerks the icon sideways mid-expand. The click
              // still lands, and the input takes focus straight after.
              onMouseDown={(event) => event.preventDefault()}
              onClick={onToggleSearch}
              className="flex h-7 w-7 shrink-0 items-center justify-center text-[#2D2D2B]/70 hover:text-[#CC7D5E] active:opacity-70 transition-colors cursor-pointer"
              title="Search notes"
              aria-label="Search notes"
              aria-pressed={isSearchOpen}
            >
              <Search size={16} />
            </button>
            {/* Kept mounted so opening and closing are the same animation
                played in reverse: unmounting on close made the text vanish
                instantly while the shell was still collapsing. */}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              placeholder="Search notes, tags..."
              aria-label="Search notes"
              aria-hidden={!isSearchOpen}
              // Only while collapsed, and never tabIndex={0}: a literal
              // tabindex attribute matches the global [tabindex]:focus-visible
              // ring and paints an accent outline inside the search shell.
              tabIndex={isSearchOpen ? undefined : -1}
              className="noa-titlebar-search-input h-5 min-w-0 flex-1 bg-transparent pr-1.5 text-xs font-redaction"
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
                className="ml-1 shrink-0 rounded p-0.5 text-[#2D2D2B]/40 hover:text-[#CC7D5E] active:opacity-70"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!isMobile && <div aria-hidden="true" className="min-w-0" />}

      {/* Right Section: Actions. The right column's cards run to the top of the
          window, over this bar, so the actions stop at the column's left edge
          and travel with it — same distance and curve as the column's own
          slide in App.tsx. On desktop they are positioned against the bar
          itself, not laid out in the grid's third cell: the column can be
          wider than that cell, and an offset larger than the cell pushed the
          button under the column instead of clear of it. */}
      <div
        className={isMobile ? 'flex items-center justify-end pr-4' : `absolute inset-y-0 flex items-center ${isRightPanelCovering ? 'z-30 has-[[role=menu]]:z-40' : 'z-40'}`}
        data-right-panel-anchor={isMobile ? undefined : 'true'}
        style={isMobile ? undefined : {
          // 15px, not a round rem: it puts the menu glyph on the same vertical
          // line as the editor toolbar's last action directly beneath it.
          right: isRightPanelOpen ? 'calc(var(--noa-right-panel-width, 340px) + 15px)' : '15px',
          transition: rightPanelEdgeTransition,
        }}
      >
        <div className="relative flex items-center gap-1" style={noDragRegion}>
          {isMobile ? (
            // The phone drawer picks its card from a strip inside the panel,
            // so here the button only has the drawer to open.
            <button
              onClick={onToggleRightPanel}
              className={`${actionClass} ${isRightPanelOpen ? activeToggleClass : ''}`}
              title="Toggle Panel"
              aria-label="Toggle right panel"
              aria-pressed={isRightPanelOpen}
            >
              <PanelRight size={16} className="scale-x-[-1]" />
            </button>
          ) : (
            <div id={TITLEBAR_PANEL_TABS_SLOT_ID} className="flex items-center">
              <PaneMenu
                activePanes={activePanes}
                onSelect={onTogglePane}
                badges={paneBadges}
                isDark={isDark}
                // Colour only, not the wash: choosing a card closes the menu
                // and moves this button to the column's new edge in the same
                // frame, and a fading background would trail behind as a
                // ghost block at the spot it jumped to.
                triggerClassName={`transition-[color] cursor-pointer ${isDark ? 'text-[rgba(249,249,247,0.7)] hover:text-[#F9F9F7]' : 'text-[#2D2D2B]/70 hover:text-[#2D2D2B]'}`}
                isPanelOpen={isRightPanelOpen}
                onTogglePanel={onToggleRightPanel}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
