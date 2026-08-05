import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTasksFromNotes } from '../../src/lib/taskParser';

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

// Like createReactHarness, but useEffect actually runs effects with React-like
// dependency comparison — needed by flows that read notesRef/foldersRef
// (synced via effects) instead of functional setState.
function createEffectHarness({ deferState = false } = {}) {
  const states: any[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effectDeps: Array<unknown[] | undefined> = [];
  const pendingStateUpdates: Array<() => void> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;

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
          const apply = () => {
            states[idx] = typeof next === 'function'
              ? (next as (prev: T) => T)(states[idx])
              : next;
          };
          if (deferState) pendingStateUpdates.push(apply);
          else apply();
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
      useEffect(fn: () => unknown, deps?: unknown[]) {
        const idx = effectIndex++;
        const prev = effectDeps[idx];
        const changed = !prev || !deps
          || deps.length !== prev.length
          || deps.some((dep, i) => !Object.is(dep, prev[i]));
        if (changed) {
          effectDeps[idx] = deps;
          fn();
        }
      },
      useCallback<T extends (...args: any[]) => any>(fn: T) {
        return fn;
      },
    },
    resetRender() {
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
    },
    flushStateUpdates() {
      for (const apply of pendingStateUpdates.splice(0)) apply();
    },
  };
}

const baseStorageMock = () => ({
  saveNote: vi.fn(async () => undefined),
  saveSnapshot: vi.fn(async () => undefined),
  pruneSnapshots: vi.fn(async () => undefined),
  verifyAccess: vi.fn(async () => undefined),
  migrateFromLocalStorage: vi.fn(async () => false),
  migrateToPerNoteStorage: vi.fn(async () => undefined),
  getWorkspaceName: vi.fn(async () => null as string | null),
  getFolders: vi.fn(async () => null),
  getNotes: vi.fn(async () => null as unknown),
  saveFolders: vi.fn(async () => undefined),
  saveWorkspaceName: vi.fn(async () => undefined),
  deleteNote: vi.fn(async () => undefined),
  deleteSnapshotsForNote: vi.fn(async () => undefined),
  deleteAttachmentBlobsByNoteId: vi.fn(async () => undefined),
  pruneOrphanedNotes: vi.fn(async () => undefined),
  pruneOrphanedAttachments: vi.fn(async () => undefined),
  saveAttachmentBlob: vi.fn(async () => undefined),
  deleteAttachmentBlob: vi.fn(async () => undefined),
  listAttachmentBlobIds: vi.fn(async () => [] as string[]),
  saveNotes: vi.fn(async () => undefined),
  clearLegacyLocalStorage: vi.fn(),
});

describe('useNotes bootstrap recovery write gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('does not persist default workspace state after a storage read failure', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    storageMock.getNotes = vi.fn(async () => {
      throw new Error('notes database unavailable');
    });
    const harness = createEffectHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();

    for (let i = 0; i < 20 && !api.isLoaded; i += 1) {
      await Promise.resolve();
      harness.resetRender();
      api = useNotes();
    }

    expect(api.isLoaded).toBe(true);
    expect(api.loadError).not.toBeNull();
    expect(api.isDataReady).toBe(false);

    await vi.advanceTimersByTimeAsync(500);

    expect(storageMock.saveWorkspaceName).not.toHaveBeenCalled();
    expect(storageMock.saveFolders).not.toHaveBeenCalled();
    expect(storageMock.saveNote).not.toHaveBeenCalled();
  });
});

describe('useNotes workspace name persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('restores a previously saved workspace name on bootstrap', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    storageMock.getWorkspaceName = vi.fn(async () => 'Imported Workspace');
    const harness = createEffectHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();

    for (let i = 0; i < 20 && !api.isLoaded; i += 1) {
      await Promise.resolve();
      harness.resetRender();
      api = useNotes();
    }

    expect(api.isDataReady).toBe(true);
    expect(api.workspaceName).toBe('Imported Workspace');
  });

  it('persists a user-renamed workspace name instead of resetting it', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();

    for (let i = 0; i < 20 && !api.isLoaded; i += 1) {
      await Promise.resolve();
      harness.resetRender();
      api = useNotes();
    }
    expect(api.isDataReady).toBe(true);

    api.setWorkspaceName('My Vault');
    harness.resetRender();
    api = useNotes();

    await vi.advanceTimersByTimeAsync(500);

    expect(api.workspaceName).toBe('My Vault');
    expect(storageMock.saveWorkspaceName).toHaveBeenCalledWith('My Vault');
  });
});

describe('useNotes debounceSave failure fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('preserves the edit as a snapshot when the primary note write fails', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    storageMock.saveNote = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    const api = useNotes();

    api.handleSaveNote(makeNote());
    await vi.advanceTimersByTimeAsync(500);

    expect(storageMock.saveNote).toHaveBeenCalledTimes(1);
    expect(storageMock.saveSnapshot).toHaveBeenCalledTimes(1);
    const snapshotCalls = storageMock.saveSnapshot.mock.calls as unknown as Array<[{ noteId: string; content: string }]>;
    const snapshot = snapshotCalls[0]?.[0] as { noteId: string; content: string };
    expect(snapshot.noteId).toBe('n1');
    expect(snapshot.content).toBe('Body');
  });
});

