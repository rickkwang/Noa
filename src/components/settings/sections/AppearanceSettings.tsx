import React, { useEffect, useState } from 'react';
import { UI_FONT_STYLES, resolveFontFamily } from '../../../lib/fontFamily';
import { AppSettings } from '../../../types';
import FontPicker from '../FontPicker';
import SegmentedControl from '../SegmentedControl';
import SettingsSelect from '../SettingsSelect';
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

const UI_FONT_STYLE_OPTIONS = Object.entries(UI_FONT_STYLES).map(([value, style]) => ({
  value: value as AppSettings['appearance']['uiFontStyle'],
  label: style.label,
}));

const SCENE_OPTIONS = [
  { value: 'island', label: 'Island' },
  { value: 'desk', label: 'Desk' },
] as const;

const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 16;

// Keeps a half-typed value local; only an in-range integer is committed, and a blank or invalid entry reverts on blur.
function FontSizeInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        step={1}
        aria-label="Font size"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Number(e.target.value);
          if (Number.isInteger(next) && next >= FONT_SIZE_MIN && next <= FONT_SIZE_MAX) onChange(next);
        }}
        onBlur={() => setDraft(String(value))}
        className="w-16 rounded-chip border border-[#2D2D2B] bg-[var(--bg-primary,#F9F9F7)] px-3 py-1.5 text-sm tabular-nums text-[var(--text-primary,#2D2D2B)] outline-none focus:border-[var(--accent-color,#CC7D5E)]"
      />
      <span className="text-sm text-[var(--settings-text-muted)]">px</span>
    </div>
  );
}

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
        <SettingItem label="UI Font Style" description="Weight and italic style of the interface and note text." stacked>
          <SettingsSelect
            ariaLabel="UI font style"
            value={settings.appearance.uiFontStyle}
            options={UI_FONT_STYLE_OPTIONS}
            onChange={(uiFontStyle) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, uiFontStyle },
            }))}
          />
        </SettingItem>
        <SettingItem label="Font Size" description="Base font size for the editor.">
          <FontSizeInput
            value={settings.editor.fontSize}
            onChange={(fontSize) => updateSettings(s => ({ ...s, editor: { ...s.editor, fontSize } }))}
          />
        </SettingItem>
        <SettingItem label="Line Height" description="Spacing between lines of text.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)]">{settings.editor.lineHeight}</span>
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
          style={{ fontSize: settings.editor.fontSize, lineHeight: settings.editor.lineHeight, fontFamily: resolveFontFamily(settings.appearance.fontFamily), fontWeight: UI_FONT_STYLES[settings.appearance.uiFontStyle].weight, fontStyle: UI_FONT_STYLES[settings.appearance.uiFontStyle].italic ? 'italic' : 'normal' }}
        >
          Notes that link to each other slowly become a map of what you know.
          <br />
          彼此链接的笔记，会慢慢长成你知识的地图。
        </div>
      </SettingSection>

      <SettingSection title="Reading">
        <SettingItem label="Max Width" description="Maximum width of the editor content area.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)]">{settings.appearance.maxWidth}px</span>
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
        <SettingItem label="Reduce Motion" description="Turn off animations and transitions in the app, even when your system setting allows them.">
          <SettingsToggle
            checked={settings.appearance.reduceMotion}
            label="Reduce Motion"
            onChange={(checked) => updateSettings(s => ({
              ...s,
              appearance: { ...s.appearance, reduceMotion: checked },
            }))}
          />
        </SettingItem>
      </SettingSection>
    </div>
  );
}
