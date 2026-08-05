import { describe, expect, it } from 'vitest';
import { defaultSettings, loadBrowserSettings, loadSettings } from '../../src/hooks/useSettings';
import { SYSTEM_DEFAULT_FONT } from '../../src/lib/fontFamily';

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

  it('defaults the translucent sidebar off for existing settings', () => {
    const loaded = loadSettings({
      getItem: () => JSON.stringify({ appearance: { theme: 'dark' } }),
    });

    expect(loaded.settings.appearance.translucentSidebar).toBe(false);
  });

  it('restores the translucent sidebar preference when it is valid', () => {
    const loaded = loadSettings({
      getItem: () => JSON.stringify({ appearance: { translucentSidebar: true } }),
    });

    expect(loaded.canPersist).toBe(true);
    expect(loaded.settings.appearance.translucentSidebar).toBe(true);
  });

  it('migrates every retired bundled font to the system default', () => {
    for (const retired of ['font-iosevka', 'font-redaction', 'font-pixelify', 'font-work-sans']) {
      const loaded = loadSettings({
        getItem: () => JSON.stringify({ appearance: { fontFamily: retired } }),
      });

      expect(loaded.settings.appearance.fontFamily).toBe(SYSTEM_DEFAULT_FONT);
      // A stale font name self-heals; it must not raise the recovery banner.
      expect(loaded.canPersist).toBe(true);
    }
  });

  it('keeps a font family the user picked from their installed fonts', () => {
    const loaded = loadSettings({
      getItem: () => JSON.stringify({ appearance: { fontFamily: 'Helvetica Neue' } }),
    });

    expect(loaded.canPersist).toBe(true);
    expect(loaded.settings.appearance.fontFamily).toBe('Helvetica Neue');
  });

  it('drops a font family that could not be a real family name', () => {
    const loaded = loadSettings({
      getItem: () => JSON.stringify({ appearance: { fontFamily: 'Arial"; } body { display: none } .x {' } }),
    });

    expect(loaded.settings.appearance.fontFamily).toBe(SYSTEM_DEFAULT_FONT);
  });

  it('ignores the retired Graph View preference while loading legacy settings', () => {
    const loaded = loadSettings({
      getItem: () => JSON.stringify({ corePlugins: { graphView: false, dailyNotes: false } }),
    });

    expect(loaded.settings.corePlugins).toEqual({ dailyNotes: false });
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
    { appearance: { translucentSidebar: 'yes' } },
    { editor: { fontSize: -100 } },
  ])('preserves syntactically valid but unsafe settings: %j', (saved) => {
    const loaded = loadSettings({ getItem: () => JSON.stringify(saved) });

    expect(loaded.canPersist).toBe(false);
    expect(loaded.failure).toBe('invalid');
    expect(loaded.settings.editor).toEqual(defaultSettings.editor);
    expect(loaded.settings.appearance).toEqual(defaultSettings.appearance);
  });
});
