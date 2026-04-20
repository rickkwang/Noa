import { describe, expect, it, vi } from 'vitest';
import { buildBackupFilename, pruneOldBackups, shouldRunAutoBackup } from '../../src/services/autoBackupService';

describe('shouldRunAutoBackup', () => {
  const now = Date.parse('2026-04-20T12:00:00.000Z');

  it('returns true when no prior backup recorded', () => {
    expect(shouldRunAutoBackup(null, now)).toBe(true);
  });

  it('returns true when stored timestamp is unparseable', () => {
    expect(shouldRunAutoBackup('not-a-date', now)).toBe(true);
  });

  it('returns false when last backup was under 24h ago', () => {
    const last = new Date(now - 23 * 60 * 60 * 1000).toISOString();
    expect(shouldRunAutoBackup(last, now)).toBe(false);
  });

  it('returns true at the 24h boundary', () => {
    const last = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunAutoBackup(last, now)).toBe(true);
  });

  it('returns true when last backup was days ago', () => {
    const last = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunAutoBackup(last, now)).toBe(true);
  });
});

describe('buildBackupFilename', () => {
  it('formats filename with zero-padded date/time and sorts chronologically', () => {
    const early = buildBackupFilename(new Date(2026, 2, 5, 9, 3)); // Mar 5 09:03 local
    const later = buildBackupFilename(new Date(2026, 2, 5, 14, 30));
    const nextDay = buildBackupFilename(new Date(2026, 2, 6, 1, 15));
    expect(early).toBe('noa-backup-2026-03-05-0903.json');
    expect(later).toBe('noa-backup-2026-03-05-1430.json');
    expect(nextDay).toBe('noa-backup-2026-03-06-0115.json');
    const sorted = [nextDay, early, later].slice().sort();
    expect(sorted).toEqual([early, later, nextDay]);
  });
});

function fakeDirHandle(filenames: string[]) {
  const removed: string[] = [];
  const entries = filenames.map((name) => [name, { kind: 'file' as const }]);
  return {
    removed,
    handle: {
      kind: 'directory' as const,
      async *entries() {
        for (const e of entries) yield e as [string, { kind: 'file' }];
      },
      removeEntry: vi.fn(async (name: string) => {
        removed.push(name);
      }),
    } as unknown as FileSystemDirectoryHandle,
  };
}

describe('pruneOldBackups', () => {
  it('keeps the N most recent files by lexicographic name, deletes the rest', async () => {
    const names = [
      'noa-backup-2026-04-10-0800.json',
      'noa-backup-2026-04-11-0800.json',
      'noa-backup-2026-04-12-0800.json',
      'noa-backup-2026-04-13-0800.json',
      'noa-backup-2026-04-14-0800.json',
      'noa-backup-2026-04-15-0800.json',
      'noa-backup-2026-04-16-0800.json',
      'noa-backup-2026-04-17-0800.json',
      'noa-backup-2026-04-18-0800.json',
    ];
    const { handle, removed } = fakeDirHandle(names);
    const result = await pruneOldBackups(handle, 7);
    expect(result).toEqual({ deleted: 2, failed: 0 });
    expect(removed.sort()).toEqual([
      'noa-backup-2026-04-10-0800.json',
      'noa-backup-2026-04-11-0800.json',
    ]);
  });

  it('ignores non-backup files', async () => {
    const { handle, removed } = fakeDirHandle([
      'noa-backup-2026-04-18-0800.json',
      'README.md',
      'other-file.json',
    ]);
    const result = await pruneOldBackups(handle, 7);
    expect(result).toEqual({ deleted: 0, failed: 0 });
    expect(removed).toEqual([]);
  });

  it('tolerates individual removeEntry failures via allSettled', async () => {
    const names = [
      'noa-backup-2026-04-10-0800.json',
      'noa-backup-2026-04-11-0800.json',
      'noa-backup-2026-04-12-0800.json',
      'noa-backup-2026-04-13-0800.json',
      'noa-backup-2026-04-14-0800.json',
      'noa-backup-2026-04-15-0800.json',
      'noa-backup-2026-04-16-0800.json',
      'noa-backup-2026-04-17-0800.json',
      'noa-backup-2026-04-18-0800.json',
    ];
    const entries = names.map((name) => [name, { kind: 'file' as const }]);
    let callCount = 0;
    const handle = {
      async *entries() {
        for (const e of entries) yield e as [string, { kind: 'file' }];
      },
      removeEntry: vi.fn(async (_name: string) => {
        callCount += 1;
        if (callCount === 1) throw new Error('permission lost');
      }),
    } as unknown as FileSystemDirectoryHandle;
    const result = await pruneOldBackups(handle, 7);
    expect(result.deleted + result.failed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('returns zero when nothing to prune', async () => {
    const { handle } = fakeDirHandle([
      'noa-backup-2026-04-17-0800.json',
      'noa-backup-2026-04-18-0800.json',
    ]);
    const result = await pruneOldBackups(handle, 7);
    expect(result).toEqual({ deleted: 0, failed: 0 });
  });
});
