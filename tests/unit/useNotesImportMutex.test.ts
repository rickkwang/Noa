import { beforeEach, describe, expect, it, vi } from 'vitest';

const makeNote = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  title: 'Title',
  content: 'Body',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  ...overrides,
});

function createReactHarness() {
  const states: any[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateIndex = 0;
  let refIndex = 0;

  return {
    react: {
      useState<T>(initial: T | (() => T)) {
        const idx = stateIndex++;
        if (!(idx in states)) {
          states[idx] = typeof initial === 'function'
            ? (initial as () => T)()
            : initial;
        }
        const setState = (next: T | ((prev: T) => T)) => {
          states[idx] = typeof next === 'function'
            ? (next as (prev: T) => T)(states[idx])
            : next;
        };
        return [states[idx], setState] as const;
      },
      useRef<T>(initial: T) {
        const idx = refIndex++;
        if (!(idx in refs)) {
          refs[idx] = { current: initial };
        }
        return refs[idx] as { current: T };
      },
      useEffect() {
        // no-op for unit harness
      },
      useCallback<T extends (...args: any[]) => any>(fn: T) {
        return fn;
      },
    },
    states,
  };
}

function createStorageMock(overrides: Record<string, unknown> = {}) {
  return {
    saveNote: vi.fn(async () => undefined),
    verifyAccess: vi.fn(async () => undefined),
    migrateFromLocalStorage: vi.fn(async () => false),
    migrateToPerNoteStorage: vi.fn(async () => undefined),
    getWorkspaceName: vi.fn(async () => null),
    getFolders: vi.fn(async () => null),
    getNotes: vi.fn(async () => null),
    saveFolders: vi.fn(async () => undefined),
    saveWorkspaceName: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    deleteAttachmentBlobsByNoteId: vi.fn(async () => undefined),
    pruneOrphanedNotes: vi.fn(async () => undefined),
    pruneOrphanedAttachments: vi.fn(async () => undefined),
    listAttachmentBlobIds: vi.fn(async () => [] as string[]),
    saveNotes: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('useNotes import mutex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('defers debounce saves during import, then flushes them straight to storage', async () => {
    vi.resetModules();

    let releaseImport: (() => void) | undefined;
    const saveNote = vi.fn(async (_note: unknown) => undefined);
    const saveNotes = vi.fn(() => new Promise<void>((resolve) => { releaseImport = resolve; }));
    const storageMock = createStorageMock({ saveNote, saveNotes });
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    const importPromise = api.handleImportData([makeNote({ id: 'imported' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getIsImporting()).toBe(true);

    // An edit landing mid-import must not schedule a debounced write.
    api.handleSaveNote(makeNote({ content: 'edited during import' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveNote).not.toHaveBeenCalled();

    // Releasing the import flushes the queued edit without a debounce.
    releaseImport!();
    await importPromise;
    expect(api.getIsImporting()).toBe(false);
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote.mock.calls[0]?.[0]).toMatchObject({ id: 'n1', content: 'edited during import' });
    // The imported batch must land before the rescued edit, so the edit wins.
    expect(saveNotes.mock.invocationCallOrder[0]).toBeLessThan(saveNote.mock.invocationCallOrder[0]!);
  });

  it('persists edits that land after the merge point via the deferred flush', async () => {
    vi.resetModules();

    let releaseImport: (() => void) | undefined;
    const saveNote = vi.fn(async (_note: unknown) => undefined);
    const saveNotes = vi.fn((_notes: unknown) => new Promise<void>((resolve) => { releaseImport = resolve; }));
    const storageMock = createStorageMock({ saveNote, saveNotes });
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    const importPromise = api.handleImportData([makeNote({ content: 'import delivered' })]);
    // An edit landing while the batch write is held misses the merge; the deferred flush is its only path.
    await vi.advanceTimersByTimeAsync(0);

    api.handleSaveNote(makeNote({ content: 'locally edited' }));
    releaseImport!();
    await importPromise;

    // The batch predates the edit, so it carries the import-delivered body.
    const batch = saveNotes.mock.calls[0]?.[0] as Array<{ id: string; content: string }>;
    expect(batch.find((note) => note.id === 'n1')?.content).toBe('import delivered');
    // The edit is not lost: the deferred flush writes it after the batch.
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote.mock.calls[0]?.[0]).toMatchObject({ id: 'n1', content: 'locally edited' });
    expect(saveNotes.mock.invocationCallOrder[0]).toBeLessThan(saveNote.mock.invocationCallOrder[0]!);
    // State must converge on the edit too, so storage and UI don't diverge.
    const notesState = (harness.states as unknown[]).find(
      (s) => Array.isArray(s) && s.some((n) => n?.id === 'n1'),
    ) as Array<{ id: string; content: string }>;
    expect(notesState.find((n) => n.id === 'n1')?.content).toBe('locally edited');
  });

  it('keeps only the latest edit when saves arrive rapidly', async () => {    vi.resetModules();

    const saveNote = vi.fn(async (_note: unknown) => undefined);
    const storageMock = createStorageMock({ saveNote });
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    api.handleSaveNote(makeNote({ content: 'v1' }));
    await vi.advanceTimersByTimeAsync(100);
    api.handleSaveNote(makeNote({ content: 'v2' }));
    await vi.advanceTimersByTimeAsync(500);

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote.mock.calls[0]?.[0]).toMatchObject({ content: 'v2' });
  });
});
