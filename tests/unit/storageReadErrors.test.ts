import { beforeEach, describe, expect, it, vi } from 'vitest';

interface StoreOverrides {
  clear?: () => Promise<void>;
  iterate?: () => Promise<void>;
  getItem?: () => Promise<unknown>;
  setItem?: (key: string, value: unknown) => Promise<unknown>;
  removeItem?: (key: string) => Promise<void>;
}

async function loadStorage({
  notes = {},
  folders = {},
  workspace = {},
}: {
  notes?: StoreOverrides;
  folders?: StoreOverrides;
  workspace?: StoreOverrides;
} = {}) {
  vi.resetModules();

  const defaultStore = {
    clear: vi.fn(async () => undefined),
    iterate: vi.fn(async () => undefined),
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async <T>(_key: string, value: T) => value),
    removeItem: vi.fn(async () => undefined),
  };
  const stores = [
    { ...defaultStore, ...notes },
    { ...defaultStore, ...folders },
    { ...defaultStore, ...workspace },
    defaultStore,
    defaultStore,
  ];

  vi.doMock('localforage', () => ({
    default: {
      createInstance: vi.fn(() => stores.shift() ?? defaultStore),
    },
  }));

  return (await import('../../src/lib/storage')).storage;
}

describe('storage read errors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('propagates a notes-store read failure instead of reporting an empty store', async () => {
    const readError = new Error('notes database unavailable');
    const storage = await loadStorage({
      notes: { iterate: vi.fn(async () => Promise.reject(readError)) },
    });

    await expect(storage.getNotes()).rejects.toBe(readError);
  });

  it('propagates a folders-store read failure instead of reporting an empty store', async () => {
    const readError = new Error('folders database unavailable');
    const storage = await loadStorage({
      folders: { getItem: vi.fn(async () => Promise.reject(readError)) },
    });

    await expect(storage.getFolders()).rejects.toBe(readError);
  });

  it('propagates a workspace-store read failure instead of replacing its name', async () => {
    const readError = new Error('workspace database unavailable');
    const storage = await loadStorage({
      workspace: { getItem: vi.fn(async () => Promise.reject(readError)) },
    });

    await expect(storage.getWorkspaceName()).rejects.toBe(readError);
  });

  it('still reports a successfully-read empty database as empty', async () => {
    const storage = await loadStorage();

    await expect(storage.getNotes()).resolves.toBeNull();
    await expect(storage.getFolders()).resolves.toBeNull();
    await expect(storage.getWorkspaceName()).resolves.toBeNull();
  });

  it('propagates a migration read failure instead of continuing bootstrap', async () => {
    const readError = new Error('migration state unavailable');
    const storage = await loadStorage({
      notes: { getItem: vi.fn(async () => Promise.reject(readError)) },
    });

    await expect(storage.migrateToPerNoteStorage()).rejects.toBe(readError);
  });

  it('rejects a partial legacy-note migration instead of loading partial data', async () => {
    const legacyNotes = [
      { id: 'n1', title: 'One' },
      { id: 'n2', title: 'Two' },
    ];
    const getItem = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyNotes)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyNotes);
    let shouldFail = true;
    const setItem = vi.fn(async (key: string, value: unknown) => {
      if (key === 'note:n2' && shouldFail) throw new Error('quota exceeded');
      return value;
    });
    const removeItem = vi.fn(async () => undefined);
    const storage = await loadStorage({ notes: { getItem, setItem, removeItem } });

    await expect(storage.migrateToPerNoteStorage()).rejects.toThrow(
      'Migration failed after writing 1/2 notes',
    );

    expect(removeItem).not.toHaveBeenCalledWith('all-notes');
    expect(setItem).not.toHaveBeenCalledWith('migration:per-note-done', true);

    shouldFail = false;
    await expect(storage.migrateToPerNoteStorage()).resolves.toBeUndefined();

    expect(setItem).toHaveBeenCalledWith('note:n1', legacyNotes[0]);
    expect(setItem).toHaveBeenCalledWith('note:n2', legacyNotes[1]);
    expect(removeItem).toHaveBeenCalledWith('all-notes');
    expect(setItem).toHaveBeenCalledWith('migration:per-note-done', true);
  });

  it('propagates invalid legacy localStorage data to bootstrap recovery', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'pixel-notes' ? '{invalid' : null),
      removeItem: vi.fn(),
    });
    const storage = await loadStorage();

    await expect(storage.migrateFromLocalStorage()).rejects.toThrow();
  });

  it('propagates a failed legacy localStorage write to bootstrap recovery', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'pixel-notes'
        ? JSON.stringify([{ id: 'legacy', title: 'Legacy', content: 'body' }])
        : null),
      removeItem: vi.fn(),
    });
    const storage = await loadStorage({
      notes: {
        setItem: vi.fn(async () => Promise.reject(new Error('quota exceeded'))),
      },
    });

    await expect(storage.migrateFromLocalStorage()).rejects.toThrow(/Import failed/);
  });

  it('discards legacy migration keys when the workspace is explicitly cleared', async () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      removeItem,
    });
    const storage = await loadStorage();

    await storage.clearAll();

    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([
      'pixel-notes',
      'pixel-folders',
      'pixel-workspace',
    ]);
  });
});
