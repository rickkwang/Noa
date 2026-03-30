import { describe, expect, it, vi } from 'vitest';
import { deleteNoteWithLocalFirst } from '../../src/lib/deleteFlow';

describe('deleteNoteWithLocalFirst', () => {
  it('runs local delete first, then closes tab and syncs', async () => {
    const calls: string[] = [];
    const deleteLocal = vi.fn(async () => {
      calls.push('deleteLocal');
      return true;
    });
    const closeTab = vi.fn((id: string) => {
      calls.push(`closeTab:${id}`);
    });
    const syncDelete = vi.fn((id: string) => {
      calls.push(`syncDelete:${id}`);
    });

    const result = await deleteNoteWithLocalFirst({
      id: 'note-1',
      deleteLocal,
      closeTab,
      syncDelete,
    });

    expect(result).toBe(true);
    expect(calls).toEqual(['deleteLocal', 'closeTab:note-1', 'syncDelete:note-1']);
  });

  it('does not close tab or sync when local delete fails', async () => {
    const deleteLocal = vi.fn(async () => false);
    const closeTab = vi.fn();
    const syncDelete = vi.fn();

    const result = await deleteNoteWithLocalFirst({
      id: 'note-2',
      deleteLocal,
      closeTab,
      syncDelete,
    });

    expect(result).toBe(false);
    expect(closeTab).not.toHaveBeenCalled();
    expect(syncDelete).not.toHaveBeenCalled();
  });
});
