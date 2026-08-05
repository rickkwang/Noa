import React, { useState, useRef } from 'react';
import { AppSettings } from '../../../types';
import SettingItem from '../SettingItem';
import SettingSection from '../SettingSection';
import SettingsToggle from '../SettingsToggle';
import { ChevronDown } from '@/src/lib/icons';

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}

const BUILTIN_FONTS = ['font-iosevka', 'font-redaction', 'font-pixelify', 'font-work-sans'];

function isBuiltin(fontFamily: string) {
  return BUILTIN_FONTS.includes(fontFamily);
}

// Module-level cache: queryLocalFonts() enumerates every installed system font,
// which is slow enough to visibly stutter the Typography section. This section
// remounts each time Settings reopens (SettingsModal conditionally renders it),
// so without caching across mounts the enumeration re-ran on every open.
let cachedSystemFonts: string[] | null = null;
let systemFontsPromise: Promise<string[]> | null = null;

function loadSystemFonts(): Promise<string[]> {
  if (cachedSystemFonts) return Promise.resolve(cachedSystemFonts);
  if (systemFontsPromise) return systemFontsPromise;

  const api = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (typeof api !== 'function') return Promise.resolve([]);

  systemFontsPromise = api()
    .then((fonts: { family: string }[]) => {
      const families = Array.from(new Set(fonts.map((f: { family: string }) => f.family))).sort() as string[];
      cachedSystemFonts = families;
      return families;
    })
    .finally(() => { systemFontsPromise = null; });
  return systemFontsPromise;
}

export default function AppearanceSettings({ settings, updateSettings }: AppearanceSettingsProps) {
  const [systemFonts, setSystemFonts] = useState<string[]>(cachedSystemFonts ?? []);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const didLoad = useRef(false);

  // Enumerate local fonts only when the user opens the font dropdown: on the
  // web, queryLocalFonts() fires a browser permission prompt, and triggering it
  // just by opening this tab would be intrusive. Results are cached module-wide
  // so the enumeration runs at most once per session.
  const ensureFontsLoaded = () => {
    if (didLoad.current || cachedSystemFonts) return;
    didLoad.current = true;

    setLoadingFonts(true);
    loadSystemFonts()
      .then(setSystemFonts)
      .catch((err: unknown) => {
        // Permission denied or API unavailable — silently degrade
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('permission')) {
          setFontError('Could not load system fonts.');
        }
      })
      .finally(() => setLoadingFonts(false));
  };

  const currentIsBuiltin = isBuiltin(settings.appearance.fontFamily);
  const currentSystemFont = !currentIsBuiltin ? settings.appearance.fontFamily : '';

  // The <select> value: builtin key, or the actual family name for system fonts
  const selectValue = settings.appearance.fontFamily;

  return (
    <div className="space-y-8">
      <SettingSection title="Theme" description="Change how Noa looks.">
        <SettingItem label="Base Theme" description="Choose between light, dark, or sync with system.">
          <div className="relative inline-block">
            <select
              value={settings.appearance.theme}
              aria-label="Base theme"
              onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, theme: e.target.value as 'light' | 'dark' | 'system' } }))}
              className="appearance-none bg-[#F9F9F7] border border-[#2D2D2B] rounded-md pl-3 pr-9 py-1.5 text-sm font-bold outline-none focus:border-[#CC7D5E]"
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
        <SettingItem label="Font Family" description="The font used for the editor and preview." stacked>
          <div className="flex flex-col space-y-2">
            <div className="relative inline-block self-start">
              <select
                value={selectValue}
                aria-label="Font family"
                onFocus={ensureFontsLoaded}
                onPointerDown={ensureFontsLoaded}
                onChange={(e) => {
                  updateSettings(s => ({ ...s, appearance: { ...s.appearance, fontFamily: e.target.value } }));
                }}
                className="appearance-none bg-[#F9F9F7] border border-[#2D2D2B] rounded-md pl-3 pr-9 py-1.5 text-sm font-bold outline-none focus:border-[#CC7D5E]"
              >
                {/* Built-in bundled fonts */}
                <option value="font-iosevka">Iosevka Nerd Font Mono (Default)</option>
                <option value="font-redaction">Redaction 50</option>
                <option value="font-pixelify">Pixelify Sans</option>
                <option value="font-work-sans">Work Sans</option>

                {/* System fonts — shown when API is available */}
                {systemFonts.length > 0 && (
                  <optgroup label="System Fonts">
                    {systemFonts.map(family => (
                      <option key={family} value={family}>{family}</option>
                    ))}
                  </optgroup>
                )}

                {/* Fallback: if current value is a system font but API wasn't available */}
                {!currentIsBuiltin && systemFonts.length === 0 && (
                  <option value={currentSystemFont}>{currentSystemFont}</option>
                )}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2D2D2B]/70" />
            </div>

            {loadingFonts && (
              <span className="text-xs text-[#2D2D2B]/50">Loading system fonts…</span>
            )}
            {fontError && (
              <span className="text-xs text-[#2D2D2B]/50">{fontError}</span>
            )}

            {/* Preview of the selected font */}
            {!currentIsBuiltin && currentSystemFont && (
              <span
                className="text-sm text-[#2D2D2B]/70 truncate"
                style={{ fontFamily: currentSystemFont }}
              >
                The quick brown fox — {currentSystemFont}
              </span>
            )}
          </div>
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
