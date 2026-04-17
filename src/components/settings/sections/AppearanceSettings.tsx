import React, { useState, useEffect, useRef } from 'react';
import { AppSettings } from '../../../types';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}

const BUILTIN_FONTS = ['font-redaction', 'font-pixelify', 'font-work-sans'];

function isBuiltin(fontFamily: string) {
  return BUILTIN_FONTS.includes(fontFamily);
}

export default function AppearanceSettings({ settings, updateSettings }: AppearanceSettingsProps) {
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const didLoad = useRef(false);

  // Try to enumerate local fonts on mount (requires Local Font Access API)
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;

    const api = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (typeof api !== 'function') return;

    setLoadingFonts(true);
    api()
      .then((fonts: { family: string }[]) => {
        // Deduplicate family names and sort
        const families = Array.from(new Set(fonts.map((f: { family: string }) => f.family))).sort() as string[];
        setSystemFonts(families);
      })
      .catch((err: unknown) => {
        // Permission denied or API unavailable — silently degrade
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('permission')) {
          setFontError('Could not load system fonts.');
        }
      })
      .finally(() => setLoadingFonts(false));
  }, []);

  const currentIsBuiltin = isBuiltin(settings.appearance.fontFamily);
  const currentSystemFont = !currentIsBuiltin ? settings.appearance.fontFamily : '';

  // The <select> value: builtin key, or the actual family name for system fonts
  const selectValue = currentIsBuiltin ? settings.appearance.fontFamily : settings.appearance.fontFamily;

  return (
    <div className="space-y-8">
      <SettingSection title="Theme" description="Change how Noa looks.">
        <SettingItem label="Base Theme" description="Choose between light, dark, or sync with system.">
          <select
            value={settings.appearance.theme}
            onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, theme: e.target.value as 'light' | 'dark' | 'system' } }))}
            className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm font-bold outline-none"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </SettingItem>
        <SettingItem label="Accent Color" description="The primary color used for highlights and active states.">
          <input
            type="color"
            value={settings.appearance.accentColor}
            onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, accentColor: e.target.value } }))}
            className="w-10 h-10 p-0 border-2 border-[#2D2D2D] cursor-pointer"
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Typography" description="Customize fonts and text sizing.">
        <SettingItem label="Font Family" description="The font used for the editor and preview." stacked>
          <div className="flex flex-col space-y-2">
            <select
              value={selectValue}
              onChange={(e) => {
                updateSettings(s => ({ ...s, appearance: { ...s.appearance, fontFamily: e.target.value } }));
              }}
              className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm font-bold outline-none"
            >
              {/* Built-in bundled fonts */}
              <option value="font-redaction">Redaction 50 (Default)</option>
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

            {loadingFonts && (
              <span className="text-xs text-[#2D2D2D]/50">Loading system fonts…</span>
            )}
            {fontError && (
              <span className="text-xs text-[#2D2D2D]/50">{fontError}</span>
            )}

            {/* Preview of the selected font */}
            {!currentIsBuiltin && currentSystemFont && (
              <span
                className="text-sm text-[#2D2D2D]/70 truncate"
                style={{ fontFamily: currentSystemFont }}
              >
                The quick brown fox — {currentSystemFont}
              </span>
            )}
          </div>
        </SettingItem>
        <SettingItem label="Font Size" description="Base font size for the editor.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[#2D2D2D]/70">{settings.editor.fontSize}px</span>
            <input
              type="range"
              min="10"
              max="24"
              value={settings.editor.fontSize}
              onChange={(e) => updateSettings(s => ({ ...s, editor: { ...s.editor, fontSize: parseInt(e.target.value, 10) } }))}
              className="w-32 accent-[#B89B5E]"
            />
          </div>
        </SettingItem>
        <SettingItem label="Line Height" description="Spacing between lines of text.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[#2D2D2D]/70">{settings.editor.lineHeight}</span>
            <input
              type="range"
              min="1.2"
              max="2.5"
              step="0.1"
              value={settings.editor.lineHeight}
              onChange={(e) => updateSettings(s => ({ ...s, editor: { ...s.editor, lineHeight: parseFloat(e.target.value) } }))}
              className="w-32 accent-[#B89B5E]"
            />
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection title="Editor Style" description="Adjust the reading and writing experience.">
        <SettingItem label="Max Width" description="Maximum width of the editor content area.">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-[#2D2D2D]/70">{settings.appearance.maxWidth}px</span>
            <input
              type="range"
              min="600"
              max="1200"
              step="50"
              value={settings.appearance.maxWidth}
              onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, maxWidth: parseInt(e.target.value, 10) } }))}
              className="w-32 accent-[#B89B5E]"
            />
          </div>
        </SettingItem>
      </SettingSection>
    </div>
  );
}
