import { useEffect, useState } from 'react';
import { getLastExportAt } from '../lib/exportTimestamp';
import { getBackupHealth } from '../lib/backupHealth';
import { BackupHealthStatus } from '../types';

const DISMISS_KEY = 'redaction-backup-reminder-dismissed-until';

function getDismissedUntil(): number {
  const v = localStorage.getItem(DISMISS_KEY);
  return v ? parseInt(v, 10) : 0;
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
    const handler = () => {
      setLastExportAt(getLastExportAt());
      // 导出后清除 dismiss，让下次到期时能再次提醒
      localStorage.removeItem(DISMISS_KEY);
      setDismissedUntil(0);
    };
    window.addEventListener('redaction-exported', handler);
    return () => window.removeEventListener('redaction-exported', handler);
  }, []);

  const health = getBackupHealth(lastExportAt);
  let daysSinceExport: number | null = health.daysSinceExport;
  let showReminder = false;

  const now = Date.now();
  if (noteCount > 0 && now > dismissedUntil) {
    if (!lastExportAt) {
      showReminder = true;
    } else {
      if ((daysSinceExport ?? 0) > 7) {
        showReminder = true;
      }
    }
  }

  const dismiss = () => {
    // 关闭后 3 天内不再提醒
    const until = now + 3 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(until));
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
