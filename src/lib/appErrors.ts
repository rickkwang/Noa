import { AppErrorCode, RecoveryAction } from '../types';

export interface AppError {
  code: AppErrorCode;
  userMessage: string;
  suggestedAction: RecoveryAction;
  rawMessage?: string;
}

function rawMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

export function fromStorageError(error: unknown): AppError {
  return {
    code: 'storage_unavailable',
    userMessage:
      'Local storage is currently unavailable. Check browser privacy/storage settings, then retry.',
    suggestedAction: 'retry',
    rawMessage: rawMessage(error),
  };
}

export function fromImportError(
  code: 'import_invalid_json' | 'import_integrity_failed' | 'import_replace_risky' | 'unknown_error',
  fallback: string,
): AppError {
  const map: Record<typeof code, AppError> = {
    import_invalid_json: {
      code,
      userMessage: 'Backup file format is invalid. Please choose a valid Noa JSON backup.',
      suggestedAction: 'import_backup',
    },
    import_integrity_failed: {
      code,
      userMessage: 'Backup validation failed due to missing or invalid required fields.',
      suggestedAction: 'import_backup',
    },
    import_replace_risky: {
      code,
      userMessage: 'This action will replace current notes. Export a backup before continuing.',
      suggestedAction: 'import_backup',
    },
    unknown_error: {
      code,
      userMessage: fallback,
      suggestedAction: 'retry',
    },
  };
  return map[code];
}

export function fromSyncError(error: unknown): AppError {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name?: string }).name);
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return {
        code: 'sync_permission_denied',
        userMessage: 'Folder access was denied. Reconnect folder and grant permission.',
        suggestedAction: 'retry',
        rawMessage: rawMessage(error),
      };
    }
  }

  return {
    code: 'unknown_error',
    userMessage: 'File sync failed. You can continue local editing and retry sync later.',
    suggestedAction: 'retry',
    rawMessage: rawMessage(error),
  };
}
