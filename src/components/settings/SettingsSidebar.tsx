import React from 'react';
import { Palette, PenTool, Database, Info, Link, Calendar, Search, Puzzle, Settings2 } from 'lucide-react';

export type SettingsTab = 'editor' | 'appearance' | 'data' | 'about';

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

export default function SettingsSidebar({ activeTab, setActiveTab }: SettingsSidebarProps) {
  const tabs = [
    { id: 'editor', label: 'Editor', icon: PenTool },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'about', label: 'About', icon: Info },
  ] as const;

  return (
    <div className="w-56 border-r-2 border-[#2D2D2D] bg-[#EAE8E0] py-4 flex flex-col gap-1 shrink-0 overflow-y-auto">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as SettingsTab)}
          className={`flex items-center space-x-3 px-4 py-2 text-left w-full border-y-2 font-bold transition-colors active:opacity-70 text-sm ${
            activeTab === tab.id 
              ? 'bg-[#DCD9CE] border-[#2D2D2D] shadow-[inset_4px_0px_0px_0px_#B89B5E]' 
              : 'border-transparent hover:bg-[#DCD9CE]/50'
          }`}
        >
          <tab.icon size={16} />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
