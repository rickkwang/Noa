import React from 'react';
import { Palette, PenTool, Database, Info, Download } from 'lucide-react';

export type SettingsTab = 'editor' | 'appearance' | 'data' | 'updates' | 'about';

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

export default function SettingsSidebar({ activeTab, setActiveTab }: SettingsSidebarProps) {
  const tabs = [
    { id: 'editor', label: 'Editor', icon: PenTool },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'updates', label: 'App Update', icon: Download },
    { id: 'about', label: 'About', icon: Info },
  ] as const;

  return (
    <div className="w-56 border-r-2 border-[#2D2D2D] bg-[#EAE8E0] flex flex-col shrink-0 overflow-y-auto">
      <div className="flex flex-col divide-y divide-[#2D2D2D] border-b border-[#2D2D2D]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as SettingsTab)}
            className={`flex items-center space-x-3 px-4 py-2.5 text-left w-full font-bold transition-colors active:opacity-70 text-sm ${
              activeTab === tab.id
                ? 'bg-[#DCD9CE] shadow-[inset_4px_0px_0px_0px_#B89B5E]'
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
