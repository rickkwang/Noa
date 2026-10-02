import React, { useEffect, useRef, useState } from 'react';
import { RIGHT_TAB_LABELS, type PaneBadges, type RightTab } from '../../constants/rightTabs';
import { Check, CheckSquare, MoreHorizontal, Network, PanelRight, SlidersHorizontal } from '@/src/lib/icons';

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

// Kept in this file, not PaneTabs: the titlebar menu is in the entry chunk and
// the phone drawer's strip is not, so the strip imports the list from here and
// stays out of the entry budget.
// Display order of the cards' switches. Not RIGHT_TABS order: that one is the
// persisted enum, this one is what the eye reads left to right.
export const PANE_TABS = [
  { id: 'backlinks', icon: BacklinksIcon },
  { id: 'outgoing', icon: OutgoingIcon },
  { id: 'graph', icon: Network },
  { id: 'tasks', icon: CheckSquare },
  { id: 'properties', icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{ id: RightTab; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }>;

export function badgeFor(id: RightTab, badges: PaneBadges): number {
  return id === 'backlinks' || id === 'outgoing' || id === 'tasks' ? badges[id] : 0;
}

export interface PaneSwitchProps {
  activePanes: readonly RightTab[];
  onSelect: (id: RightTab) => void;
  badges: PaneBadges;
  isDark: boolean;
}

interface PaneMenuProps extends PaneSwitchProps {
  /** Classes for the trigger, so it matches its neighbours in the titlebar. */
  triggerClassName: string;
  /** Whether the right column is showing. */
  isPanelOpen: boolean;
  /** Collapse the whole column, or bring back the cards it last held. */
  onTogglePanel: () => void;
}

/**
 * The titlebar's one control for the right column: a "more" button opening a
 * checklist of its cards, with the whole-column switch as the last row. One
 * button instead of a toggle plus a menu — both were ways into the same
 * column — and a list has room for names, which bare icons never did.
 */
export function PaneMenu({ activePanes, onSelect, badges, isDark, triggerClassName, isPanelOpen, onTogglePanel }: PaneMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[#2D2D2B]/50';
  const rowClass = `flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors ${
    isDark
      ? 'text-[rgba(249,249,247,0.9)] hover:bg-[rgba(249,249,247,0.07)]'
      : 'text-[#2D2D2B]/90 hover:bg-[#2D2D2B]/[0.05]'
  }`;
  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((open) => !open)}
        title="Panels"
        aria-label="Panels"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-panel-open={isPanelOpen}
        // The wash holds while the menu is open, so the button reads as the
        // thing the list hangs from.
        className={`${triggerClassName} flex h-6 w-6 items-center justify-center rounded-md ${
          isOpen
            ? (isDark ? 'bg-[rgba(249,249,247,0.10)]' : 'bg-[#2D2D2B]/[0.07]')
            : (isDark ? 'hover:bg-[rgba(249,249,247,0.07)]' : 'hover:bg-[#2D2D2B]/[0.05]')
        }`}
      >
        {/* The app's one "more" glyph, turned upright. */}
        <MoreHorizontal size={16} className="rotate-90" />
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Panels"
          className={`noa-pane-menu noa-floating-panel absolute right-0 top-full z-50 mt-1.5 w-48 rounded-[10px] border border-[var(--divider-subtle)] p-1 font-redaction ${isDark ? 'bg-[#2D2D2B]' : 'bg-[#F9F9F7]'}`}
        >
          {PANE_TABS.map((tab) => {
            const isActive = activePanes.includes(tab.id);
            const badge = badgeFor(tab.id, badges);
            return (
              <button
                key={tab.id}
                role="menuitemcheckbox"
                aria-checked={isActive}
                aria-label={RIGHT_TAB_LABELS[tab.id]}
                onClick={() => {
                  onSelect(tab.id);
                  setIsOpen(false);
                }}
                className={rowClass}
              >
                <tab.icon size={15} className={`shrink-0 ${muted}`} strokeWidth={1.75} />
                <span className="mr-auto truncate">{RIGHT_TAB_LABELS[tab.id]}</span>
                {badge > 0 && (
                  <span aria-hidden="true" className={`text-[11px] tabular-nums ${muted}`}>{badge > 99 ? '99+' : badge}</span>
                )}
                {/* Always in the row so the counts line up whether or not the
                    card is open. */}
                <Check size={14} className={`shrink-0 text-[var(--accent-color,#CC7D5E)] ${isActive ? '' : 'invisible'}`} />
              </button>
            );
          })}
          <div aria-hidden="true" className="mx-1 my-1 h-px bg-[var(--divider-subtle)]" />
          <button
            role="menuitem"
            aria-label="Toggle right panel"
            onClick={() => {
              onTogglePanel();
              setIsOpen(false);
            }}
            className={rowClass}
          >
            <PanelRight size={15} className={`shrink-0 scale-x-[-1] ${muted}`} />
            <span className="mr-auto truncate">{isPanelOpen ? 'Hide panels' : 'Show panels'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
