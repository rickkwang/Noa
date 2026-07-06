import { Folder, Note } from '../types';
import {
  clearPersistedHandle,
  createFolderDirectory,
  deleteNoteFile,
  getPersistedHandle,
  persistHandle,
  removeEmptyFolderTree,
  requestDirectoryAccess,
  scanDirectory,
  scanNoteFileStats,
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
  // No writes here: the caller first merges the vault's contents (newest wins),
  // then seeds the vault with the merged result via retryFullSync.
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

export type VaultMergeMode = 'newest-wins' | 'vault-authoritative';

export interface MergeVaultNotesOptions {
  mode?: VaultMergeMode;
}

function mergeFreshVaultFolders(current: Folder[], scanned: Folder[]): Folder[] {
  const merged = [...current];
  const names = new Set(current.map((folder) => folder.name));
  for (const folder of scanned) {
    if (names.has(folder.name)) continue;
    merged.push(folder);
    names.add(folder.name);
  }
  return merged;
}

/**
 * Pure merge of Noa's in-memory notes against a vault scan.
 * Exported for unit tests; production callers use mergeScannedNotes.
 *
 * Default newest-wins rules:
 *  - Note on both sides: the side with the newer updatedAt wins (a scanned
 *    note's updatedAt is the file's mtime). Noa-owned linkRefs are preserved.
 *  - Note only in Noa: kept, unless the manifest tracked it (its file was
 *    deleted externally) — then it is dropped and reported in deletedNoteIds.
 *  - Note only on disk: added.
 *
 * Vault-authoritative rules:
 *  - A non-empty vault replaces the IndexedDB cache.
 *  - Notes missing from disk are reported as deleted so import rescue logic
 *    does not resurrect stale cached notes.
 *  - A fresh empty vault with no manifest keeps local notes so it can be seeded.
 */
export function mergeVaultNotes(
  notes: Note[],
  scanned: Note[],
  manifestIds: ReadonlySet<string>,
  options: MergeVaultNotesOptions = {},
): { notes: Note[]; deletedNoteIds: string[]; updatedNoteIds: string[] } {
  const scannedById = new Map<string, Note>();
  const uniqueScanned: Note[] = [];
  for (const n of scanned) {
    if (scannedById.has(n.id)) {
      // Duplicate id on disk (e.g. a file copied outside Noa sharing another file's id).
      // Log and keep the first occurrence so merge stays deterministic.
      console.warn(`[Noa] Duplicate note id "${n.id}" found in vault — keeping first occurrence.`);
      continue;
    }
    scannedById.set(n.id, n);
    uniqueScanned.push(n);
  }

  if (options.mode === 'vault-authoritative') {
    // A completely fresh vault has no files and no manifest yet. Keep the local
    // notes so retryFullSync can seed the selected directory. If a manifest
    // exists, an empty scan means the tracked files were removed on disk.
    if (uniqueScanned.length === 0 && manifestIds.size === 0) {
      return { notes, deletedNoteIds: [], updatedNoteIds: [] };
    }

    const localById = new Map(notes.map((note) => [note.id, note]));
    const scannedIds = new Set(uniqueScanned.map((note) => note.id));
    const deletedNoteIds = notes
      .filter((note) => !scannedIds.has(note.id))
      .map((note) => note.id);
    const updatedNoteIds: string[] = [];
    const merged = uniqueScanned.map((fresh) => {
      const previous = localById.get(fresh.id);
      if (!previous) {
        updatedNoteIds.push(fresh.id);
        return fresh;
      }
      if (fresh.content !== previous.content || fresh.title !== previous.title) {
        updatedNoteIds.push(fresh.id);
      }
      return { ...fresh, linkRefs: previous.linkRefs };
    });

    return { notes: merged, deletedNoteIds, updatedNoteIds };
  }

  const deletedNoteIds: string[] = [];
  // Notes whose visible content actually changed by taking the disk version —
  // used for the "vault changes merged" notice. A disk win with identical
  // content (routine mtime drift after Noa's own writes) doesn't count.
  const updatedNoteIds: string[] = [];
  const merged = notes.flatMap((n) => {
    const fresh = scannedById.get(n.id);
    if (!fresh) {
      // The manifest tracked this note's file and it is gone from disk — it was
      // deleted externally (e.g. in Obsidian/Finder) and must not be resurrected.
      if (manifestIds.has(n.id)) {
        deletedNoteIds.push(n.id);
        return [];
      }
      // Never written to the vault yet (e.g. created while disconnected) — keep.
      return [n];
    }
    // Newest wins: the vault file's mtime vs Noa's updatedAt. Preserve Noa
    // fields the vault file doesn't own (linkRefs) either way.
    const diskMtime = new Date(fresh.updatedAt).getTime();
    const noaMtime = new Date(n.updatedAt).getTime();
    if (diskMtime > noaMtime) {
      if (fresh.content !== n.content || fresh.title !== n.title) {
        updatedNoteIds.push(n.id);
      }
      return [{ ...fresh, linkRefs: n.linkRefs }];
    }
    return [n];
  });
  // Add notes found in vault that don't exist in Noa yet.
  for (const sn of uniqueScanned) {
    if (!merged.find((n) => n.id === sn.id)) {
      merged.push(sn);
      updatedNoteIds.push(sn.id);
    }
  }
  return { notes: merged, deletedNoteIds, updatedNoteIds };
}

export async function mergeScannedNotes(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
  options: MergeVaultNotesOptions = {},
): Promise<{ notes: Note[]; folders: Folder[]; newFolders: Folder[]; deletedNoteIds: string[]; updatedNoteIds: string[] }> {
  // Land any in-flight debounced edits on disk first — the merge below treats
  // disk as authoritative, so scanning past a pending write would revert the
  // note to its stale on-disk content.
  await flushAllPendingNoteWrites();
  // Prime the poller's stat snapshot BEFORE reading contents: any external write
  // that lands mid-scan keeps an older mtime in the snapshot and is re-detected
  // on the next poll instead of being silently missed.
  const stats = await withTimeout(scanNoteFileStats(handle), SCAN_TIMEOUT_MS, 'Vault stat scan');
  const { notes: scanned, folders: scannedFolders, newFolders, manifestIds } = await withTimeout(
    scanDirectory(handle, folders),
    SCAN_TIMEOUT_MS,
    'Vault directory scan'
  );
  _vaultStatSnapshot = stats;
  const { notes: merged, deletedNoteIds, updatedNoteIds } = mergeVaultNotes(notes, scanned, manifestIds, options);
  const mergedFolders = options.mode === 'vault-authoritative'
    ? (scanned.length === 0 && manifestIds.size === 0 ? mergeFreshVaultFolders(folders, scannedFolders) : scannedFolders)
    : [...folders, ...newFolders];
  return { notes: merged, folders: mergedFolders, newFolders, deletedNoteIds, updatedNoteIds };
}

// ---------------------------------------------------------------------------
// External-change polling
//
// The File System Access API has no watch/observer primitive, so runtime
// detection of edits made by other apps (Obsidian, VS Code, iCloud sync…)
// works by comparing a cheap path→mtime sweep against the last known state.
// Self-writes update the snapshot at write time so they never register as
// external changes.
// ---------------------------------------------------------------------------

let _vaultStatSnapshot: Map<string, number> | null = null;

export function resetVaultStatSnapshot(): void {
  _vaultStatSnapshot = null;
}

function statsDiffer(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return true;
  for (const [path, mtime] of a) {
    if (b.get(path) !== mtime) return true;
  }
  return false;
}

/**
 * Cheap poll: returns true when the vault's note files changed on disk since
 * the last scan/write. Never mutates the snapshot on a positive result — the
 * follow-up mergeScannedNotes refreshes it after the changes are ingested.
 * Returns false when no baseline exists yet (first call primes it instead).
 */
export async function checkExternalVaultChanges(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  // Serialise against writes so a mid-write file is never stat'ed torn.
  return withVaultLock(async () => {
    const stats = await scanNoteFileStats(handle);
    if (!_vaultStatSnapshot) {
      _vaultStatSnapshot = stats;
      return false;
    }
    return statsDiffer(stats, _vaultStatSnapshot);
  });
}

// Self-write suppression: every write/delete refreshes its own snapshot entry
// so the poller does not mistake Noa's writes for external changes.
async function writeNoteTracked(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<void> {
  const written = await writeNote(handle, note, folders);
  if (written && _vaultStatSnapshot) {
    _vaultStatSnapshot.set(written.path, written.lastModified);
  }
}

async function deleteNoteFileTracked(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
  options?: { keepAttachments?: boolean },
): Promise<void> {
  const removedPath = await deleteNoteFile(handle, note, folders, options);
  if (removedPath && _vaultStatSnapshot) {
    _vaultStatSnapshot.delete(removedPath);
  }
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

// Per-note pending timers: noteId → { timer, fn } — fn is kept so pending
// writes can be flushed synchronously before a vault scan reads the disk.
const _noteDebounceTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => Promise<void> }>();
const _notePendingSettlers = new Map<string, Array<{ resolve: () => void; reject: (err: unknown) => void }>>();

/** Flush a note write immediately, skipping the debounce. */
function flushNoteWrite(noteId: string, fn: () => Promise<void>): Promise<void> {
  // Cancel any pending debounce for this note.
  const pending = _noteDebounceTimers.get(noteId);
  if (pending !== undefined) {
    clearTimeout(pending.timer);
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
    if (existing !== undefined) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      _noteDebounceTimers.delete(noteId);
      flushNoteWrite(noteId, fn);
    }, delayMs);
    _noteDebounceTimers.set(noteId, { timer, fn });
  });
}

