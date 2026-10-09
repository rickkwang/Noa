import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../src/constants/storageKeys';
import {
  StorageStalledError,
  clearRescuedNotes,
  mergeRescuedNotes,
  parkRescuedNotes,
  peekRescuedNotes,
  unparkRescuedNote,
  withTimeout,
} from '../../src/lib/importRescue';
import type { Note } from '../../src/types';

function makeNote(id: string, content = 'body', updatedAt = '2026-01-02T00:00:00.000Z'): Note {
  return {
    id,
    title: `Note ${id}`,
    content,
    folder: '',
    tags: [],
    links: [],
    linkRefs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

// Node has no localStorage; install a stand-in so the real safeLocalStorage path runs, not its fallback.
let store: Map<string, string>;
let failWrites = false;

beforeEach(() => {
  store = new Map();
  failWrites = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('QuotaExceededError');
        store.set(key, value);
      },
      removeItem: (key: string) => { store.delete(key); },
    },
  });
});

describe('withTimeout', () => {
  it('passes through a promise that settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 'test', 1000)).resolves.toBe('ok');
  });

  it('propagates the original rejection rather than masking it', async () => {
    const boom = new Error('quota exceeded');
    await expect(withTimeout(Promise.reject(boom), 'test', 1000)).rejects.toBe(boom);
  });

  it('rejects when the promise never settles, so catch/finally can run', async () => {
    vi.useFakeTimers();
    try {
      // A never-settling await skips catch and finally, stranding the import lock.
      const pending = withTimeout(new Promise<void>(() => {}), 'saveNotes', 60_000);
      const assertion = expect(pending).rejects.toBeInstanceOf(StorageStalledError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parkRescuedNotes / peekRescuedNotes', () => {
  it('round-trips parked notes without consuming them', () => {
    expect(parkRescuedNotes([makeNote('a')])).toBe(true);
    expect(peekRescuedNotes().map((n) => n.id)).toEqual(['a']);
    // Peek must be non-destructive, or a failed write-back loses them.
    expect(peekRescuedNotes().map((n) => n.id)).toEqual(['a']);
    clearRescuedNotes();
    expect(peekRescuedNotes()).toEqual([]);
  });

  it('supersedes an earlier parked copy of the same note', () => {
    parkRescuedNotes([makeNote('a', 'first')]);
    parkRescuedNotes([makeNote('a', 'second'), makeNote('b')]);
    const parked = peekRescuedNotes();
    expect(parked).toHaveLength(2);
    expect(parked.find((n) => n.id === 'a')?.content).toBe('second');
  });

  it('reports failure when localStorage refuses the write', () => {
    failWrites = true;
    // A false negative here is silent data loss: the caller escalates to "copy your text out now".
    expect(parkRescuedNotes([makeNote('a')])).toBe(false);
  });

  it('ignores malformed parked payloads', () => {
    store.set(STORAGE_KEYS.RESCUED_IMPORT_EDITS, '{ not json');
    expect(peekRescuedNotes()).toEqual([]);
    store.set(STORAGE_KEYS.RESCUED_IMPORT_EDITS, JSON.stringify([null, 42, { id: 'a' }]));
    expect(peekRescuedNotes().map((n) => n.id)).toEqual(['a']);
  });
});

describe('mergeRescuedNotes', () => {
  it('lets a newer rescued edit win over the stored copy', () => {
    const merged = mergeRescuedNotes(
      [makeNote('a', 'stored'), makeNote('b', 'stored')],
      [makeNote('a', 'rescued', '2026-01-03T00:00:00.000Z')],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((n) => n.id === 'a')?.content).toBe('rescued');
    expect(merged.find((n) => n.id === 'b')?.content).toBe('stored');
  });

  it('keeps the stored copy when it accepted newer writes after the edit was parked', () => {
    // A stale parked copy must not clobber a newer version that landed after recovery.
    const merged = mergeRescuedNotes(
      [makeNote('a', 'stored-newer', '2026-01-03T00:00:00.000Z')],
      [makeNote('a', 'rescued-stale')],
    );
    expect(merged.find((n) => n.id === 'a')?.content).toBe('stored-newer');
  });

  it('appends a rescued note whose stored copy is gone rather than dropping it', () => {
    const merged = mergeRescuedNotes([makeNote('a')], [makeNote('deleted-by-import', 'typed text')]);
    expect(merged.map((n) => n.id)).toEqual(['a', 'deleted-by-import']);
  });

  it('preserves the loaded order and returns the input when nothing was rescued', () => {
    const loaded = [makeNote('a'), makeNote('b')];
    expect(mergeRescuedNotes(loaded, [])).toBe(loaded);
  });
});

describe('unparkRescuedNote', () => {
  it('removes only the named note from the parking lot', () => {
    parkRescuedNotes([makeNote('a'), makeNote('b')]);
    unparkRescuedNote('a');
    expect(peekRescuedNotes().map((n) => n.id)).toEqual(['b']);
  });

  it('is a no-op on an empty parking lot', () => {
    unparkRescuedNote('a');
    expect(peekRescuedNotes()).toEqual([]);
  });
});
