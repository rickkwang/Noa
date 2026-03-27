import { useEffect, useState } from 'react';
import { storage } from '../lib/storage';

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
  ratio: number;
  supported: boolean;
}

export function useStorageEstimate(): StorageEstimate | null {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);

  useEffect(() => {
    storage.getStorageEstimate().then((result) => {
      if (!result) {
        setEstimate({ usageBytes: 0, quotaBytes: 0, ratio: 0, supported: false });
        return;
      }
      const ratio = result.quota > 0 ? Math.min(result.usage / result.quota, 1.0) : 0;
      setEstimate({ usageBytes: result.usage, quotaBytes: result.quota, ratio, supported: true });
    });
  }, []);

  return estimate;
}
