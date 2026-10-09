import localforage from 'localforage';

// Separate DB (not just a key) so the backup handle can't be confused with the
// vault sync handle in fileSystemStorage.ts.
const backupHandleStore = localforage.createInstance({
  name: 'redaction-backup-fs-db',
  storeName: 'fs-handle',
});

const BACKUP_HANDLE_KEY = 'backup-handle';

export { isFileSystemSupported } from './fileSystemStorage';

export async function requestBackupDirectory(): Promise<FileSystemDirectoryHandle> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('File System Access API is not supported in this environment.');
  }
  // `id` lets the browser remember the last backup directory separately from vault sync.
  // Cast: the TS DOM lib lags the spec.
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
  // queryPermission is non-standard; fall back to 'prompt' so the caller still re-requests on action.
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
