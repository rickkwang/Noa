import { beforeEach, describe, expect, it, vi } from 'vitest';

function createReactHarness() {
  const states: any[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<() => void | (() => void)> = [];
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
      useEffect(effect: () => void | (() => void)) {
        effects.push(effect);
      },
      useCallback<T extends (...args: any[]) => any>(fn: T) {
        return fn;
      },
    },
    effects,
    resetRender() {
      stateIndex = 0;
      refIndex = 0;
      effects.length = 0;
    },
  };
}

describe('useAttachments URL lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('revokes the previous object URL when the active note changes', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:url-1');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const storageMock = {
      getAttachmentBlob: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
      saveAttachmentBlob: vi.fn(async () => undefined),
      deleteAttachmentBlob: vi.fn(async () => undefined),
    };
    const harness = createReactHarness();

    vi.doMock('react', () => harness.react);
    vi.doMock('../../src/lib/storage', () => ({ storage: storageMock }));

    const { useAttachments } = await import('../../src/hooks/useAttachments');

    const attachment = {
      id: 'att-1',
      noteId: 'n1',
      filename: 'one.png',
      mimeType: 'image/png',
      size: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const noteA = {
      id: 'n1',
      title: 'A',
      content: '',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      folder: '',
      tags: [],
      links: [],
      attachments: [attachment],
    };
    const noteB = {
      ...noteA,
      id: 'n2',
      title: 'B',
      attachments: [],
    };

    harness.resetRender();
    useAttachments(noteA, vi.fn());
    harness.effects[0]?.();
    const firstLoadResult = harness.effects[1]?.();
    await firstLoadResult;
    await Promise.resolve();
    await Promise.resolve();

    harness.resetRender();
    useAttachments(noteB, vi.fn());
    harness.effects[0]?.();
    harness.effects[1]?.();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-1');
  });
});
