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
  notes: Note[],
  folders: Folder[],
): Promise<FileSystemDirectoryHandle> {
  const handle = await requestDirectoryAccess();
  await persistHandle(handle);
  await Promise.all(notes.map((note) => writeNote(handle, note, folders)));
  return handle;
}

export async function disconnectDirectory(): Promise<void> {
  await clearPersistedHandle();
}

export async function mergeScannedNotes(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<Note[]> {
  const scanned = await scanDirectory(handle, folders);
  const merged = [...notes];
  for (const sn of scanned) {
    if (!merged.find((n) => n.id === sn.id)) merged.push(sn);
  }
  return merged;
}

export async function syncNoteUpdate(
  handle: FileSystemDirectoryHandle,
  note: Note,
  content: string,
  folders: Folder[],
): Promise<void> {
  await writeNote(
    handle,
    { ...note, content, updatedAt: new Date().toISOString() },
    folders,
  );
}

export async function syncNoteRename(
  handle: FileSystemDirectoryHandle,
  note: Note,
  newTitle: string,
  folders: Folder[],
): Promise<void> {
  await deleteNoteFile(handle, note, folders);
  await writeNote(
    handle,
    { ...note, title: newTitle, updatedAt: new Date().toISOString() },
    folders,
  );
}

export async function syncNoteDelete(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<void> {
  await deleteNoteFile(handle, note, folders);
}

export async function syncNoteMove(
  handle: FileSystemDirectoryHandle,
  previousNote: Note,
  nextNote: Note,
  folders: Folder[],
): Promise<void> {
  await deleteNoteFile(handle, previousNote, folders);
  await writeNote(handle, nextNote, folders);
}

export async function syncFolderRename(
  handle: FileSystemDirectoryHandle,
  folderId: string,
  previousName: string,
  currentFolders: Folder[],
  notes: Note[],
): Promise<void> {
  const nextFolder = currentFolders.find((folder) => folder.id === folderId);
  if (!nextFolder) return;

  const affectedFolderIds = new Set(
    currentFolders
      .filter((folder) => folder.name === previousName || folder.name.startsWith(`${previousName}/`))
      .map((folder) => folder.id)
  );

  await deleteFolderTree(handle, previousName);
  await Promise.all(
    notes
      .filter((note) => affectedFolderIds.has(note.folder))
      .map((note) => writeNote(handle, note, currentFolders))
  );
}

export async function retryFullSync(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<void> {
  await Promise.all(notes.map((note) => writeNote(handle, note, folders)));
}

export function classifySyncError(error: unknown): FileSyncError {
  return toFileSyncError(error);
}
