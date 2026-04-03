import { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { STORAGE_KEYS } from '../constants/storageKeys';

export const defaultSettings: AppSettings = {
  editor: {
    fontSize: 14,
    lineHeight: 1.5,
  },
  appearance: {
    theme: 'system',
    accentColor: '#B89B5E',
    fontFamily: 'font-redaction',
    maxWidth: 800,
  },
  dailyNotes: {
    template: '',
    dateFormat: 'YYYY-MM-DD',
  },
  search: {
    caseSensitive: false,
    fuzzySearch: true,
  },
  corePlugins: {
    graphView: true,
    dailyNotes: true,
  },
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Deep merge with default settings to ensure all properties exist
        return {
          editor: { ...defaultSettings.editor, ...parsed.editor },
          appearance: { ...defaultSettings.appearance, ...parsed.appearance },
          dailyNotes: { ...defaultSettings.dailyNotes, ...parsed.dailyNotes },
          search: { ...defaultSettings.search, ...parsed.search },
          corePlugins: { ...defaultSettings.corePlugins, ...parsed.corePlugins },
        };
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {
      // localStorage quota exceeded — settings will not persist this session
    }
  }, [settings]);

  const updateSettings = (updater: (prev: AppSettings) => AppSettings) => {
    setSettings(updater);
  };

  return { settings, updateSettings };
}
