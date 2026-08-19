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
    <div className="w-full border-b border-[var(--divider-subtle)] bg-[var(--bg-sidebar,#F4F4F2)] shrink-0 md:w-48 md:border-b-0 md:border-r md:overflow-y-auto">
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            aria-label="Search settings"
            className="w-full rounded-[3px] border border-[var(--divider-subtle)] bg-[var(--bg-primary,#F9F9F7)] py-1.5 pl-9 pr-2.5 text-sm outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--border-strong)] [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
      </div>

      {searching ? (
        <div className="flex flex-col gap-0.5 px-2 pb-2 pt-0.5" role="group" aria-label="Search results">
          {results.map((entry) => (
            <button
              key={`${entry.tab}-${entry.label}`}
              type="button"
              onClick={() => reveal(entry)}
              className="rounded-[3px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#EFEAE3]"
            >
              <span className="block text-sm font-medium leading-snug">{entry.label}</span>
              <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">{entry.section}</span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-[var(--text-secondary)]">No matching setting</p>
          )}
        </div>
      ) : (
        <div
          className="flex min-w-max flex-row gap-0.5 overflow-x-auto px-2 pb-2 pt-0.5 md:min-w-0 md:flex-col md:overflow-x-visible"
          role="tablist"
        >
          {SETTINGS_TABS.map((tab, index) => (
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
              // Weight carries the selection alongside the surface: the active
              // tab is the only bold row, so the list reads as a hierarchy
              // rather than a stack of equally-loud labels.
              className={`flex min-w-[9.5rem] items-center space-x-2.5 px-2.5 py-2 rounded-[3px] text-left transition-colors active:opacity-70 text-sm md:min-w-0 md:w-full ${
                activeTab === tab.id
                  ? 'font-bold bg-[#EFEAE3] shadow-[0_1px_2px_rgba(45,45,43,0.12)]'
                  : 'font-medium hover:bg-[#EFEAE3]/50'
              }`}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
