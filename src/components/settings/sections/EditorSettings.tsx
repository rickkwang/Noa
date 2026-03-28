import React from 'react';
import { AppSettings } from '../../../types';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';

interface EditorSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  editorViewMode: 'edit' | 'preview' | 'split';
  setEditorViewMode: (mode: 'edit' | 'preview' | 'split') => void;
}

const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!value)}
    className={`w-12 h-6 border-2 border-[#2D2D2D] relative transition-colors ${value ? 'bg-[#B89B5E]' : 'bg-[#EAE8E0]'}`}
  >
    <div className={`absolute top-0.5 w-4 h-4 bg-[#EAE8E0] border-2 border-[#2D2D2D] transition-transform ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
  </button>
);

export default function EditorSettings({ settings, updateSettings, editorViewMode, setEditorViewMode }: EditorSettingsProps) {
  return (
    <div className="space-y-8">
      <SettingSection title="General" description="Configure your writing experience.">
        <SettingItem label="Default View Mode" description="Choose how the editor opens by default.">
          <div className="flex space-x-2">
            {(['edit', 'split', 'preview'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setEditorViewMode(mode)}
                className={`px-3 py-1.5 font-bold border-2 border-[#2D2D2D] text-sm capitalize transition-all ${
                  editorViewMode === mode
                    ? 'bg-[#B89B5E] text-white shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.2)]'
                    : 'bg-[#EAE8E0] text-[#2D2D2D]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection title="Daily Notes" description="Configure automatic daily note creation.">
        <SettingItem label="Date Format" description="Format for the daily note title. Uses YYYY MM DD HH mm tokens.">
          <input
            type="text"
            value={settings.dailyNotes.dateFormat}
            onChange={(e) => updateSettings(s => ({ ...s, dailyNotes: { ...s.dailyNotes, dateFormat: e.target.value } }))}
            placeholder="YYYY-MM-DD"
            className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm w-40 shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:border-[#B89B5E]"
          />
        </SettingItem>
        <SettingItem label="Template" description="Content pre-filled in each new daily note. Leave blank to use the default template. Supports {{date}} placeholder.">
          <textarea
            value={settings.dailyNotes.template}
            onChange={(e) => updateSettings(s => ({ ...s, dailyNotes: { ...s.dailyNotes, template: e.target.value } }))}
            placeholder={"# {{date}}\n\n## Notes\n\n"}
            rows={5}
            className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-2 text-sm w-full font-redaction shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:border-[#B89B5E] resize-none"
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Search" description="Control how notes are searched.">
        <SettingItem label="Fuzzy Search" description="Match approximate spellings and partial words. Disable for exact-only matching.">
          <Toggle
            value={settings.search.fuzzySearch}
            onChange={(v) => updateSettings(s => ({ ...s, search: { ...s.search, fuzzySearch: v } }))}
          />
        </SettingItem>
        <SettingItem label="Case Sensitive" description="Match uppercase and lowercase characters exactly.">
          <Toggle
            value={settings.search.caseSensitive}
            onChange={(v) => updateSettings(s => ({ ...s, search: { ...s.search, caseSensitive: v } }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Core Plugins" description="Enable or disable optional features.">
        <SettingItem label="Graph View" description="Show the knowledge graph button in the toolbar.">
          <Toggle
            value={settings.corePlugins.graphView}
            onChange={(v) => updateSettings(s => ({ ...s, corePlugins: { ...s.corePlugins, graphView: v } }))}
          />
        </SettingItem>
        <SettingItem label="Daily Notes" description="Show the daily note button in the toolbar.">
          <Toggle
            value={settings.corePlugins.dailyNotes}
            onChange={(v) => updateSettings(s => ({ ...s, corePlugins: { ...s.corePlugins, dailyNotes: v } }))}
          />
        </SettingItem>
      </SettingSection>
    </div>
  );
}
