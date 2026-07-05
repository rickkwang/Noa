import { describe, expect, it } from 'vitest';
import { mergeVaultNotes } from '../../src/services/fileSyncService';
import { Note } from '../../src/types';

const note = (overrides: Partial<Note>): Note => ({
  id: 'n1',
  title: 'A',
  content: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  ...overrides,
});

describe('mergeVaultNotes (newest wins)', () => {
  it('takes the disk version when the file mtime is newer', () => {
    const local = note({ id: 'n1', content: 'old', updatedAt: '2024-01-01T00:00:00.000Z', linkRefs: ['r1'] });
    const disk = note({ id: 'n1', content: 'external edit', updatedAt: '2024-01-02T00:00:00.000Z' });
    const { notes } = mergeVaultNotes([local], [disk], new Set(['n1']));
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('external edit');
    // Noa-owned linkRefs survive a disk takeover.
    expect(notes[0].linkRefs).toEqual(['r1']);
  });

  it('keeps the Noa version when its updatedAt is newer than the file mtime', () => {
    const local = note({ id: 'n1', content: 'noa edit', updatedAt: '2024-01-03T00:00:00.000Z' });
    const disk = note({ id: 'n1', content: 'stale disk', updatedAt: '2024-01-02T00:00:00.000Z' });
    const { notes } = mergeVaultNotes([local], [disk], new Set(['n1']));
    expect(notes[0].content).toBe('noa edit');
  });

  it('drops notes whose manifest-tracked file disappeared and reports them', () => {
    const local = note({ id: 'n1' });
    const { notes, deletedNoteIds } = mergeVaultNotes([local], [], new Set(['n1']));
    expect(notes).toHaveLength(0);
    expect(deletedNoteIds).toEqual(['n1']);
  });

  it('keeps notes never written to the vault (not in manifest)', () => {
    const local = note({ id: 'n1' });
    const { notes, deletedNoteIds } = mergeVaultNotes([local], [], new Set());
    expect(notes).toHaveLength(1);
    expect(deletedNoteIds).toEqual([]);
  });

  it('adds disk-only notes', () => {
    const disk = note({ id: 'n2', title: 'New on disk' });
    const { notes } = mergeVaultNotes([], [disk], new Set(['n2']));
    expect(notes.map(n => n.id)).toEqual(['n2']);
  });

  it('keeps the first occurrence when duplicate ids exist on disk', () => {
    const d1 = note({ id: 'n1', content: 'first', updatedAt: '2024-01-05T00:00:00.000Z' });
    const d2 = note({ id: 'n1', content: 'second', updatedAt: '2024-01-06T00:00:00.000Z' });
    const local = note({ id: 'n1', content: 'local', updatedAt: '2024-01-01T00:00:00.000Z' });
    const { notes } = mergeVaultNotes([local], [d1, d2], new Set(['n1']));
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('first');
  });
});
