import { describe, expect, it, vi } from 'vitest';
import {
  assessSyncWatchdog,
  getSyncFailureMessage,
  settleDurableVaultConflict,
  shouldAutoRetrySyncFailure,
  shouldLockVaultCache,
} from '../../src/hooks/useFileSync';
import { storage } from '../../src/lib/storage';
import { VaultWriteConflictError } from '../../src/services/fileSyncService';
import type { VaultPendingOperation } from '../../src/types';

const readyState = {
  isLoaded: true,
  vaultHydrationPending: false,
  hasFsHandle: true,
  vaultHydrated: true,
  hasSyncError: false,
  hasVaultOwnedData: true,
};

describe('shouldLockVaultCache', () => {
  it('keeps orphaned vault cache rows read-only when the directory handle is unavailable', () => {
    expect(shouldLockVaultCache({
      ...readyState,
      hasFsHandle: false,
    })).toBe(true);
  });

  it('does not lock a normal local-only workspace without a directory handle', () => {
    expect(shouldLockVaultCache({
      ...readyState,
      hasFsHandle: false,
      hasVaultOwnedData: false,
    })).toBe(false);
  });

  it('locks a connected vault while hydration is pending or failed', () => {
    expect(shouldLockVaultCache({
      ...readyState,
      vaultHydrationPending: true,
    })).toBe(true);
    expect(shouldLockVaultCache({
      ...readyState,
      hasSyncError: true,
    })).toBe(true);
  });
});

describe('assessSyncWatchdog', () => {
  const idle = {
    trackedOperationCount: 0,
    authoritativeWorkCount: 0,
    pendingStructuralOperations: false,
  };

  it('waits while tracked operations or authoritative scans are in flight', () => {
    expect(assessSyncWatchdog({ ...idle, trackedOperationCount: 1 })).toBe('wait');
    expect(assessSyncWatchdog({ ...idle, authoritativeWorkCount: 1 })).toBe('wait');
    // A hung write is indistinguishable from slow IO — never fail it.
    expect(assessSyncWatchdog({
      ...idle,
      trackedOperationCount: 1,
      pendingStructuralOperations: true,
    })).toBe('wait');
  });

  it('reports a stall when a structural reservation has no owning operation left', () => {
    expect(assessSyncWatchdog({ ...idle, pendingStructuralOperations: true })).toBe('stalled');
  });

  it('lands an abandoned syncing status back to ready when every gate is clear', () => {
    expect(assessSyncWatchdog(idle)).toBe('land-ready');
  });
});

describe('sync retry policy', () => {
  it('does not automatically retry a conflict whose Noa copy is already preserved', () => {
    expect(shouldAutoRetrySyncFailure(
      new VaultWriteConflictError('Note', 'Note (Noa conflict abc).md'),
    )).toBe(false);
  });

  it('surfaces the preserved conflict-copy path to the user', () => {
    expect(getSyncFailureMessage(
      new VaultWriteConflictError('Note', 'Note (Noa conflict abc).md'),
    )).toContain('Note (Noa conflict abc).md');
  });

  it('aborts a conflicted durable rename journal instead of replaying it forever', async () => {
    const conflicted: VaultPendingOperation = {
      key: 'folder:f1:rename:1',
      entityKey: 'folder:f1',
      kind: 'rename-folder',
      vaultId: 'vault-1',
      phase: 'committed',
      folderId: 'f1',
      previousName: 'Old',
      nextFolders: [],
    };
    const unrelated: VaultPendingOperation = {
      key: 'folder:f2:delete:1',
      entityKey: 'folder:f2',
      kind: 'delete-folder',
      vaultId: 'vault-1',
      phase: 'committed',
      folder: { id: 'f2', name: 'Other', origin: 'vault' },
    };
    const remove = vi.spyOn(storage, 'removeVaultPendingOperation').mockResolvedValue();
    const get = vi.spyOn(storage, 'getVaultPendingOperations').mockResolvedValue([unrelated]);

    const remaining = await settleDurableVaultConflict(conflicted, 'vault-1');

    expect(remove).toHaveBeenCalledWith(conflicted.key);
    expect(get).toHaveBeenCalledTimes(1);
    expect(remaining).toEqual([unrelated]);
    remove.mockRestore();
    get.mockRestore();
  });
});
