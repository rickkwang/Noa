import { describe, expect, it } from 'vitest';
import { assessSyncWatchdog, shouldLockVaultCache } from '../../src/hooks/useFileSync';

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