describe('useNotes handleUpdateNote link-index hot path', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('skips the link-index rebuild when a content edit leaves the wikilink set unchanged', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));
    vi.doMock('../../src/lib/noteUtils', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/lib/noteUtils')>();
      return {
        ...actual,
        recomputeLinkRefsForSubset: vi.fn(actual.recomputeLinkRefsForSubset),
      };
    });

    const { useNotes } = await import('../../src/hooks/useNotes');
    const noteUtils = await import('../../src/lib/noteUtils');
    const subsetSpy = noteUtils.recomputeLinkRefsForSubset as ReturnType<typeof vi.fn>;
    const api = useNotes();

    await api.handleImportData([makeNote()]);
    subsetSpy.mockClear();

    api.handleUpdateNote('n1', 'Body edited, still no links');
    expect(subsetSpy).not.toHaveBeenCalled();

    api.handleUpdateNote('n1', 'Body now links to [[Other]]');
    expect(subsetSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useNotes vault conflict acknowledgement', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('persists the exact clean Markdown baseline with the first dirty vault edit', async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness();
    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();
    const clean = {
      ...makeNote(),
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultPath: 'Note.md',
    };
    await api.handleImportData([clean], [], 'Vault', true);
    harness.resetRender();
    api = useNotes();
    storageMock.saveNote.mockClear();

    api.handleUpdateNote(clean.id, 'local edit');
    harness.resetRender();
    api = useNotes();
    await vi.advanceTimersByTimeAsync(500);

    const saveCalls = storageMock.saveNote.mock.calls as unknown as Array<[{
      vaultDirty?: boolean;
      vaultBaseText?: string;
    }]>;
    const saved = saveCalls.at(-1)?.[0];
    expect(saved?.vaultDirty).toBe(true);
    expect(saved?.vaultBaseText).toBe('Body');
  });

  it('persists an advanced landed baseline without replacing a newer local edit', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness({ deferState: true });
    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();
    const dirty = {
      ...makeNote(),
      content: 'version B',
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultDirty: true,
      vaultBaseText: 'version A',
      vaultPath: 'Note.md',
    };
    await api.handleImportData([dirty], [], 'Vault', true);
    harness.flushStateUpdates();
    harness.resetRender();
    api = useNotes();
    storageMock.saveNote.mockClear();

    // Queue C in React without committing the updater. The synchronous latest
    // ref must still let the B failure callback persist C/base=B.
    api.handleUpdateNote(dirty.id, 'version C');
    await api.advanceVaultNoteBaseline(dirty.id, 'version B');

    const saveCalls = storageMock.saveNote.mock.calls as unknown as Array<[{
      content: string;
      vaultBaseText?: string;
    }]>;
    expect(saveCalls.at(-1)?.[0]).toMatchObject({
      content: 'version C',
      vaultBaseText: 'version B',
    });
  });

  it('keeps a deferred task toggle when an earlier write advances the baseline', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness({ deferState: true });
    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();
    const dirty = {
      ...makeNote(),
      content: '- [ ] task',
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultDirty: true,
      vaultBaseText: 'version A',
      vaultPath: 'Note.md',
    };
    await api.handleImportData([dirty], [], 'Vault', true);
    harness.flushStateUpdates();
    harness.resetRender();
    api = useNotes();
    storageMock.saveNote.mockClear();

    const task = parseTasksFromNotes([dirty])[0];
    api.handleToggleTask(task);
    await api.advanceVaultNoteBaseline(dirty.id, dirty.content);

    const saveCalls = storageMock.saveNote.mock.calls as unknown as Array<[{
      content: string;
      vaultBaseText?: string;
    }]>;
    expect(saveCalls.at(-1)?.[0].content).toContain('- [x] task');
    expect(saveCalls.at(-1)?.[0].vaultBaseText).toBe(dirty.content);
  });

  it('keeps a deferred snapshot restore when an earlier write advances the baseline', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness({ deferState: true });
    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();
    const dirty = {
      ...makeNote(),
      content: 'version B',
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultDirty: true,
      vaultBaseText: 'version A',
      vaultPath: 'Note.md',
    };
    await api.handleImportData([dirty], [], 'Vault', true);
    harness.flushStateUpdates();
    harness.resetRender();
    api = useNotes();
    storageMock.saveNote.mockClear();

    await api.restoreSnapshot({
      noteId: dirty.id,
      content: 'version C from snapshot',
      title: dirty.title,
      savedAt: new Date().toISOString(),
    });
    await api.advanceVaultNoteBaseline(dirty.id, dirty.content);

    const saveCalls = storageMock.saveNote.mock.calls as unknown as Array<[{
      content: string;
      vaultBaseText?: string;
    }]>;
    expect(saveCalls.at(-1)?.[0]).toMatchObject({
      content: 'version C from snapshot',
      vaultBaseText: dirty.content,
    });
  });

  it('retains the confirmed exact baseline after a byte-preserving structural write', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness();
    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();
    const dirty = {
      ...makeNote(),
      title: 'Renamed',
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultDirty: true,
      vaultBaseText: '---\r\ntitle: Note\r\n---\r\nBody\r\n',
      vaultPath: 'Note.md',
    };
    await api.handleImportData([dirty], [], 'Vault', true);
    harness.resetRender();
    api = useNotes();
    storageMock.saveNote.mockClear();

    api.markVaultNotesSynced([{
      id: dirty.id,
      title: dirty.title,
      confirmedVaultBaseText: dirty.vaultBaseText,
    }]);

    const saveCalls = storageMock.saveNote.mock.calls as unknown as Array<[{
      vaultDirty?: boolean;
      vaultBaseText?: string;
    }]>;
    const saved = saveCalls.at(-1)?.[0];
    expect(saved?.vaultDirty).toBeUndefined();
    expect(saved?.vaultBaseText).toBe(dirty.vaultBaseText);
  });

  it('makes a conflict acknowledgement visible to an immediate authoritative import', async () => {
    vi.resetModules();

    const storageMock = baseStorageMock();
    const harness = createEffectHarness();
    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();
    const dirty = {
      ...makeNote(),
      content: 'preserved conflict copy',
      source: 'obsidian-import' as const,
      origin: 'vault' as const,
      vaultDirty: true,
      vaultBaseText: 'Body',
      vaultPath: 'Note.md',
    };
    await api.handleImportData([dirty], [], 'Vault', true);
    harness.resetRender();
    api = useNotes();

    api.markVaultNotesSynced([{ id: dirty.id, content: dirty.content }]);
    const authoritative = {
      ...dirty,
      content: 'external disk version',
      vaultDirty: undefined,
      vaultBaseText: undefined,
    };
    await api.handleImportData([authoritative], [], 'Vault', true);

    const calls = storageMock.saveNotes.mock.calls as unknown as Array<[Array<{
      id: string;
      content: string;
      vaultDirty?: boolean;
      vaultBaseText?: string;
    }>]>;
    const finalPersisted = calls.at(-1)?.[0]?.find((note) => note.id === dirty.id);
    expect(finalPersisted?.content).toBe('external disk version');
    expect(finalPersisted?.vaultDirty).toBeUndefined();
    expect(finalPersisted?.vaultBaseText).toBeUndefined();
  });
});

