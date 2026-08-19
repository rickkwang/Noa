import React from 'react';
import { AppSettings } from '../../../types';
import FontPicker from '../FontPicker';
import SegmentedControl from '../SegmentedControl';
import SettingItem from '../SettingItem';
import SettingSection from '../SettingSection';
import SettingsToggle from '../SettingsToggle';
import { Monitor, Moon, Sun } from '@/src/lib/icons';

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export default function AppearanceSettings({ settings, updateSettings }: AppearanceSettingsProps) {
  return (
    <div className="space-y-8">
      <SettingSection title="Theme" description="Change how Noa looks.">
        <SettingItem label="Base Theme" description="Choose between light, dark, or sync with system.">
          <SegmentedControl
            ariaLabel="Base theme"
            value={settings.appearance.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, theme } }))}
          />
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

      <SettingSection title="Reading" description="Line width, spacing, and other on-page reading settings.">
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
