import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('bootstrap side-effect gates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  it('does not register global shortcuts while workspace data is unsafe', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.doMock('react', () => ({
      useRef: <T,>(value: T) => ({ current: value }),
      useEffect: (effect: () => unknown) => {
        effect();
      },
    }));

    const { useGlobalShortcuts } = await import('../../src/hooks/useGlobalShortcuts');
    (useGlobalShortcuts as unknown as (options: Record<string, unknown>) => void)({
      enabled: false,
      searchQuery: '',
      searchInputRef: { current: null },
      onCreateNote: vi.fn(),
      onOpenDailyNote: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onFocusSearch: vi.fn(),
      onClearSearch: vi.fn(),
    });

    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('does not persist empty tabs before workspace data is safe', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem,
    });
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      matchMedia: vi.fn(() => ({ matches: false })),
    });
    vi.doMock('react', () => ({
      useState: <T,>(initial: T | (() => T)) => [
        typeof initial === 'function' ? (initial as () => T)() : initial,
        vi.fn(),
      ],
      useRef: <T,>(value: T) => ({ current: value }),
      useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
      useMemo: <T,>(fn: () => T) => fn(),
      useEffect: (effect: () => unknown) => {
        effect();
      },
    }));

    const { useTabs } = await import('../../src/hooks/useTabs');
    useTabs({
      notes: [],
      isLoaded: false,
      activeNoteId: '',
      setActiveNoteId: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(setItem).not.toHaveBeenCalled();
  });

  it('isolates the recovery dialog from the writable application surface', async () => {
    const appSource = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('inert={loadError ? true : undefined}');
    expect(appSource).toContain('aria-hidden={loadError ? true : undefined}');
    expect(appSource).toContain('role="dialog"');
    expect(appSource).toContain('aria-modal="true"');
    expect(appSource).toContain('if (!isDataReady) return true;');
    expect(appSource).toContain('attachmentMutationsDisabled={!isDataReady ||');
  });
});
