import React from 'react';
import { AppSettings } from '../../../types';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}

export default function AppearanceSettings({ settings, updateSettings }: AppearanceSettingsProps) {
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
        <SettingItem label="Font Family" description="The font used for the editor and preview.">
          <div className="flex flex-col space-y-2">
            <select 
              value={['font-redaction', 'font-pixelify', 'font-work-sans'].includes(settings.appearance.fontFamily) ? settings.appearance.fontFamily : 'custom'}
              onChange={(e) => {
                const val = e.target.value;
                if (val !== 'custom') {
                  updateSettings(s => ({ ...s, appearance: { ...s.appearance, fontFamily: val } }));
                } else {
                  updateSettings(s => ({ ...s, appearance: { ...s.appearance, fontFamily: 'Arial' } })); // Default custom
                }
              }}
              className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm font-bold outline-none"
            >
              <option value="font-redaction">Redaction 50 (Default)</option>
              <option value="font-pixelify">Pixelify Sans</option>
              <option value="font-work-sans">Work Sans</option>
              <option value="custom">Custom Local Font...</option>
            </select>
            {!['font-redaction', 'font-pixelify', 'font-work-sans'].includes(settings.appearance.fontFamily) && (
              <input
                type="text"
                value={settings.appearance.fontFamily}
                onChange={(e) => updateSettings(s => ({ ...s, appearance: { ...s.appearance, fontFamily: e.target.value } }))}
                placeholder="e.g. 'Times New Roman', serif"
                className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:ring-1 ring-[#B89B5E]"
              />
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