/**
 * Flush every pending debounced note write to disk and wait for the queue to
 * drain. Called before vault scans: the disk is authoritative, so a scan must
 * never read a file that is about to be overwritten by an in-flight edit —
 * the stale disk content would clobber the newer in-memory note.
 */
async function flushAllPendingNoteWrites(): Promise<void> {
  for (const [noteId, pending] of Array.from(_noteDebounceTimers.entries())) {
    flushNoteWrite(noteId, pending.fn);
  }
  await _vaultWriteQueue;
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
    writeNoteTracked(handle, { ...note, content, updatedAt: new Date().toISOString() }, folders)
  );
}

export async function syncNoteRename(
  handle: FileSystemDirectoryHandle,
  note: Note,
  newTitle: string,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(async () => {
    // keepAttachments: the note continues to exist — its attachments/{noteId}
    // directory must survive the rename (writeNote does not recreate it for
    // obsidian-import notes).
    await deleteNoteFileTracked(handle, note, folders, { keepAttachments: true });
    await writeNoteTracked(handle, { ...note, title: newTitle, updatedAt: new Date().toISOString() }, folders);
  });
}

export async function syncNoteDelete(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(() => deleteNoteFileTracked(handle, note, folders));
}

export async function syncNoteMove(
  handle: FileSystemDirectoryHandle,
  previousNote: Note,
  nextNote: Note,
  folders: Folder[],
): Promise<void> {
  await withVaultLock(async () => {
    await deleteNoteFileTracked(handle, previousNote, folders, { keepAttachments: true });
    await writeNoteTracked(handle, nextNote, folders);
  });
}

