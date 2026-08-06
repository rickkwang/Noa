import React from 'react';
import { AppSettings } from '../../../types';
import FontPicker from '../FontPicker';
import SettingItem from '../SettingItem';
import SettingSection from '../SettingSection';
import SettingsToggle from '../SettingsToggle';
import { ChevronDown } from '@/src/lib/icons';

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}

export default function AppearanceSettings({ settings, updateSettings }: AppearanceSettingsProps) {
  return (
    <div className="space-y-8">
      <SettingSection title="Theme" description="Change how Noa looks.">
        <SettingItem label="Base Theme" description="Choose between light, dark, or sync with system.">
          <div className="relative inline-block">
            <select
              value={settings.appearance.theme}
              aria-label="Base theme"
              onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, theme: e.target.value as 'light' | 'dark' | 'system' } }))}
              className="appearance-none bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] pl-3 pr-9 py-1.5 text-sm font-medium outline-none focus:border-[#CC7D5E]"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2D2D2B]/70" />
          </div>
        </SettingItem>
        <SettingItem label="Translucent sidebar" description="Give the expanded desktop sidebar a softly frosted surface.">
          <SettingsToggle
            checked={settings.appearance.translucentSidebar}
            label="Translucent sidebar"
            onChange={(checked) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, translucentSidebar: checked },
            }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Typography" description="Customize fonts and text sizing.">
        <SettingItem
          label="Font Family"
          description="Any font installed on this device. Keep System Default to follow your OS."
          stacked
        >
          <FontPicker
            value={settings.appearance.fontFamily}
            onChange={(fontFamily) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, fontFamily },
            }))}
          />
        </SettingItem>
        <SettingItem label="Font Size" description="Base font size for the editor.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[#2D2D2B]/70">{settings.editor.fontSize}px</span>
            <input
              type="range"
              min="10"
              max="24"
              value={settings.editor.fontSize}
              aria-label="Font size"
              onChange={(e) => updateSettings(s => ({ ...s, editor: { ...s.editor, fontSize: parseInt(e.target.value, 10) } }))}
              className="w-32 accent-[#CC7D5E]"
            />
          </div>
        </SettingItem>
        <SettingItem label="Line Height" description="Spacing between lines of text.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[#2D2D2B]/70">{settings.editor.lineHeight}</span>
            <input
              type="range"
              min="1.2"
              max="2.5"
              step="0.1"
              value={settings.editor.lineHeight}
              aria-label="Line height"
              onChange={(e) => updateSettings(s => ({ ...s, editor: { ...s.editor, lineHeight: parseFloat(e.target.value) } }))}
              className="w-32 accent-[#CC7D5E]"
            />
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection title="Editor Style" description="Adjust the reading and writing experience.">
        <SettingItem label="Max Width" description="Maximum width of the editor content area.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[#2D2D2B]/70">{settings.appearance.maxWidth}px</span>
            <input
              type="range"
              min="600"
              max="1200"
              step="50"
              value={settings.appearance.maxWidth}
              aria-label="Maximum editor width"
              onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, maxWidth: parseInt(e.target.value, 10) } }))}
              className="w-32 accent-[#CC7D5E]"
            />
          </div>
        </SettingItem>
        <SettingItem label="Use pointer cursors" description="Change the cursor to a pointer when hovering over interactive elements.">
          <SettingsToggle
            checked={settings.appearance.usePointerCursors}
            label="Use pointer cursors"
            onChange={(checked) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, usePointerCursors: checked },
            }))}
          />
        </SettingItem>
      </SettingSection>
    </div>
  );
}
