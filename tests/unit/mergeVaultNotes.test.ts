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

describe('mergeVaultNotes (vault authoritative)', () => {
  it('takes the disk version even when the cached Noa version is newer', () => {
    const local = note({ id: 'n1', content: 'cached edit', updatedAt: '2024-01-03T00:00:00.000Z', linkRefs: ['r1'], origin: 'vault' });
    const disk = note({ id: 'n1', content: 'disk version', updatedAt: '2024-01-02T00:00:00.000Z', origin: 'vault' });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [local],
      [disk],
      new Set(),
      { mode: 'vault-authoritative' },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('disk version');
    expect(notes[0].linkRefs).toEqual(['r1']);
    expect(deletedNoteIds).toEqual([]);
  });

  it('keeps untracked local notes even when the vault is non-empty', () => {
    const local = note({ id: 'local-only', title: 'Cached' });
    const disk = note({ id: 'disk-only', title: 'Disk', origin: 'vault' });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [local],
      [disk],
      new Set(),
      { mode: 'vault-authoritative' },
    );

    expect(notes.map(n => n.id).sort()).toEqual(['disk-only', 'local-only']);
    expect(deletedNoteIds).toEqual([]);
  });

  it('keeps cached notes when connecting a fresh empty vault with no manifest', () => {
    const local = note({ id: 'local-only', title: 'Cached' });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [local],
      [],
      new Set(),
      { mode: 'vault-authoritative' },
    );

    expect(notes.map(n => n.id)).toEqual(['local-only']);
    expect(deletedNoteIds).toEqual([]);
  });

  it('drops manifest-tracked notes when their files were removed from disk', () => {
    const local = note({ id: 'n1', title: 'Deleted on disk', origin: 'vault' });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [local],
      [],
      new Set(['n1']),
      { mode: 'vault-authoritative' },
    );

    expect(notes).toEqual([]);
    expect(deletedNoteIds).toEqual(['n1']);
  });

  it('drops vault-origin cache rows even when the vault never had a manifest', () => {
    const cachedVaultNote = note({
      id: 'vault-only',
      title: 'Deleted before first Noa write',
      origin: 'vault',
      vaultPath: 'Deleted.md',
    });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [cachedVaultNote],
      [],
      new Set(),
      { mode: 'vault-authoritative' },
    );

    expect(notes).toEqual([]);
    expect(deletedNoteIds).toEqual(['vault-only']);
  });

  it('keeps one-time imports because source provenance is not vault ownership', () => {
    const importedLocalNote = note({
      id: 'one-time-import',
      source: 'obsidian-import',
      origin: undefined,
    });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [importedLocalNote],
      [],
      new Set(),
      { mode: 'vault-authoritative' },
    );

    expect(notes).toEqual([importedLocalNote]);
    expect(deletedNoteIds).toEqual([]);
  });

  it('keeps both domains when a scanned vault id collides with a Noa-owned note id', () => {
    const local = note({ id: 'shared-id', title: 'Private local note', content: 'local' });
    const disk = note({
      id: 'shared-id',
      title: 'Legacy copied vault note',
      content: 'disk',
      origin: 'vault',
      vaultPath: 'Legacy.md',
    });

    const first = mergeVaultNotes(
      [local],
      [disk],
      new Set(['shared-id']),
      { mode: 'vault-authoritative' },
    );

    expect(first.notes).toHaveLength(2);
    expect(first.notes).toContainEqual(local);
    const vaultCache = first.notes.find((item) => item.origin === 'vault');
    expect(vaultCache).toMatchObject({
      id: 'vault:shared-id',
      vaultId: 'shared-id',
      content: 'disk',
    });

    const second = mergeVaultNotes(
      first.notes,
      [disk],
      new Set(['shared-id']),
      { mode: 'vault-authoritative' },
    );
    expect(second.notes.find((item) => item.origin === 'vault')?.id).toBe('vault:shared-id');
  });
});

