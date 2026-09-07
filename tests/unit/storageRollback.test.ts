import { describe, expect, it } from 'vitest';
import { saveNotesBatch, storage } from '../../src/lib/storage';
import type { Note } from '../../src/types';

const makeNote = (id: string, content = 'body'): Note => ({
  id,
  title: `Note ${id}`,
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
});

function fakeStore(seed: Record<string, unknown> = {}, failOnSetKey?: string) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: async <T,>(key: string): Promise<T | null> =>
      map.has(key) ? (map.get(key) as T) : null,
    setItem: async <T,>(key: string, value: T): Promise<T> => {
      if (key === failOnSetKey) throw new Error('quota exceeded');
      map.set(key, value);
      return value;
    },
    removeItem: async (key: string): Promise<void> => {
      map.delete(key);
    },
  };
}

describe('saveNotesBatch rollback', () => {
  it('restores overwritten notes to their previous value when a later write fails', async () => {
    const previous = makeNote('n1', 'previous content');
    const store = fakeStore({ 'note:n1': previous }, 'note:n3');

    await expect(
      saveNotesBatch(store, [makeNote('n1', 'new content'), makeNote('n2'), makeNote('n3')]),
    ).rejects.toThrow(/rolled back/);

    // The pre-existing note must be restored, not deleted.
    expect(store.map.get('note:n1')).toEqual(previous);
    // The note that never existed before must be removed.
    expect(store.map.has('note:n2')).toBe(false);
    expect(store.map.has('note:n3')).toBe(false);
  });

  it('writes all notes when nothing fails', async () => {
    const store = fakeStore();

    await saveNotesBatch(store, [makeNote('n1'), makeNote('n2')]);

    expect(store.map.has('note:n1')).toBe(true);
    expect(store.map.has('note:n2')).toBe(true);
  });
});

describe('workspace replacement rollback', () => {
  it.each(['folders', 'delete', 'concurrent'])('restores notes and metadata when %s fails', async failure => {
    const notes = new Map([['old', makeNote('old', 'original')]]);
    let folders = [{ id: 'folder', name: 'Original' }];
    let name = 'Original';
    let failed = false;
    const service = {
      ...storage,
      getNotes: async () => [...notes.values()],
      getFolders: async () => folders,
      getWorkspaceName: async () => name,
      saveNotes: async (incoming: Note[]) => { incoming.forEach(n => notes.set(n.id, n)); },
      saveNote: async (n: Note) => { notes.set(n.id, n); },
      saveFolders: async (incoming: typeof folders) => {
        if (failure === 'folders' && !failed) { failed = true; throw new Error('write failed'); }
        folders = incoming;
      },
      saveWorkspaceName: async (value: string) => { name = value; },
      deleteNote: async (id: string) => {
        if (failure === 'delete' && !failed) { failed = true; throw new Error('delete failed'); }
        notes.delete(id);
      },
    };
    await expect(service.saveWorkspace([makeNote('new')], [], 'New', () => {
      if (failure === 'concurrent') throw new Error('concurrent edit');
    }, true)).rejects.toThrow();
    expect([...notes.values()]).toEqual([makeNote('old', 'original')]);
    expect(folders).toEqual([{ id: 'folder', name: 'Original' }]);
    expect(name).toBe('Original');
  });
});
