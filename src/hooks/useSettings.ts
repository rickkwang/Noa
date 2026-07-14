import { useState, useEffect, useCallback, useRef } from 'react';
import { AppSettings } from '../types';
import { STORAGE_KEYS } from '../constants/storageKeys';

export const defaultSettings: AppSettings = {
  editor: {
    fontSize: 14,
    lineHeight: 1.5,
  },
  appearance: {
    theme: 'system',
    fontFamily: 'font-iosevka',
    maxWidth: 680,
    usePointerCursors: true,
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
  templates: {
    userTemplates: [],
  },
  backup: {
    autoBackupEnabled: false,
  },
};

interface SettingsReader {
  getItem: (key: string) => string | null;
}

type SettingsRecord = Record<string, unknown>;

function isSettingsRecord(value: unknown): value is SettingsRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUserTemplate(value: unknown): boolean {
  if (!isSettingsRecord(value)) return false;
  return ['id', 'name', 'content', 'createdAt'].every((key) => typeof value[key] === 'string');
}

export interface LoadedSettings {
  settings: AppSettings;
  /** False when the existing value could not be read safely. */
  canPersist: boolean;
  failure?: 'unavailable' | 'invalid';
}

export function loadSettings(storage: SettingsReader): LoadedSettings {
  let saved: string | null;
  try {
    saved = storage.getItem(STORAGE_KEYS.SETTINGS);
  } catch {
    return { settings: defaultSettings, canPersist: false, failure: 'unavailable' };
  }

  if (!saved) return { settings: defaultSettings, canPersist: true };

  try {
    const parsed: unknown = JSON.parse(saved);
    if (!isSettingsRecord(parsed)) {
      return { settings: defaultSettings, canPersist: false, failure: 'invalid' };
    }

    let valid = true;
    const section = (key: keyof AppSettings): SettingsRecord => {
      const value = parsed[key];
      if (value === undefined) return {};
      if (isSettingsRecord(value)) return value;
      valid = false;
      return {};
    };
    const setting = <T,>(
      values: SettingsRecord,
      key: string,
      fallback: T,
      guard: (value: unknown) => value is T,
    ): T => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) return fallback;
      const value = values[key];
      if (guard(value)) return value;
      valid = false;
      return fallback;
    };

    const editor = section('editor');
    const appearance = section('appearance');
    const dailyNotes = section('dailyNotes');
    const search = section('search');
    const corePlugins = section('corePlugins');
    const templates = section('templates');
    const backup = section('backup');

    const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
    const isString = (value: unknown): value is string => typeof value === 'string';
    const isTheme = (value: unknown): value is AppSettings['appearance']['theme'] => (
      value === 'light' || value === 'dark' || value === 'system'
    );
    const isFontSize = (value: unknown): value is number => (
      typeof value === 'number' && Number.isFinite(value) && value >= 10 && value <= 24
    );
    const isLineHeight = (value: unknown): value is number => (
      typeof value === 'number' && Number.isFinite(value) && value >= 1.2 && value <= 2.5
    );
    const isMaxWidth = (value: unknown): value is number => (
      typeof value === 'number' && Number.isFinite(value) && value >= 600 && value <= 1200
    );
    const isTemplates = (value: unknown): value is AppSettings['templates']['userTemplates'] => (
      Array.isArray(value) && value.every(isUserTemplate)
    );

    // accentColor was removed; drop it from older stored settings so it is not
    // merged back in and re-persisted as a dead key.
    // The bundled fonts are back; migrate the interim value from the removal
    // experiment to the default bundled font.
    const storedFontFamily = setting(appearance, 'fontFamily', defaultSettings.appearance.fontFamily, isString);
    const fontFamily = storedFontFamily === 'system-default' ? 'font-iosevka' : storedFontFamily;

    return {
      settings: {
        editor: {
          fontSize: setting(editor, 'fontSize', defaultSettings.editor.fontSize, isFontSize),
          lineHeight: setting(editor, 'lineHeight', defaultSettings.editor.lineHeight, isLineHeight),
        },
        appearance: {
          theme: setting(appearance, 'theme', defaultSettings.appearance.theme, isTheme),
          fontFamily,
          maxWidth: setting(appearance, 'maxWidth', defaultSettings.appearance.maxWidth, isMaxWidth),
          usePointerCursors: setting(appearance, 'usePointerCursors', defaultSettings.appearance.usePointerCursors, isBoolean),
        },
        dailyNotes: {
          template: setting(dailyNotes, 'template', defaultSettings.dailyNotes.template, isString),
          dateFormat: setting(dailyNotes, 'dateFormat', defaultSettings.dailyNotes.dateFormat, isString),
        },
        search: {
          caseSensitive: setting(search, 'caseSensitive', defaultSettings.search.caseSensitive, isBoolean),
          fuzzySearch: setting(search, 'fuzzySearch', defaultSettings.search.fuzzySearch, isBoolean),
        },
        corePlugins: {
          graphView: setting(corePlugins, 'graphView', defaultSettings.corePlugins.graphView, isBoolean),
          dailyNotes: setting(corePlugins, 'dailyNotes', defaultSettings.corePlugins.dailyNotes, isBoolean),
        },
        templates: {
          userTemplates: setting(templates, 'userTemplates', defaultSettings.templates.userTemplates, isTemplates),
        },
        backup: {
          autoBackupEnabled: setting(backup, 'autoBackupEnabled', defaultSettings.backup.autoBackupEnabled, isBoolean),
        },
      },
      canPersist: valid,
      ...(valid ? {} : { failure: 'invalid' as const }),
    };
  } catch {
    return { settings: defaultSettings, canPersist: false, failure: 'invalid' };
  }
}