describe('useNotes clearWorkspaceAfterDisconnect attachment pruning', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('prunes blobs shared between deleted vault notes while keeping noa-note blobs', async () => {
    vi.resetModules();

    const attachment = (id: string, filename: string) => ({
      id,
      noteId: '',
      filename,
      mimeType: 'image/png',
      size: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const vaultNote = (id: string) => ({
      ...makeNote(),
      id,
      title: `Vault ${id}`,
      origin: 'vault' as const,
      source: 'obsidian-import' as const,
      vaultPath: `${id}.md`,
      attachments: [{ ...attachment('shared-blob', 'img.png'), noteId: id }],
    });
    const noaNote = {
      ...makeNote(),
      id: 'local1',
      title: 'Local',
      attachments: [{ ...attachment('kept-blob', 'keep.png'), noteId: 'local1' }],
    };

    const storageMock = baseStorageMock();
    storageMock.getNotes = vi.fn(async () => [vaultNote('v1'), vaultNote('v2'), noaNote]);
    // Simulate the pre-deletion-snapshot race: per-note blob deletion sees the
    // sibling vault note still referencing the shared blob and skips it.
    storageMock.deleteAttachmentBlobsByNoteId = vi.fn(async () => undefined);
    const harness = createEffectHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useNotes } = await import('../../src/hooks/useNotes');
    let api = useNotes();

    // Let the bootstrap loadData effect finish seeding notes state.
    for (let i = 0; i < 20 && !api.isLoaded; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      harness.resetRender();
      api = useNotes();
    }
    expect(api.isLoaded).toBe(true);
    expect(api.notes.map((n) => n.id).sort()).toEqual(['local1', 'v1', 'v2']);

    await api.clearWorkspaceAfterDisconnect();

    expect(storageMock.pruneOrphanedAttachments).toHaveBeenCalled();
    const pruneCalls = storageMock.pruneOrphanedAttachments.mock.calls as unknown as Array<[Set<string>]>;
    const validIds = pruneCalls.at(-1)?.[0] as Set<string>;
    expect(validIds.has('kept-blob')).toBe(true);
    expect(validIds.has('shared-blob')).toBe(false);
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
