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

const SCAN_TIMEOUT_MS = 30_000; // 30 s — large vaults can be slow

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export async function mergeScannedNotes(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<{ notes: Note[]; newFolders: Folder[] }> {
  const { notes: scanned, newFolders } = await withTimeout(
    scanDirectory(handle, folders),
    SCAN_TIMEOUT_MS,
    'Vault directory scan'
  );
  const scannedById = new Map(scanned.map((n) => [n.id, n]));
  // Update existing obsidian-import notes with fresh data from disk;
  // keep Noa-native notes untouched.
  // Drop obsidian-import notes that no longer exist on disk — they were deleted
  // externally (e.g. in Obsidian) and should not be resurrected.
  const merged = notes.flatMap((n) => {
    const fresh = scannedById.get(n.id);
    if (!fresh) {
      // Noa-native notes always kept; obsidian-import notes missing from disk are removed.
      if ((n.source ?? 'noa') === 'obsidian-import') return [];
      return [n];
    }
    // Preserve Noa fields that the vault file doesn't own (e.g. linkRefs computed
    // by Noa's link engine), but take everything the vault file does own.
    return [{ ...fresh, linkRefs: n.linkRefs }];
  });
  // Add notes found in vault that don't exist in Noa yet.
  for (const sn of scanned) {
    if (!merged.find((n) => n.id === sn.id)) merged.push(sn);
  }
  return { notes: merged, newFolders };
}

// ---------------------------------------------------------------------------
// Vault write serialisation
//
// Two-level concurrency control:
//
//  1. Per-note debounce: rapid successive updates to the same note collapse
//     into a single write — only the latest payload is flushed. This prevents
//     torn files when the user types quickly while sync is enabled.
//
//  2. Global queue: all actual writes are serialised through a single promise
//     chain so no two file operations ever run concurrently (avoids partial
//     manifest corruption on rename/move that touch two files atomically).
// ---------------------------------------------------------------------------

let _vaultWriteQueue: Promise<void> = Promise.resolve();

// Per-note pending timers: noteId → { timer, resolve/reject }
const _noteDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _notePendingSettlers = new Map<string, Array<{ resolve: () => void; reject: (err: unknown) => void }>>();

/** Flush a note write immediately, skipping the debounce. */
function flushNoteWrite(noteId: string, fn: () => Promise<void>): Promise<void> {
  // Cancel any pending debounce for this note.
  const t = _noteDebounceTimers.get(noteId);
  if (t !== undefined) {
    clearTimeout(t);
    _noteDebounceTimers.delete(noteId);
  }

  const result = _vaultWriteQueue.then(fn);
  _vaultWriteQueue = result.then(
    () => undefined,
    (err: unknown) => { console.error('[fileSyncService] vault write failed:', err); }
  );

  // Settle any callers that were waiting on this note's debounce.
  const settlers = _notePendingSettlers.get(noteId);
  if (settlers) {
    result.then(
      () => settlers.forEach(s => s.resolve()),
      (err: unknown) => settlers.forEach(s => s.reject(err)),
    );
    _notePendingSettlers.delete(noteId);
  }

  return result;
}

/**
 * Debounced note write: collapses rapid successive calls into one write.
 * Structural operations (rename, move, delete) bypass this via flushNoteWrite.
 */
function debouncedNoteWrite(noteId: string, fn: () => Promise<void>, delayMs = 300): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Register this caller so it gets settled when the write eventually fires.
    const settlers = _notePendingSettlers.get(noteId) ?? [];
    settlers.push({ resolve, reject });
    _notePendingSettlers.set(noteId, settlers);

    // Reset the debounce timer — only the last fn wins.
    const existing = _noteDebounceTimers.get(noteId);
    if (existing !== undefined) clearTimeout(existing);

    const t = setTimeout(() => {
      _noteDebounceTimers.delete(noteId);
      flushNoteWrite(noteId, fn);
    }, delayMs);
    _noteDebounceTimers.set(noteId, t);
  });
}

/** For structural operations (rename, delete, move, folder ops) that must run immediately. */
function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _vaultWriteQueue.then(fn);
  _vaultWriteQueue = result.then(
    () => undefined,
    (err: unknown) => { console.error('[fileSyncService] vault write failed:', err); }
  );
  return result;
}

export async function syncNoteUpdate(
  handle: FileSystemDirectoryHandle,
  note: Note,
  content: string,
  folders: Folder[],
): Promise<void> {
  // Use per-note debounce: rapid typing collapses into one write.
  await debouncedNoteWrite(note.id, () =>
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
