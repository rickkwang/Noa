import { BackupHealthStatus } from '../types';

export interface BackupHealth {
  status: BackupHealthStatus;
  daysSinceExport: number | null;
  lastExportAt: string | null;
}

export function getBackupHealth(lastExportAt: string | null): BackupHealth {
  if (!lastExportAt) {
    return { status: 'risk', daysSinceExport: null, lastExportAt: null };
  }

  const diffMs = Date.now() - new Date(lastExportAt).getTime();
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (days <= 7) {
    return { status: 'healthy', daysSinceExport: days, lastExportAt };
  }
  if (days <= 14) {
    return { status: 'warning', daysSinceExport: days, lastExportAt };
  }
  return { status: 'risk', daysSinceExport: days, lastExportAt };
}
