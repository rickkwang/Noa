import React from 'react';
import { resolveFontFamily } from '../../../lib/fontFamily';
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

const SCENE_OPTIONS = [
  { value: 'island', label: 'Island' },
  { value: 'desk', label: 'Desk' },
] as const;

// Steps that read as distinct sizes; 16 is the default. A saved size off this list (older builds allowed any
// 10–24) is shown as its own segment, so it stays visible and re-selectable instead of silently matching nothing.
const FONT_SIZE_PRESETS = [12, 13, 14, 15, 16, 17];

const rangeFill = (value: number, min: number, max: number) =>
  ({ '--noa-range-fill': `${((value - min) / (max - min)) * 100}%` }) as React.CSSProperties;

export default function AppearanceSettings({ settings, updateSettings }: AppearanceSettingsProps) {
  return (
    <div className="space-y-10">
      <SettingSection title="Theme">
        <SettingItem label="Base Theme" description="Choose between light, dark, or sync with system.">
          <SegmentedControl
            ariaLabel="Base theme"
            value={settings.appearance.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, theme } }))}
          />
        </SettingItem>
        <SettingItem label="Translucent Sidebar" description="Applies to the expanded sidebar in the desktop app.">
          <SettingsToggle
            checked={settings.appearance.translucentSidebar}
            label="Translucent Sidebar"
            onChange={(checked) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, translucentSidebar: checked },
            }))}
          />
        </SettingItem>
        <SettingItem label="Empty Page Scene" description="Shown when no note is open. It grows as you write.">
          <SegmentedControl
            ariaLabel="Empty page scene"
            value={settings.appearance.emptyStateScene}
            options={SCENE_OPTIONS}
            onChange={(emptyStateScene) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, emptyStateScene },
            }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Typography">
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
          <SegmentedControl
            ariaLabel="Font size"
            value={String(settings.editor.fontSize)}
            options={[...new Set([...FONT_SIZE_PRESETS, settings.editor.fontSize])].sort((a, b) => a - b).map((size) => ({ value: String(size), label: String(size) }))}
            onChange={(value) => updateSettings(s => ({ ...s, editor: { ...s.editor, fontSize: Number(value) } }))}
          />
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
              aria-valuetext={String(settings.editor.lineHeight)}
              onChange={(e) => updateSettings(s => ({ ...s, editor: { ...s.editor, lineHeight: parseFloat(e.target.value) } }))}
              className="noa-range w-32"
              style={rangeFill(settings.editor.lineHeight, 1.2, 2.5)}
            />
          </div>
        </SettingItem>
        {/* The editor's text at the chosen family, size and line height, so they're judged on text, not numbers. */}
        <div
          aria-hidden="true"
          className="rounded-panel border-[0.5px] border-[var(--divider-subtle)] px-4 py-3 text-[var(--text-primary,#2D2D2B)] transition-[font-size,line-height] duration-200 ease-(--ease-out) motion-reduce:transition-none"
          style={{ fontSize: settings.editor.fontSize, lineHeight: settings.editor.lineHeight, fontFamily: resolveFontFamily(settings.appearance.fontFamily) }}
        >
          Notes that link to each other slowly become a map of what you know.
          <br />
          彼此链接的笔记，会慢慢长成你知识的地图。
        </div>
      </SettingSection>

      <SettingSection title="Reading">
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
              aria-valuetext={`${settings.appearance.maxWidth}px`}
              onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, maxWidth: parseInt(e.target.value, 10) } }))}
              className="noa-range w-32"
              style={rangeFill(settings.appearance.maxWidth, 600, 1200)}
            />
          </div>
        </SettingItem>
        <SettingItem label="Use Pointer Cursors" description="Change the cursor to a pointer when hovering over interactive elements.">
          <SettingsToggle
            checked={settings.appearance.usePointerCursors}
            label="Use Pointer Cursors"
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
