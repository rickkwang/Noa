import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder, Note, VaultPendingOperation } from '../../src/types';

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

const vaultFolder: Folder = { id: 'vf-1', name: 'notes', origin: 'vault' };

function makeVaultNote(id: string): Note {
  return {
    id,
    title: id,
    content: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    folder: vaultFolder.id,
    origin: 'vault',
    tags: [],
    links: [],
    linkRefs: [],
  };
}

function makeLocalNote(id: string): Note {
  return { ...makeVaultNote(id), origin: undefined, folder: '' };
}

/** Async work here is a promise chain with no timers; a macrotask drains it. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(notes: Note[], overrides: Record<string, unknown> = {}) {
  vi.resetModules();
  const harness = createReactHarness();
  vi.doMock('react', () => harness.react);

  const spies = {
    setSaveError: vi.fn((_message: string) => {}),
    closeTabById: vi.fn((_id: string) => {}),
    blockVaultCacheWrite: vi.fn((_isVaultOwned: boolean) => false),
    deleteLocal: vi.fn(async (_id: string) => true),
    isVaultEntityOperationPending: vi.fn((_entityKey: string) => false),
    reserveVaultStructuralOperation: vi.fn((_entityKey: string) => true),
    releaseVaultStructuralOperation: vi.fn((_entityKey: string) => {}),
    prepareVaultStructuralOperations: vi.fn(async (_operations: readonly VaultPendingOperation[]) => undefined),
    cancelVaultStructuralOperations: vi.fn(async (_operations: readonly VaultPendingOperation[]) => undefined),
    syncNoteOnDelete: vi.fn((_note: Note, _operation?: VaultPendingOperation) => {}),
    syncFolderOnRename: vi.fn(),
    syncFolderOnDelete: vi.fn(),
    ...overrides,
  };

  const { useVaultOperations } = await import('../../src/hooks/useVaultOperations');
  const api = useVaultOperations({
    isDataReady: true,
    notes,
    folders: [vaultFolder],
    setSaveError: spies.setSaveError,
    closeTabById: spies.closeTabById,
    blockVaultCacheWrite: spies.blockVaultCacheWrite,
    handleDeleteNote: spies.deleteLocal,
    handleRenameFolder: vi.fn(async () => undefined),
    handleDeleteFolder: vi.fn(async () => ({ deletedNoteIds: [], foldersDeleted: false })),
    clearWorkspaceAfterDisconnect: vi.fn(async () => []),
    isVaultEntityOperationPending: spies.isVaultEntityOperationPending,
    reserveVaultStructuralOperation: spies.reserveVaultStructuralOperation,
    releaseVaultStructuralOperation: spies.releaseVaultStructuralOperation,
    prepareVaultStructuralOperations: spies.prepareVaultStructuralOperations,
    cancelVaultStructuralOperations: spies.cancelVaultStructuralOperations,
    hasPendingStructuralOperations: false,
    beginDisconnect: vi.fn(),
    cancelDisconnect: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    syncNoteOnDelete: spies.syncNoteOnDelete,
    syncFolderOnRename: spies.syncFolderOnRename,
    syncFolderOnDelete: spies.syncFolderOnDelete,
  });
  return { api: api as ReturnType<typeof useVaultOperations>, spies };
}

describe('useVaultOperations.handleDeleteNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reserves the batch before waiting for journal storage', async () => {
    let release!: () => void;
    const prepared = new Promise<void>((resolve) => { release = resolve; });
    const { api, spies } = await setup([makeVaultNote('n1'), makeVaultNote('n2')], {
      prepareVaultStructuralOperations: vi.fn(() => prepared),
    });
    const deleting = api.handleDeleteNotes(['n1', 'n2']);
    expect(spies.reserveVaultStructuralOperation).toHaveBeenCalledWith('delete-notes:n1');
    expect(spies.deleteLocal).not.toHaveBeenCalled();
    release();
    await deleting;
    expect(spies.deleteLocal).toHaveBeenCalledTimes(2);
  });

  it('does not prepare or delete when another structural operation owns the reservation', async () => {
    const { api, spies } = await setup([makeVaultNote('n1')], {
      reserveVaultStructuralOperation: vi.fn(() => false),
    });
    await api.handleDeleteNotes(['n1']);
    expect(spies.prepareVaultStructuralOperations).not.toHaveBeenCalled();
    expect(spies.deleteLocal).not.toHaveBeenCalled();
  });

  it('resolves only after local deletion and returns only successfully deleted notes', async () => {
    let release!: (deleted: boolean) => void;
    const deleting = new Promise<boolean>((resolve) => { release = resolve; });
    const note = makeLocalNote('n1');
    const { api } = await setup([note], { deleteLocal: vi.fn(() => deleting) });
    let finished = false;
    const result = Promise.resolve(api.handleDeleteNote('n1')).then((notes) => { finished = true; return notes; });
    await flush();
    expect(finished).toBe(false);
    release(true);
    expect(await result).toEqual([note]);

    const failed = await setup([note], { deleteLocal: vi.fn(async () => false) });
    expect(await failed.api.handleDeleteNotes(['n1'])).toEqual([]);
  });

  it('blocks a folder rename that would break an existing vault path link', async () => {
    const target = makeVaultNote('n1');
    const source = { ...makeVaultNote('source'), folder: '', content: '[[notes/n1]]', links: ['notes/n1'] };
    const { api, spies } = await setup([target, source]);
    api.handleRenameFolder('vf-1', 'archive');
    await flush();
    expect(spies.prepareVaultStructuralOperations).not.toHaveBeenCalled();
    expect(spies.syncFolderOnRename).not.toHaveBeenCalled();
    expect(spies.setSaveError).toHaveBeenCalledWith(expect.stringContaining('break existing vault links'));
  });

  it('prepares every vault note in one batch instead of blocking on the first reservation', async () => {
    const first = makeVaultNote('n1');
    const second = makeVaultNote('n2');
    const { api, spies } = await setup([first, second]);

    api.handleDeleteNotes([first.id, second.id]);
    await flush();

    expect(spies.prepareVaultStructuralOperations).toHaveBeenCalledTimes(1);
    const prepared = spies.prepareVaultStructuralOperations.mock.calls[0][0] as ReadonlyArray<{ entityKey: string; kind: string }>;
    expect(prepared).toHaveLength(2);
    expect(prepared.map((operation) => operation.entityKey).sort()).toEqual(['note:n1', 'note:n2']);
    expect(spies.deleteLocal.mock.calls.map(([id]) => id)).toEqual(['n1', 'n2']);
    expect(spies.closeTabById.mock.calls.map(([id]) => id)).toEqual(['n1', 'n2']);
    expect(spies.syncNoteOnDelete).toHaveBeenCalledTimes(2);
    expect(spies.cancelVaultStructuralOperations).not.toHaveBeenCalled();
    expect(spies.setSaveError).not.toHaveBeenCalled();
  });

  it('still refuses the whole batch when one note already has a pending operation', async () => {
    const first = makeVaultNote('n1');
    const second = makeVaultNote('n2');
    const { api, spies } = await setup([first, second], {
      isVaultEntityOperationPending: vi.fn((key: string) => key === 'note:n2'),
    });

    api.handleDeleteNotes([first.id, second.id]);
    await flush();

    expect(spies.prepareVaultStructuralOperations).not.toHaveBeenCalled();
    expect(spies.deleteLocal).not.toHaveBeenCalled();
    expect(spies.setSaveError).toHaveBeenCalledWith(
      'A vault file operation is still pending for this item. Retry sync before changing it again.',
    );
  });

  it('does not touch the disk when the vault cache is read-only', async () => {
    const first = makeVaultNote('n1');
    const { api, spies } = await setup([first], { blockVaultCacheWrite: vi.fn(() => true) });

    api.handleDeleteNotes([first.id]);
    await flush();

    expect(spies.prepareVaultStructuralOperations).not.toHaveBeenCalled();
    expect(spies.deleteLocal).not.toHaveBeenCalled();
    expect(spies.syncNoteOnDelete).not.toHaveBeenCalled();
  });

  it('deletes local notes without preparing vault operations', async () => {
    const first = makeLocalNote('n1');
    const second = makeLocalNote('n2');
    const { api, spies } = await setup([first, second]);

    api.handleDeleteNotes([first.id, second.id]);
    await flush();

    expect(spies.deleteLocal.mock.calls.map(([id]) => id)).toEqual(['n1', 'n2']);
    expect(spies.closeTabById).toHaveBeenCalledTimes(2);
    expect(spies.prepareVaultStructuralOperations).not.toHaveBeenCalled();
    expect(spies.syncNoteOnDelete).not.toHaveBeenCalled();
  });

  it('cancels the prepared operations when preparation fails', async () => {
    const first = makeVaultNote('n1');
    const second = makeVaultNote('n2');
    const { api, spies } = await setup([first, second], {
      prepareVaultStructuralOperations: vi.fn(async () => { throw new Error('disk full'); }),
    });

    api.handleDeleteNotes([first.id, second.id]);
    await flush();

    expect(spies.deleteLocal).not.toHaveBeenCalled();
    expect(spies.cancelVaultStructuralOperations).toHaveBeenCalledTimes(1);
    const canceled = spies.cancelVaultStructuralOperations.mock.calls[0][0] as unknown[];
    expect(canceled).toHaveLength(2);
    expect(spies.setSaveError).toHaveBeenCalledWith('disk full');
  });
});