export function loadBrowserSettings(
  getStorage: () => SettingsReader = () => window.localStorage,
): LoadedSettings {
  try {
    return loadSettings(getStorage());
  } catch {
    return { settings: defaultSettings, canPersist: false, failure: 'unavailable' };
  }
}

export function useSettings() {
  const initialRef = useRef<LoadedSettings | null>(null);
  if (!initialRef.current) initialRef.current = loadBrowserSettings();
  const canPersistRef = useRef(initialRef.current.canPersist);
  const failureRef = useRef(initialRef.current.failure);
  const pendingUpdatersRef = useRef<Array<(prev: AppSettings) => AppSettings>>([]);
  const [settings, setSettings] = useState<AppSettings>(initialRef.current.settings);

  useEffect(() => {
    if (failureRef.current === 'unavailable') {
      let cancelled = false;
      let retryDelay = 1000;
      let retryTimer: number | undefined;
      const retry = () => {
        retryTimer = window.setTimeout(() => {
          if (cancelled) return;
          const recovered = loadBrowserSettings();
          if (recovered.failure === 'unavailable') {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            retry();
            return;
          }

          const pending = pendingUpdatersRef.current;
          pendingUpdatersRef.current = [];
          const replaceInvalid = recovered.failure === 'invalid' && pending.length > 0;
          failureRef.current = replaceInvalid ? undefined : recovered.failure;
          canPersistRef.current = replaceInvalid || recovered.canPersist;
          setSettings(pending.reduce((next, apply) => apply(next), recovered.settings));
        }, retryDelay);
      };
      retry();
      return () => {
        cancelled = true;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      };
    }
    if (!canPersistRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {
      // localStorage quota exceeded — settings will not persist this session
    }
  }, [settings]);

  const updateSettings = useCallback((updater: (prev: AppSettings) => AppSettings) => {
    if (failureRef.current === 'unavailable') {
      const recovered = loadBrowserSettings();
      if (recovered.failure === 'unavailable') {
        pendingUpdatersRef.current.push(updater);
        setSettings(updater);
        return;
      }

      const pending = [...pendingUpdatersRef.current, updater];
      pendingUpdatersRef.current = [];
      failureRef.current = undefined;
      canPersistRef.current = true;
      setSettings(pending.reduce((next, apply) => apply(next), recovered.settings));
      return;
    }

    // A deliberate user change may replace a readable but invalid document.
    failureRef.current = undefined;
    canPersistRef.current = true;
    setSettings(updater);
  }, []);

  return { settings, updateSettings };
}
