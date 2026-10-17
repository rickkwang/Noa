import { useCallback, useEffect, useState } from 'react';
import {
  getStoragePersistenceStatus,
  requestStoragePersistence,
  type StoragePersistenceStatus,
} from '../lib/storagePersistence';

export interface UseStoragePersistenceResult {
  /** null while the initial probe runs. */
  status: StoragePersistenceStatus | null;
  requesting: boolean;
  protect: () => Promise<void>;
}

export function useStoragePersistence(): UseStoragePersistenceResult {
  const [status, setStatus] = useState<StoragePersistenceStatus | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getStoragePersistenceStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => { cancelled = true; };
  }, []);

  const protect = useCallback(async () => {
    setRequesting(true);
    try {
      setStatus(await requestStoragePersistence());
    } finally {
      setRequesting(false);
    }
  }, []);

  return { status, requesting, protect };
}
