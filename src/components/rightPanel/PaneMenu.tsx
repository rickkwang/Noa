import React, { useEffect, useRef, useState } from 'react';
import { RIGHT_TAB_LABELS, type PaneBadges, type RightTab } from '../../constants/rightTabs';
import { Check, CheckSquare, MoreHorizontal, Network, PanelRight, SlidersHorizontal } from '@/src/lib/icons';

// Backlinks: single link with a bold arrow pointing IN (incoming links)
function BacklinksIcon({ size = 14, stroke = 2, className = '' }: { size?: number; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 8.5l1-1a4 4 0 0 1 5.66 5.66l-2.83 2.83a4 4 0 0 1-5.66 0" />
      <path d="M12 16l-8-8" />
      <path d="M4 13v-5h5" />
    </svg>
  );
}

// Outgoing: single link with a bold arrow pointing OUT (outgoing links)
function OutgoingIcon({ size = 14, stroke = 2, className = '' }: { size?: number; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 15.5l-1 1a4 4 0 0 1-5.66-5.66l2.83-2.83a4 4 0 0 1 5.66 0" />
      <path d="M12 8l8 8" />
      <path d="M20 11v5h-5" />
    </svg>
  );
}

// Kept here, not in PaneTabs, so the phone drawer's strip stays out of the entry chunk.
// Display order (not RIGHT_TABS order, which is the persisted enum).
export const PANE_TABS = [
  { id: 'backlinks', icon: BacklinksIcon },
  { id: 'outgoing', icon: OutgoingIcon },
  { id: 'graph', icon: Network },
  { id: 'tasks', icon: CheckSquare },
  { id: 'properties', icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{ id: RightTab; icon: React.ComponentType<{ size?: number; stroke?: number; className?: string }> }>;

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
 * The titlebar's one control for the right column: a "more" button opening a checklist of its cards,
 * with the whole-column switch as the last row.
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

  const muted = isDark ? 'text-[rgba(249,249,247,0.5)]' : 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_50%,transparent)]';
  const rowClass = `flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-body transition-colors ${
    isDark
      ? 'text-[rgba(249,249,247,0.9)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]'
      : 'text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_90%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]'
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
        // The wash holds while open, so the button reads as the thing the list hangs from.
        className={`${triggerClassName} flex h-6 w-6 items-center justify-center rounded-md ${
          isOpen
            ? (isDark ? 'bg-[rgba(249,249,247,0.10)]' : 'bg-[#2D2D2B]/[0.07]')
            : (isDark ? 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]')
        }`}
      >
        {/* The app's one "more" glyph, turned upright. */}
        <MoreHorizontal size={16} className="rotate-90" />
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Panels"
          className={`noa-pane-menu noa-floating-panel absolute right-0 top-full z-50 mt-1.5 w-48 rounded-panel p-1 font-ui ${isDark ? 'bg-[var(--bg-primary)]' : 'bg-[var(--surface-page,#F9F9F7)]'}`}
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
                <tab.icon size={15} className={`shrink-0 ${muted}`} stroke={1.75} />
                <span className="mr-auto truncate">{RIGHT_TAB_LABELS[tab.id]}</span>
                {badge > 0 && (
                  <span aria-hidden="true" className={`text-caption tabular-nums ${muted}`}>{badge > 99 ? '99+' : badge}</span>
                )}
                {/* Always in the row so the counts line up whether or not the
                    card is open. */}
                <Check size={14} className={`shrink-0 text-[var(--accent-color,#CC7D5E)] ${isActive ? '' : 'invisible'}`} />
              </button>
            );
          })}
          <div aria-hidden="true" className="mx-1 my-1 h-[0.5px] bg-[var(--divider-subtle)]" />
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
