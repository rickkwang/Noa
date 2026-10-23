import { expect, it, vi } from 'vitest';
import type { VaultSyncedNoteExpectation, Note } from '../../src/types';
import { createMemRoot, readFileText } from './helpers/memfs';

it.each(['choice', 'reconnect'] as const)('finishes another in-flight save during conflict %s', async mode => {
  vi.resetModules();
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<() => unknown> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  vi.doMock('react', () => ({
    useState<T>(initial: T) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: T | ((previous: T) => T)) => {
        states[index] = typeof next === 'function'
          ? (next as (previous: T) => T)(states[index] as T) : next;
      }];
    },
    useRef<T>(initial: T) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useCallback<T>(callback: T) { return callback; },
    useEffect(callback: () => unknown) { effects[effectIndex++] = callback; },
  }));
  vi.doMock('../../src/lib/storage', () => ({ storage: {
    getVaultPendingOperations: async () => [],
    removeVaultPendingOperation: async () => {},
    listAttachmentBlobIds: async () => [],
  } }));
  const service = await vi.importActual<typeof import('../../src/services/fileSyncService')>('../../src/services/fileSyncService');
  vi.doMock('../../src/services/fileSyncService', () => ({ ...service,
    connectDirectory: async (handle: FileSystemDirectoryHandle) => handle,
  }));
  const { writeNote } = await import('../../src/lib/fileSystemStorage');
  const { useFileSync } = await import('../../src/hooks/useFileSync');
  const root = createMemRoot();
  const handle = root as unknown as FileSystemDirectoryHandle;
  const originalA: Note = { id: 'a', title: 'A', content: 'base a', origin: 'vault', source: 'obsidian-import',
    folder: '', tags: [], links: [], linkRefs: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const originalB = { ...originalA, id: 'b', title: 'B', content: 'base b' };
  await writeNote(handle, originalA, []);
  await writeNote(handle, originalB, []);
  const options = { isLoaded: true, notes: [originalA, originalB], folders: [], workspaceName: 'Test',
    onImportData: async () => {}, onVaultNotesSynced: (_expectations: VaultSyncedNoteExpectation[]) => {},
    onVaultNoteBaselineAdvanced: () => {} };
  const render = () => {
    stateIndex = refIndex = effectIndex = 0;
    const api = useFileSync(options);
    // Run ref updates only; bootstrap, polling, and UI timers are outside this scenario.
    effects[0](); effects[1]();
    return api;
  };
  let api = render();
  await api.connect(handle);
  const external = await (await root.getFileHandle('A.md')).createWritable();
  await external.write('external a'); await external.close();
  options.notes = [
    { ...originalA, content: 'local a', vaultDirty: true, vaultBaseText: 'base a' },
    { ...originalB, content: 'local b', vaultDirty: true, vaultBaseText: 'base b' },
  ];
  let releaseB!: () => void;
  const pendingB = new Promise<void>(resolve => { releaseB = resolve; });
  let signalB!: () => void;
  const startedB = new Promise<void>(resolve => { signalB = resolve; });
  const fileB = await root.getFileHandle('B.md');
  const createWritable = fileB.createWritable.bind(fileB);
  let firstWrite = true;
  fileB.createWritable = async () => {
    if (firstWrite) { firstWrite = false; signalB(); await pendingB; }
    return createWritable();
  };
  api = render();
  api.syncNoteOnUpdate('a', 'local a');
  api.syncNoteOnUpdate('b', 'local b');
  await startedB;
  await vi.waitFor(() => { api = render(); expect(api.editConflict?.pending).toBeDefined(); });
  const resolving = mode === 'choice' ? api.resolveEditConflict(true) : api.reconnect();
  releaseB();
  await resolving;
  api = render();
  if (mode === 'reconnect') {
    expect(api.editConflict?.pending).toBeDefined();
    await api.resolveEditConflict(true);
    api = render();
  }
  expect(await readFileText(root, 'A.md')).toBe('local a');
  expect(await readFileText(root, 'B.md')).toBe('local b');
  expect(api.editConflict).toBeNull();
  expect(api.syncStatus).toBe('ready');
  expect(api.vaultCacheReadOnly).toBe(false);
});
