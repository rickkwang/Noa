import React from 'react';
import { Palette, PenTool, Database, Info, Download } from '@/src/lib/icons';

export const SETTINGS_TABS = [
  { id: 'editor', label: 'Editor', icon: PenTool },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'updates', label: 'App Update', icon: Download },
  { id: 'about', label: 'About', icon: Info },
] as const;

export type SettingsTab = typeof SETTINGS_TABS[number]['id'];

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

export default function SettingsSidebar({ activeTab, setActiveTab }: SettingsSidebarProps) {
  const activateTabAt = (index: number) => {
    const nextTab = SETTINGS_TABS[(index + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    setActiveTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`settings-tab-${nextTab.id}`)?.focus();
    });
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

  return (
    <div className="w-full border-b-2 border-[#2D2D2D] bg-[#EAE8E0] shrink-0 overflow-x-auto md:w-56 md:border-b-0 md:border-r-2 md:overflow-y-auto">
      <div
        className="flex min-w-max flex-row divide-x divide-[#2D2D2D] md:min-w-0 md:flex-col md:divide-x-0 md:divide-y md:border-b md:border-[#2D2D2D]"
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
            className={`flex min-w-[9.5rem] items-center space-x-3 px-4 py-2.5 text-left font-bold transition-colors active:opacity-70 text-sm md:w-full md:min-w-0 ${
              activeTab === tab.id
                ? 'bg-[#DCD9CE] shadow-[inset_0px_-4px_0px_0px_#B89B5E] md:shadow-[inset_4px_0px_0px_0px_#B89B5E]'
                : 'hover:bg-[#DCD9CE]/50'
            }`}
          >
            <tab.icon size={16} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