export async function syncFolderCreate(
  handle: FileSystemDirectoryHandle,
  folderName: string,
): Promise<void> {
  await withVaultLock(() => createFolderDirectory(handle, folderName));
}

export async function syncFolderDelete(
  handle: FileSystemDirectoryHandle,
  folderName: string,
): Promise<void> {
  // Only empty parts of the tree are removed — untracked files (PDFs,
  // .canvas, ...) and their parent directories survive.
  await withVaultLock(() => removeEmptyFolderTree(handle, folderName));
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

    // Folder list as it looked before the rename, so each note's old file can
    // be located when the manifest has no entry for it.
    const previousFolders = currentFolders.map((folder) =>
      affectedFolderIds.has(folder.id)
        ? { ...folder, name: previousName + folder.name.slice(newPrefix.length) }
        : folder
    );

    // Move managed notes one by one instead of deleting the directory tree —
    // vault folders may contain files Noa does not track, and those must survive.
    for (const note of notes.filter((n) => affectedFolderIds.has(n.folder))) {
      await deleteNoteFileTracked(handle, note, previousFolders, { keepAttachments: true });
      await writeNoteTracked(handle, note, currentFolders);
    }
    // Empty (sub)folders have no note writes to materialise their new
    // directories — create them explicitly so the rename survives on disk.
    for (const folder of currentFolders) {
      if (affectedFolderIds.has(folder.id)) {
        await createFolderDirectory(handle, folder.name);
      }
    }
    await removeEmptyFolderTree(handle, previousName);
  });
}

export async function retryFullSync(
  handle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
): Promise<void> {
  await withVaultLock(async () => {
    for (const note of notes) {
      await writeNoteTracked(handle, note, folders);
    }
  });
}

export function classifySyncError(error: unknown): FileSyncError {
  return toFileSyncError(error);
}
