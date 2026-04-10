import { Folder, Note } from '../types';
import {
  clearPersistedHandle,
  deleteFolderTree,
  deleteNoteFile,
  getPersistedHandle,
  persistHandle,
  requestDirectoryAccess,
  scanDirectory,
  writeNote,
} from '../lib/fileSystemStorage';

export type FileSyncErrorCode = 'permission_denied' | 'io_error' | 'unknown';

export interface FileSyncError {
  code: FileSyncErrorCode;
  message: string;
}

function toFileSyncError(error: unknown): FileSyncError {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name?: string }).name);
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return { code: 'permission_denied', message: 'Directory access denied or cancelled.' };
    }
  }
  if (error instanceof Error) {
    return { code: 'io_error', message: error.message };
  }
  return { code: 'unknown', message: 'Unknown sync error.' };
}

export async function restorePersistedFsHandle(): Promise<FileSystemDirectoryHandle | null> {
  return getPersistedHandle();
}

export async function connectDirectoryAndSeed(
  _notes: Note[],
  _folders: Folder[],
): Promise<FileSystemDirectoryHandle> {
  const handle = await requestDirectoryAccess();
  await persistHandle(handle);
  // Do NOT write notes on connect — the vault is the source of truth.
  // mergeScannedNotes (called by the caller) will read the vault and
  // bring Noa in sync without touching any existing files.
  return handle;
}

export async function disconnectDirectory(): Promise<void> {
  await clearPersistedHandle();
}

export async function mergeScannedNotes(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<{ notes: Note[]; newFolders: Folder[] }> {
  const { notes: scanned, newFolders } = await scanDirectory(handle, folders);
  const scannedById = new Map(scanned.map((n) => [n.id, n]));
  // Update existing obsidian-import notes with fresh data from disk;
  // keep Noa-native notes untouched.
  const merged = notes.map((n) => {
    const fresh = scannedById.get(n.id);
    if (!fresh) return n;
    // Preserve Noa fields that the vault file doesn't own (e.g. linkRefs computed
    // by Noa's link engine), but take everything the vault file does own.
    return {
      ...fresh,
      linkRefs: n.linkRefs,
    };
  });
  // Add notes found in vault that don't exist in Noa yet.
  for (const sn of scanned) {
    if (!merged.find((n) => n.id === sn.id)) merged.push(sn);
  }
  return { notes: merged, newFolders };
}

// Serialises all vault write operations so concurrent saves never produce a
// torn manifest. Each call enqueues behind the previous one.
let _vaultWriteQueue: Promise<void> = Promise.resolve();

function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _vaultWriteQueue.then(fn);
  // The outer queue only tracks completion (not the return value) so a
  // rejected inner promise doesn't stall subsequent operations.
  _vaultWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function syncNoteUpdate(
  handle: FileSystemDirectoryHandle,
  note: Note,
  content: string,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(() =>
    writeNote(handle, { ...note, content, updatedAt: new Date().toISOString() }, folders)
  );
}

export async function syncNoteRename(
  handle: FileSystemDirectoryHandle,
  note: Note,
  newTitle: string,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(async () => {
    await deleteNoteFile(handle, note, folders);
    await writeNote(handle, { ...note, title: newTitle, updatedAt: new Date().toISOString() }, folders);
  });
}

export async function syncNoteDelete(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(() => deleteNoteFile(handle, note, folders));
}

export async function syncNoteMove(
  handle: FileSystemDirectoryHandle,
  previousNote: Note,
  nextNote: Note,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(async () => {
    await deleteNoteFile(handle, previousNote, folders);
    await writeNote(handle, nextNote, folders);
  });
}

export async function syncFolderRename(
  handle: FileSystemDirectoryHandle,
  folderId: string,
  previousName: string,
  currentFolders: Folder[],
  notes: Note[],
): Promise<void> {
  await withVaultLock(async () => {
    const nextFolder = currentFolders.find((folder) => folder.id === folderId);
    if (!nextFolder) return;

    // currentFolders already has the new names, so match against the new folder's
    // id plus any child that was a descendant of previousName (now updated to
    // the new prefix).  We derive the new prefix from nextFolder to avoid
    // matching stale previousName in already-renamed currentFolders.
    const newPrefix = nextFolder.name;
    const affectedFolderIds = new Set(
      currentFolders
        .filter((folder) => folder.id === folderId || folder.name.startsWith(`${newPrefix}/`))
        .map((folder) => folder.id)
    );

    await deleteFolderTree(handle, previousName);
    for (const note of notes.filter((n) => affectedFolderIds.has(n.folder))) {
      await writeNote(handle, note, currentFolders);
    }
  });
}

export async function retryFullSync(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<void> {
  await withVaultLock(async () => {
    for (const note of notes) {
      await writeNote(handle, note, folders);
    }
  });
}

export function classifySyncError(error: unknown): FileSyncError {
  return toFileSyncError(error);
}
