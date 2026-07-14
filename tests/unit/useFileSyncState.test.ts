import { describe, expect, it } from 'vitest';
import { shouldLockVaultCache } from '../../src/hooks/useFileSync';

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