describe('mergeVaultNotes (vault authoritative) — unsynced local state', () => {
  const attachment = (overrides: Partial<import('../../src/types').Attachment> = {}) => ({
    id: 'att-1',
    noteId: 'n1',
    filename: 'img.png',
    mimeType: 'image/png',
    size: 10,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('keeps local notes the manifest never tracked (created in Noa, not yet on disk)', () => {
    const justCreated = note({ id: 'new-local', title: 'Daily note' });
    const disk = note({ id: 'disk-1', title: 'Disk', origin: 'vault' });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [justCreated],
      [disk],
      new Set(['disk-1']),
      { mode: 'vault-authoritative' },
    );

    expect(notes.map((n) => n.id).sort()).toEqual(['disk-1', 'new-local']);
    expect(deletedNoteIds).toEqual([]);
  });

  it('preserves a dirty vault row until its local write reaches disk', () => {
    const local = note({
      id: 'n1',
      content: 'new local edit',
      updatedAt: '2024-01-03T00:00:00.000Z',
      origin: 'vault',
      vaultDirty: true,
    });
    const staleDisk = note({
      id: 'n1',
      content: 'old disk content',
      updatedAt: '2024-01-02T00:00:00.000Z',
      origin: 'vault',
    });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [local],
      [staleDisk],
      new Set(['n1']),
      { mode: 'vault-authoritative' },
    );

    expect(notes).toEqual([local]);
    expect(deletedNoteIds).toEqual([]);
  });

  it('does not delete a dirty vault row when a failed move left its file temporarily missing', () => {
    const local = note({
      id: 'n1',
      title: 'Moved locally',
      origin: 'vault',
      vaultPath: 'Old/Moved locally.md',
      vaultDirty: true,
    });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [local],
      [],
      new Set(['n1']),
      { mode: 'vault-authoritative' },
    );

    expect(notes).toEqual([local]);
    expect(deletedNoteIds).toEqual([]);
  });

  it('still drops manifest-tracked notes whose files were removed from a non-empty vault', () => {
    const trackedGone = note({ id: 'tracked', title: 'Deleted in Obsidian', origin: 'vault' });
    const disk = note({ id: 'disk-1', title: 'Disk', origin: 'vault' });

    const { notes, deletedNoteIds } = mergeVaultNotes(
      [trackedGone],
      [disk],
      new Set(['tracked', 'disk-1']),
      { mode: 'vault-authoritative' },
    );

    expect(notes.map((n) => n.id)).toEqual(['disk-1']);
    expect(deletedNoteIds).toEqual(['tracked']);
  });

  it('preserves local attachments that have not reached the vault yet', () => {
    const syncedOnDisk = attachment({ id: 'att-synced', vaultPath: 'attachments/n1/att-synced-img.png' });
    const pendingLocal = attachment({ id: 'att-pending', filename: 'new.png' });
    const local = note({ id: 'n1', attachments: [syncedOnDisk, pendingLocal], origin: 'vault' });
    const disk = note({ id: 'n1', attachments: [syncedOnDisk], origin: 'vault' });

    const { notes } = mergeVaultNotes([local], [disk], new Set(['n1']), { mode: 'vault-authoritative' });

    expect(notes[0].attachments?.map((a) => a.id).sort()).toEqual(['att-pending', 'att-synced']);
  });

  it('drops local attachments that were synced before but disappeared from disk', () => {
    const removedOnDisk = attachment({ id: 'att-removed', vaultPath: 'attachments/n1/att-removed-img.png' });
    const local = note({ id: 'n1', attachments: [removedOnDisk], origin: 'vault' });
    const disk = note({ id: 'n1', attachments: [], origin: 'vault' });

    const { notes } = mergeVaultNotes([local], [disk], new Set(['n1']), { mode: 'vault-authoritative' });

    expect(notes[0].attachments ?? []).toEqual([]);
  });
});
