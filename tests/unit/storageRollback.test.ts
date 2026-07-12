import { describe, expect, it } from 'vitest';
import { saveNotesBatch } from '../../src/lib/storage';
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
