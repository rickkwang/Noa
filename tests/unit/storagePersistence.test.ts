import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoragePersistenceStatus, requestStoragePersistence } from '../../src/lib/storagePersistence';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage persistence', () => {
  it('reports unsupported when the Storage API is unavailable', async () => {
    vi.stubGlobal('navigator', undefined);

    expect(await getStoragePersistenceStatus()).toBe('unsupported');
    expect(await requestStoragePersistence()).toBe('unsupported');
  });

  it('reports persisted when the browser already granted it', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) },
    });

    expect(await getStoragePersistenceStatus()).toBe('persisted');
  });

  it('treats a declined persist() request as not persisted', async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn(async () => false), persist },
    });

    expect(await requestStoragePersistence()).toBe('not-persisted');
    expect(persist).toHaveBeenCalled();
  });
});
