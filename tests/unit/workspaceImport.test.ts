import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../src/types';

const note = (id: string, content = id): Note => ({ id, content, title: id, folder: '', tags: [], links: [], linkRefs: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });

async function setup() {
  const notesRef = { current: [note('old')] };
  const deferredSavesRef = { current: new Map<string, Note>() };
  const isImportingRef = { current: false };
  const blobs = new Map<string, Blob>();
  const storage = {
    listAttachmentBlobIds: vi.fn(async () => [...blobs.keys()]),
    saveAttachmentBlob: vi.fn(async (id: string, value: Blob) => { blobs.set(id, value); }),
    getAttachmentBlob: vi.fn(async (id: string) => blobs.get(id) ?? null),
    deleteAttachmentBlob: vi.fn(async (id: string) => { blobs.delete(id); }),
    saveNotes: vi.fn(async (_notes: Note[]) => {}),
    saveNote: vi.fn(async (_note: Note) => {}),
    saveWorkspace: vi.fn(async (_notes: Note[], _folders: unknown, _name: unknown, check?: () => void) => { await storage.saveNotes(_notes); check?.(); }),
    saveFolders: vi.fn(async () => {}), saveWorkspaceName: vi.fn(async () => {}),
    pruneOrphanedNotes: vi.fn(async () => {}), pruneOrphanedAttachments: vi.fn(async () => {}),
  };
  vi.doMock('react', () => ({ useCallback: (fn: unknown) => fn }));
  vi.doMock('../../src/lib/storage', () => ({ storage }));
  const { useNoteImport } = await import('../../src/hooks/useNoteImport');
  const setNotes = vi.fn();
  const onWorkspaceReplaced = vi.fn();
  const { handleImportData } = useNoteImport({ notesRef, deferredSavesRef, isImportingRef, setNotes,
    setFolders: vi.fn(), setWorkspaceName: vi.fn(), setSaveError: vi.fn(), setLoadError: vi.fn(),
    syncLinkRefs: ns => ns, flushAllPendingSaves: async () => {}, onWorkspaceReplaced });
  return { handleImportData, storage, blobs, setNotes, notesRef, deferredSavesRef, isImportingRef, onWorkspaceReplaced };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

describe('workspace replacement versus vault reconciliation', () => {
  it.each([{ incoming: [] }, { incoming: [note('new')] }])('replaces all old data with the requested workspace: %j', async ({ incoming }) => {
    const h = await setup();
    await h.handleImportData(incoming, [], 'New', true);
    expect(h.storage.saveWorkspace.mock.calls[0][0].map(n => n.id)).toEqual(incoming.map(n => n.id));
    expect(h.notesRef.current.map(n => n.id)).toEqual(incoming.map(n => n.id));
    expect(h.onWorkspaceReplaced).toHaveBeenCalledOnce();
  });

  it('still rescues local notes during an authoritative vault scan', async () => {
    const h = await setup();
    await h.handleImportData([], [], 'Vault', true, [], 'vault');
    expect(h.storage.saveNotes.mock.calls[0][0].map(n => n.id)).toEqual(['old']);
    expect(h.storage.saveWorkspace).toHaveBeenCalled();
    expect(h.onWorkspaceReplaced).not.toHaveBeenCalled();
  });

  it('aborts replacement when edits arrive during its writes, then flushes those edits', async () => {
    const h = await setup();
    h.storage.saveWorkspace.mockImplementationOnce(async (_n, _f, _name, check) => {
      h.deferredSavesRef.current.set('old', note('old', 'concurrent edit'));
      check?.();
    });
    await expect(h.handleImportData([], [], 'New', true)).rejects.toThrow('Notes changed');
    expect(h.storage.saveNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'old', content: 'concurrent edit' }));
    expect(h.onWorkspaceReplaced).not.toHaveBeenCalled();
    expect(h.isImportingRef.current).toBe(false);
  });
});

describe('attachment import rollback', () => {
  it('rejects one failed Blob, removes successes in the same batch, and leaves notes untouched', async () => {
    const h = await setup();
    h.blobs.set('existing', new Blob(['old']));
    h.storage.saveAttachmentBlob.mockImplementation(async (id, blob) => {
      if (id === 'bad') throw new Error('disk full');
      h.blobs.set(id, blob);
    });
    const incoming = { ...note('incoming'), attachments: ['good', 'bad', 'later'].map(id => ({ id,
      noteId: 'incoming', filename: `${id}.png`, mimeType: 'image/png', size: 3,
      createdAt: '2026-01-01T00:00:00Z', dataBase64: 'YWJj' })) };
    await expect(h.handleImportData([incoming])).rejects.toThrow('disk full');
    expect([...h.blobs.keys()]).toEqual(['existing']);
    expect(h.storage.saveNotes).not.toHaveBeenCalled();
    expect(h.setNotes).not.toHaveBeenCalled();
    expect(h.isImportingRef.current).toBe(false);
  });
});

it('restores an overwritten attachment ID when a later attachment fails', async () => {
  const h = await setup();
  h.blobs.set('existing', new Blob(['original']));
  h.storage.saveAttachmentBlob.mockImplementation(async (id, blob) => {
    if (id === 'bad') throw new Error('disk full');
    h.blobs.set(id, blob);
  });
  const incoming = { ...note('incoming'), attachments: ['existing', 'bad'].map(id => ({ id,
    noteId: 'incoming', filename: `${id}.png`, mimeType: 'image/png', size: 3,
    createdAt: '2026-01-01T00:00:00Z', dataBase64: 'YWJj' })) };
  await expect(h.handleImportData([incoming])).rejects.toThrow('disk full');
  expect(await h.blobs.get('existing')?.text()).toBe('original');
  expect(h.storage.saveNotes).not.toHaveBeenCalled();
});

it('does not release the import lock while an uncancellable replacement is still pending', async () => {
  vi.useFakeTimers();
  try {
    const h = await setup();
    let release!: () => void;
    h.storage.saveWorkspace.mockImplementationOnce(async (_n, _f, _name, check) => {
      await new Promise<void>(resolve => { release = resolve; });
      check?.();
    });
    const importing = h.handleImportData([], [], 'New', true).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(h.isImportingRef.current).toBe(true);
    h.deferredSavesRef.current.set('old', note('old', 'edit while storage was stalled'));
    release();
    expect(await importing).toBeInstanceOf(Error);
    expect(h.storage.saveNote).toHaveBeenCalledWith(expect.objectContaining({ content: 'edit while storage was stalled' }));
    expect(h.onWorkspaceReplaced).not.toHaveBeenCalled();
    expect(h.isImportingRef.current).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('drains edits that arrive while an earlier deferred edit is being saved', async () => {
  const h = await setup();
  h.storage.saveNotes.mockImplementationOnce(async () => {
    h.deferredSavesRef.current.set('old', note('old', 'first edit'));
  });
  h.storage.saveNote.mockImplementationOnce(async () => {
    h.deferredSavesRef.current.set('old', note('old', 'second edit while draining'));
  });
  await h.handleImportData([note('old')]);
  expect(h.storage.saveNote.mock.calls.map(([n]) => n.content)).toEqual(['first edit', 'second edit while draining']);
  expect(h.deferredSavesRef.current.size).toBe(0);
  expect(h.isImportingRef.current).toBe(false);
});
