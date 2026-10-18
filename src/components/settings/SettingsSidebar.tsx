import React, { useMemo, useState } from 'react';
import { SETTINGS_TAB_IDS, SettingsIndexEntry, SettingsTab, searchSettings } from './settingsIndex';
import { Palette, PenTool, HardDrive, Database, Info, Search, SlidersHorizontal } from '@/src/lib/icons';

// Record, not a literal array: TypeScript then requires an entry for every id
// in SETTINGS_TAB_IDS, so a tab added to the index cannot go unrendered here.
const TAB_META: Record<SettingsTab, { label: string; icon: typeof Palette }> = {
  general: { label: 'General', icon: SlidersHorizontal },
  notes: { label: 'Notes', icon: PenTool },
  appearance: { label: 'Appearance', icon: Palette },
  workspace: { label: 'Workspace', icon: HardDrive },
  data: { label: 'Data', icon: Database },
  about: { label: 'About', icon: Info },
};

export const SETTINGS_TABS = SETTINGS_TAB_IDS.map((id) => ({ id, ...TAB_META[id] }));

// Two groups: app preferences, then what lives on this computer.
// Tab order stays SETTINGS_TABS order, which the arrow-key handling depends on.
const SETTINGS_TAB_GROUPS: { label: string; tabs: SettingsTab[] }[] = [
  { label: 'Settings', tabs: ['general', 'notes', 'appearance'] },
  { label: 'This computer', tabs: ['workspace', 'data', 'about'] },
];

export type { SettingsTab };

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
  onRevealSetting: (entry: SettingsIndexEntry) => void;
}

export default function SettingsSidebar({ activeTab, setActiveTab, onRevealSetting }: SettingsSidebarProps) {
  const [query, setQuery] = useState('');

  // Searching replaces the tab list with matching settings. Tab labels alone
  // were not much use: a person looking for line height does not know it lives
  // under Appearance, which is exactly what the search should answer.
  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;

  const focusTab = (tab: SettingsTab) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${tab}`)?.focus();
    });
  };

  const activateTabAt = (index: number) => {
    const nextTab = SETTINGS_TABS[(index + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    setActiveTab(nextTab.id);
    focusTab(nextTab.id);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      activateTabAt(index + 1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      activateTabAt(index - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      activateTabAt(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      activateTabAt(SETTINGS_TABS.length - 1);
    }
  };

  const reveal = (entry: SettingsIndexEntry) => {
    onRevealSetting(entry);
    setQuery('');
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter takes the first result. Escape clears a non-empty query and stops
    // there; on an empty field it is left to bubble so the dialog's own handler
    // closes it, which is the second press.
    if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      reveal(results[0]);
      return;
    }
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  };

  return (
    // Same plane step the app shell uses: the settings sidebar sits on
    // --bg-sidebar, one notch under the content pane's --bg-primary, so the
    // two columns read as different surfaces without a heavier divider.
    <div className="w-full border-b border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_2%,var(--bg-primary,#FCFCFB))] shrink-0 md:w-48 md:border-b-0 md:border-r md:overflow-y-auto">
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--settings-text-muted)]"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            aria-label="Search settings"
            className="noa-settings-field h-8 w-full rounded-lg pl-9 pr-2.5 text-sm outline-none transition-shadow placeholder:text-[var(--settings-text-muted)] [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
      </div>

      {searching ? (
        <div className="flex flex-col gap-px px-3 pb-3" role="group" aria-label="Search results">
          {results.map((entry) => (
            <button
              key={`${entry.tab}-${entry.label}`}
              type="button"
              onClick={() => reveal(entry)}
              className="rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--settings-fill-hover)]"
            >
              <span className="block text-sm leading-5">{entry.label}</span>
              <span className="block text-caption text-[var(--settings-text-muted)] leading-snug">{TAB_META[entry.tab].label} · {entry.section}</span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="noa-hint-in px-2 py-2 text-sm text-[var(--settings-text-muted)]">No matching setting</p>
          )}
        </div>
      ) : (
        <div className="flex min-w-max flex-row gap-px overflow-x-auto px-3 pb-3 md:min-w-0 md:flex-col md:overflow-x-visible">
          {SETTINGS_TAB_GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="flex flex-row gap-px md:flex-col">
              <div aria-hidden="true" className="hidden px-2 pb-1 pt-2.5 text-xs leading-4 text-[var(--settings-text-muted)] md:block">{group.label}</div>
              <div role="tablist" className="flex flex-row gap-px md:flex-col">
                {group.tabs.map((tabId) => {
                  const index = SETTINGS_TABS.findIndex((t) => t.id === tabId);
                  const tab = SETTINGS_TABS[index];
                  return (
                    <button
                      key={tab.id}
                      id={`settings-tab-${tab.id}`}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      onKeyDown={(event) => handleTabKeyDown(event, index)}
                      role="tab"
                      aria-controls={`settings-panel-${tab.id}`}
                      aria-selected={activeTab === tab.id}
                      tabIndex={activeTab === tab.id ? 0 : -1}
                      // The surface alone carries the selection now — weight used to
                      // flip bold/medium with it, and switching tabs meant every
                      // label's glyphs visibly thickened or thinned at the same
                      // instant the background changed, reading as a flicker rather
                      // than a state change. One weight for both states removes that;
                      // the background fill and shadow are enough hierarchy on their
                      // own without needing text to change shape.
                      // No active:opacity press-fade either: it dims the label and
                      // icon for the mousedown-to-mouseup gap, right before the
                      // background swap lands, so the two changes stacked into the
                      // same "fade then flicker" this was meant to fix. The
                      // background fill already answers "did my click register".
                      className={`flex h-8 min-w-[9.5rem] items-center space-x-2.5 px-2 rounded-lg text-left transition-colors text-sm md:min-w-0 md:w-full ${
                        activeTab === tab.id
                          ? 'bg-[var(--settings-fill-active)] text-[var(--text-primary)]'
                          : 'text-[var(--settings-text-secondary)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <tab.icon size={16} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
