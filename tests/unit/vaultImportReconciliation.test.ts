import { describe, expect, it } from 'vitest';
import {
  matchesVaultSyncedExpectation,
  reconcileConcurrentImportEdits,
} from '../../src/lib/vaultImportReconciliation';
import type { Note } from '../../src/types';

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Note',
  content: 'content',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  ...overrides,
});

describe('reconcileConcurrentImportEdits', () => {
  it('rebases a dirty vault edit over a stale authoritative scan', () => {
    const staleDisk = note({ content: 'stale disk', origin: 'vault' });
    const localEdit = note({ content: 'new local edit', origin: 'vault', vaultDirty: true });

    const result = reconcileConcurrentImportEdits([staleDisk], [localEdit], new Map(), true);

    expect(result).toEqual([localEdit]);
  });

  it('rescues a dirty vault row missing from the scan instead of pruning the edit', () => {
    const localEdit = note({ content: 'edited while file vanished', origin: 'vault', vaultDirty: true });

    const result = reconcileConcurrentImportEdits([], [localEdit], new Map(), true, [localEdit.id]);

    expect(result).toEqual([localEdit]);
  });

  it('still prunes a clean vault row deleted on disk', () => {
    const cleanCache = note({ origin: 'vault' });

    const result = reconcileConcurrentImportEdits([], [cleanCache], new Map(), true, [cleanCache.id]);

    expect(result).toEqual([]);
  });
});

describe('matchesVaultSyncedExpectation', () => {
  it('rejects an acknowledgement for an older content revision', () => {
    const current = note({ content: 'newer local edit', vaultDirty: true });

    expect(matchesVaultSyncedExpectation(current, {
      id: current.id,
      content: 'older disk write',
    })).toBe(false);
  });

  it('matches only the fields the disk operation actually wrote', () => {
    const current = note({ title: 'Renamed', content: 'local content', vaultDirty: true });

    expect(matchesVaultSyncedExpectation(current, {
      id: current.id,
      title: 'Renamed',
    })).toBe(true);
    expect(matchesVaultSyncedExpectation(current, {
      id: current.id,
      title: 'Old title',
    })).toBe(false);
  });
});
