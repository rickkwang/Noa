import React from 'react';
import { RIGHT_TAB_LABELS } from '../../constants/rightTabs';
import { PANE_TABS, badgeFor, type PaneSwitchProps } from './PaneMenu';

/** The phone drawer's one-of-five selector: a segmented control inside the panel. */
export function PaneTabs({ activePanes, onSelect, badges, isDark }: PaneSwitchProps) {
  return (
    <>
      {PANE_TABS.map((tab) => {
        const label = RIGHT_TAB_LABELS[tab.id];
        const isActive = activePanes.includes(tab.id);
        const badge = badgeFor(tab.id, badges);
        // The active tab is raised out of an inset track, which needs a shadow
        // to read.
        const style: React.CSSProperties = isActive
          ? {
              background: isDark ? '#3A3A37' : '#FBFAF6',
              color: isDark ? '#F9F9F7' : '#2D2D2B',
              boxShadow: isDark
                ? '0 1px 2px rgba(0,0,0,0.28), 0 0 0 1px rgba(249,249,247,0.06)'
                : '0 1px 2px rgba(45,45,43,0.1), 0 0 0 1px rgba(45,45,43,0.04)',
            }
          : { color: isDark ? 'rgba(249,249,247,0.55)' : 'rgba(45,45,43,0.55)' };
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            title={tab.id === 'outgoing' ? 'Outgoing Links' : label}
            aria-label={label}
            aria-pressed={isActive}
            // No active:opacity press-fade: switching tabs already swaps
            // background, text colour and icon stroke width all at once (below).
            // Dimming the icon for the mousedown-to-mouseup gap right before
            // that lands stacks a third change on top and reads as a flicker,
            // same as the settings sidebar's tab strip.
            className={`relative flex items-center justify-center transition-colors flex-1 h-6 rounded-md ${
              isActive
                ? ''
                : isDark ? 'hover:text-[#F9F9F7] hover:bg-[#F9F9F7]/[0.05]' : 'hover:text-[#2D2D2B] hover:bg-[#2D2D2B]/[0.05]'
            }`}
            style={style}
          >
            <tab.icon size={15} className="shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
            {badge > 0 && (
              <span
                aria-label={`${badge} pending`}
                className="absolute top-0 right-1 text-[10px] font-bold leading-none tabular-nums text-[#CC7D5E]"
              >
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

