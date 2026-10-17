export type StoragePersistenceStatus = 'persisted' | 'not-persisted' | 'unsupported';

/**
 * Whether the browser has granted persistent storage. Never throws: browsers
 * without the Storage API report 'unsupported' so the settings row hides itself.
 */
export async function getStoragePersistenceStatus(): Promise<StoragePersistenceStatus> {
  try {
    const api = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!api?.persisted || !api.persist) return 'unsupported';
    return (await api.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks for persistent storage and reports the resulting state: Chrome grants it
 * on an engagement heuristic and can decline, so the request is not the status.
 */
export async function requestStoragePersistence(): Promise<StoragePersistenceStatus> {
  try {
    const api = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!api?.persist) return 'unsupported';
    await api.persist();
  } catch {
    return 'not-persisted';
  }
  return getStoragePersistenceStatus();
}
