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
