import { useEffect, useState } from 'react';
import { getLastExportAt } from '../lib/exportTimestamp';
import { getBackupHealth } from '../lib/backupHealth';
import { BackupHealthStatus } from '../types';
import { STORAGE_KEYS } from '../constants/storageKeys';

const DISMISS_KEY = STORAGE_KEYS.BACKUP_REMINDER;

function getDismissedUntil(): number {
  try {
    const value = localStorage.getItem(DISMISS_KEY);
    return value ? parseInt(value, 10) : 0;
  } catch {
    return 0;
  }
}

export function useBackupReminder(noteCount: number): {
  showReminder: boolean;
  daysSinceExport: number | null;
  lastExportAt: string | null;
  backupHealth: BackupHealthStatus;
  dismiss: () => void;
} {
  const [lastExportAt, setLastExportAt] = useState(() => getLastExportAt());
  const [dismissedUntil, setDismissedUntil] = useState(() => getDismissedUntil());

  useEffect(() => {
    const handleExported = () => {
      setLastExportAt(getLastExportAt());
      try { localStorage.removeItem(DISMISS_KEY); } catch { /* storage unavailable */ }
      setDismissedUntil(0);
    };
    window.addEventListener('redaction-exported', handleExported);
    return () => window.removeEventListener('redaction-exported', handleExported);
  }, []);

  const health = getBackupHealth(lastExportAt);
  const daysSinceExport = health.daysSinceExport;
  const showReminder = noteCount > 0
    && Date.now() > dismissedUntil
    && (!lastExportAt || (daysSinceExport ?? 0) > 7);

  const dismiss = () => {
    const until = Date.now() + 3 * 24 * 60 * 60 * 1000;
    try { localStorage.setItem(DISMISS_KEY, String(until)); } catch { /* storage unavailable */ }
    setDismissedUntil(until);
  };

  return {
    showReminder,
    daysSinceExport,
    lastExportAt,
    backupHealth: health.status,
    dismiss,
  };
}
