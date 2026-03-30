import { getBackupHealth } from './backupHealth';
import { getLastExportAt } from './exportTimestamp';
import { storage } from './storage';

const ERROR_SNAPSHOTS_KEY = 'redaction-error-snapshots';

export interface FileSyncDiagnostics {
  status: string;
  lastSyncAt: string | null;
  error: string | null;
  handleName: string | null;
}

export interface DiagnosticsPayload {
  generatedAt: string;
  appVersion: string;
  backup: {
    lastExportAt: string | null;
    health: ReturnType<typeof getBackupHealth>;
  };
  storageEstimate: { usage: number; quota: number } | null;
  errorSnapshots: unknown[];
  fileSync: FileSyncDiagnostics | null;
  environment: {
    userAgent: string;
    platform: string | null;
    language: string | null;
  };
}

export async function buildDiagnostics(options: {
  appVersion: string;
  fileSync?: FileSyncDiagnostics | null;
}): Promise<DiagnosticsPayload> {
  const lastExportAt = getLastExportAt();
  const health = getBackupHealth(lastExportAt);
  const storageEstimate = await storage.getStorageEstimate();
  let errorSnapshots: unknown[] = [];

  try {
    const raw = localStorage.getItem(ERROR_SNAPSHOTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        errorSnapshots = parsed;
      }
    }
  } catch {
    // best-effort only
  }

  return {
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    backup: {
      lastExportAt,
      health,
    },
    storageEstimate,
    errorSnapshots,
    fileSync: options.fileSync ?? null,
    environment: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      platform: typeof navigator !== 'undefined' ? navigator.platform : null,
      language: typeof navigator !== 'undefined' ? navigator.language : null,
    },
  };
}

export function downloadDiagnostics(payload: DiagnosticsPayload): void {
  const dateStamp = payload.generatedAt.split('T')[0] || 'unknown-date';
  const filename = `noa-diagnostics-${dateStamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
