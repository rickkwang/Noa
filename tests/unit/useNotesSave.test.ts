import { beforeEach, describe, expect, it, vi } from 'vitest';

const makeNote = () => ({
  id: 'n1',
  title: 'Title',
  content: 'Body',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
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

describe('useNotes handleSaveNote', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('persists the updated note object instead of the stale input object', async () => {
    vi.resetModules();

    const saveNote = vi.fn(async () => undefined);
    const storageMock = {
      saveNote,
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
      saveNotes: vi.fn(async () => undefined),
      pruneOrphanedAttachments: vi.fn(async () => undefined),
    };
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();
    const input = makeNote();

    api.handleSaveNote(input);
    await vi.advanceTimersByTimeAsync(500);

    expect(saveNote).toHaveBeenCalledTimes(1);
    const calls = saveNote.mock.calls as unknown as Array<[{ title: string; content: string; updatedAt: string }]>;
    const saved = calls[0]?.[0];
    expect(saved).toBeDefined();
    const persisted = saved as { title: string; content: string; updatedAt: string };
    expect(persisted).not.toBe(input);
    expect(persisted.title).toBe(input.title);
    expect(persisted.content).toBe(input.content);
    expect(persisted.updatedAt).not.toBe(input.updatedAt);
  });
});

describe('useNotes handleImportData attachment rollback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('rolls back only newly-saved attachment blobs when the import fails', async () => {
    vi.resetModules();
    vi.useRealTimers();

    const deleteAttachmentBlob = vi.fn(async () => undefined);
    const storageMock = {
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
      saveAttachmentBlob: vi.fn(async () => undefined),
      deleteAttachmentBlob,
      listAttachmentBlobIds: vi.fn(async () => ['pre-existing']),
      saveNotes: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    };
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    const attachment = (id: string, filename: string) => ({
      id,
      noteId: 'n1',
      filename,
      mimeType: 'image/png',
      size: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
      dataBase64: 'aGVsbG8=',
    });
    const note = {
      ...makeNote(),
      attachments: [attachment('pre-existing', 'a.png'), attachment('brand-new', 'b.png')],
    };

    await expect(api.handleImportData([note])).rejects.toThrow();

    // Blobs that existed before the import were merely overwritten with the
    // same immutable content — deleting them would destroy user attachments.
    expect(deleteAttachmentBlob).toHaveBeenCalledWith('brand-new');
    expect(deleteAttachmentBlob).not.toHaveBeenCalledWith('pre-existing');
  });

  it('preserves the vault origin marker when importing merged vault rows', async () => {
    vi.resetModules();
    vi.useRealTimers();

    const saveNotes = vi.fn(async () => undefined);
    const storageMock = {
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
      saveAttachmentBlob: vi.fn(async () => undefined),
      deleteAttachmentBlob: vi.fn(async () => undefined),
      listAttachmentBlobIds: vi.fn(async () => []),
      saveNotes,
    };
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    const vaultNote = { ...makeNote(), source: 'obsidian-import' as const, origin: 'vault' as const, vaultPath: 'Sample.md' };

    await api.handleImportData([vaultNote]);

    // The mirror cache row must keep origin: 'vault' through normalize/persist —
    // otherwise on reload it would look Noa-owned and lose write-through.
    const savedArgs = saveNotes.mock.calls as unknown as Array<[Array<{ id: string; origin?: string }>]>;
    const persisted = savedArgs[0]?.[0]?.find((n) => n.id === 'n1');
    expect(persisted?.origin).toBe('vault');
  });
});

describe('useNotes importBackupFromRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('reports invalid backup files as import errors instead of storage errors', async () => {
    vi.resetModules();

    const saveNote = vi.fn(async () => undefined);
    const storageMock = {
      saveNote,
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
      saveNotes: vi.fn(async () => undefined),
      pruneOrphanedAttachments: vi.fn(async () => undefined),
      clearAll: vi.fn(async () => undefined),
    };
    const fromImportError = vi.fn((code: string) => ({ code, userMessage: `import:${code}`, suggestedAction: 'import_backup' as const }));
    const fromStorageError = vi.fn(() => ({ code: 'storage_unavailable', userMessage: 'storage', suggestedAction: 'retry' as const }));
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));
    vi.doMock('../../src/lib/appErrors', () => ({
      fromImportError,
      fromStorageError,
    }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    await api.importBackupFromRecovery(new File([JSON.stringify({ folders: [], workspaceName: 'Recovered' })], 'bad.json', { type: 'application/json' }));

    expect(fromImportError).toHaveBeenCalled();
    expect(fromStorageError).not.toHaveBeenCalled();
  });
});
