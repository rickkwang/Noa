import { beforeEach, describe, expect, it, vi } from 'vitest';

const makeNote = () => ({
  id: 'n1',
  title: 'Trash Me',
  content: 'Body',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  attachments: [
    {
      id: 'a1',
      noteId: 'n1',
      filename: 'diagram.png',
      mimeType: 'image/png',
      size: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ],
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
    resetRender() {
      stateIndex = 0;
      refIndex = 0;
    },
  };
}

async function setup() {
  vi.resetModules();

  const saveNote = vi.fn(async () => undefined);
  const deleteNote = vi.fn(async () => undefined);
  const pruneOrphanedAttachments = vi.fn(async () => undefined);
  const storageMock = {
    saveNote,
    deleteNote,
    pruneOrphanedAttachments,
    deleteSnapshotsForNote: vi.fn(async () => undefined),
    deleteAttachmentBlobsByNoteId: vi.fn(async () => undefined),
    pruneOrphanedNotes: vi.fn(async () => undefined),
    saveNotes: vi.fn(async () => undefined),
    saveFolders: vi.fn(async () => undefined),
    saveWorkspaceName: vi.fn(async () => undefined),
    verifyAccess: vi.fn(async () => undefined),
    migrateFromLocalStorage: vi.fn(async () => false),
    migrateToPerNoteStorage: vi.fn(async () => undefined),
    getWorkspaceName: vi.fn(async () => null),
    getFolders: vi.fn(async () => null),
    getNotes: vi.fn(async () => null),
  };
  const harness = createReactHarness();

  vi.doMock('react', () => harness.react);
  vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

  const { useNotes } = await import('../../src/hooks/useNotes');
  const api = useNotes();
  return { api, saveNote, deleteNote, pruneOrphanedAttachments };
}

describe('useNotes session Undo support', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('restores a missing note, saving it back to storage and returning it', async () => {
    const { api, saveNote } = await setup();
    const note = makeNote();

    const restored = await api.handleRestoreNotes([note]);

    expect(restored).toEqual([note]);
    expect(saveNote).toHaveBeenCalledWith(note);
  });

  it('skips notes that were never deleted', async () => {
    const { api } = await setup();
    const note = makeNote();

    await api.handleRestoreNotes([note]);
    const second = await api.handleRestoreNotes([note]);

    expect(second).toEqual([]);
  });

  it('never restores an external vault snapshot through local Undo', async () => {
    const { api, saveNote } = await setup();
    const note = { ...makeNote(), origin: 'vault' as const, vaultPath: 'Trash Me.md' };
    expect(await api.handleRestoreNotes([note])).toEqual([]);
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('keeps successfully restored attachments live when a later restore fails', async () => {
    const { api, saveNote, pruneOrphanedAttachments } = await setup();
    const first = makeNote();
    const second = { ...makeNote(), id: 'n2', attachments: [] };
    await api.handleRestoreNotes([first, second]);
    await api.handleDeleteNote(first.id);
    await api.handleDeleteNote(second.id);
    saveNote.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('quota'));

    expect(await api.handleRestoreNotes([first, second])).toEqual([first]);
    await vi.advanceTimersByTimeAsync(20_000);
    const [validIds] = pruneOrphanedAttachments.mock.calls[0] as unknown as [Set<string>];
    expect(validIds.has('a1')).toBe(true);
  });

  it('defers attachment pruning so an undo inside the window keeps the blobs', async () => {
    const { api, pruneOrphanedAttachments } = await setup();
    const note = makeNote();

    await api.handleRestoreNotes([note]);
    await api.handleDeleteNote(note.id);
    expect(pruneOrphanedAttachments).not.toHaveBeenCalled();

    await api.handleRestoreNotes([note]);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(pruneOrphanedAttachments).toHaveBeenCalledTimes(1);
    const [validIds, candidateIds] = pruneOrphanedAttachments.mock.calls[0] as unknown as [Set<string>, Set<string>];
    expect(validIds.has('a1')).toBe(true);
    expect(candidateIds.has('a1')).toBe(true);
  });

  it('prunes attachments after the window when the note stays deleted', async () => {
    const { api, pruneOrphanedAttachments } = await setup();
    const note = makeNote();

    await api.handleRestoreNotes([note]);
    await api.handleDeleteNote(note.id);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(pruneOrphanedAttachments).toHaveBeenCalledTimes(1);
    const [validIds, candidateIds] = pruneOrphanedAttachments.mock.calls[0] as unknown as [Set<string>, Set<string>];
    expect(validIds.has('a1')).toBe(false);
    expect(candidateIds.has('a1')).toBe(true);
  });
});
