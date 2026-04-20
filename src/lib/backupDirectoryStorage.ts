import localforage from 'localforage';

// Separate localforage instance so the backup directory handle can never be
// confused with the vault sync handle owned by fileSystemStorage.ts. Picking
// a different DB name (not just a different key in the same store) also means
// a future "disconnect vault" flow can safely clearAll() its store without
// touching backups.
const backupHandleStore = localforage.createInstance({
  name: 'redaction-backup-fs-db',
  storeName: 'fs-handle',
});

const BACKUP_HANDLE_KEY = 'backup-handle';

export function isFileSystemSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

export async function requestBackupDirectory(): Promise<FileSystemDirectoryHandle> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('File System Access API is not supported in this environment.');
  }
  // `id` hint helps the browser remember the last-picked directory per purpose
  // (separate from vault sync). Cast because TS lib DOM lags behind the spec.
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'noa-backup' } as unknown as { mode: 'readwrite' });
}

export async function persistBackupHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await backupHandleStore.setItem(BACKUP_HANDLE_KEY, handle);
}

export async function getBackupHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await backupHandleStore.getItem<FileSystemDirectoryHandle>(BACKUP_HANDLE_KEY);
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function clearBackupHandle(): Promise<void> {
  await backupHandleStore.removeItem(BACKUP_HANDLE_KEY);
}

export type BackupPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

interface PermissionOpts { mode: 'read' | 'readwrite' }

export async function queryBackupPermission(handle: FileSystemDirectoryHandle): Promise<BackupPermissionState> {
  // queryPermission is non-standard on older browsers; fall back to 'prompt'
  // so the caller still tries to re-request on user action.
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (opts: PermissionOpts) => Promise<PermissionState>;
  };
  if (typeof h.queryPermission !== 'function') return 'unsupported';
  try {
    const state = await h.queryPermission({ mode: 'readwrite' });
    return state as BackupPermissionState;
  } catch {
    return 'prompt';
  }
}

export async function requestBackupPermission(handle: FileSystemDirectoryHandle): Promise<BackupPermissionState> {
  const h = handle as FileSystemDirectoryHandle & {
    requestPermission?: (opts: PermissionOpts) => Promise<PermissionState>;
  };
  if (typeof h.requestPermission !== 'function') return 'unsupported';
  try {
    const state = await h.requestPermission({ mode: 'readwrite' });
    return state as BackupPermissionState;
  } catch {
    return 'denied';
  }
}
