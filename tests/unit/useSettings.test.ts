import { describe, expect, it } from 'vitest';
import { defaultSettings, loadBrowserSettings, loadSettings } from '../../src/hooks/useSettings';

describe('loadSettings', () => {
  it('allows the default settings to be persisted for a genuinely missing key', () => {
    expect(loadSettings({ getItem: () => null })).toEqual({
      settings: defaultSettings,
      canPersist: true,
    });
  });

  it('deep-merges valid partial settings and allows migration persistence', () => {
    const loaded = loadSettings({
      getItem: () => JSON.stringify({ appearance: { theme: 'dark' } }),
    });

    expect(loaded.canPersist).toBe(true);
    expect(loaded.settings.appearance).toEqual({
      ...defaultSettings.appearance,
      theme: 'dark',
    });
    expect(loaded.settings.editor).toEqual(defaultSettings.editor);
  });

  it('does not overwrite the settings key after a transient read failure', () => {
    const loaded = loadSettings({
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });

    expect(loaded).toEqual({ settings: defaultSettings, canPersist: false, failure: 'unavailable' });
  });

  it('also catches an exception while resolving the browser storage object', () => {
    expect(loadBrowserSettings(() => {
      throw new DOMException('blocked', 'SecurityError');
    })).toEqual({ settings: defaultSettings, canPersist: false, failure: 'unavailable' });
  });

  it('does not overwrite malformed settings before the user makes a new change', () => {
    expect(loadSettings({ getItem: () => '{broken-json' })).toEqual({
      settings: defaultSettings,
      canPersist: false,
      failure: 'invalid',
    });
  });

  it.each([
    { appearance: 'damaged' },
    { editor: [] },
    { appearance: { theme: 'midnight' } },
    { editor: { fontSize: -100 } },
  ])('preserves syntactically valid but unsafe settings: %j', (saved) => {
    const loaded = loadSettings({ getItem: () => JSON.stringify(saved) });

    expect(loaded.canPersist).toBe(false);
    expect(loaded.failure).toBe('invalid');
    expect(loaded.settings.editor).toEqual(defaultSettings.editor);
    expect(loaded.settings.appearance).toEqual(defaultSettings.appearance);
  });
});
