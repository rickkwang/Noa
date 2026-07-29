import {
  clearPersistedHandle,
  createFolderDirectory,
  deleteNoteFile,
  extractContentFromVaultText,
  getPersistedHandle,
  getNoteFilePath,
  persistHandle,
  readVaultNoteText,
  removeNoteFileAtPath,
  removeEmptyFolderTree,
  requestDirectoryAccess,
  scanDirectory,
  scanNoteFileStats,
  serializeNoteForVault,
  writeNote,
} from '../lib/fileSystemStorage';
import { storage } from '../lib/storage';
import { Folder, Note, VaultPendingOperation } from '../types';

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

export { getVaultIdentity } from '../lib/fileSystemStorage';

export async function connectDirectory(): Promise<FileSystemDirectoryHandle> {
  const handle = await requestDirectoryAccess();
  await persistHandle(handle);
  // Connecting only persists the handle. The caller scans disk into a cache;
  // Noa-owned notes are never seeded into the vault.
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

function namespaceVaultIdCollisions(notes: Note[], scanned: Note[]): Note[] {
  const localIds = new Set(notes.filter((note) => note.origin !== 'vault').map((note) => note.id));
  if (localIds.size === 0) return scanned;
  const rawScannedIds = new Set(scanned.map((note) => note.id));
  const assignedCacheIds = new Set<string>();

  return scanned.map((note) => {
    const diskId = note.vaultId ?? note.id;
    if (!localIds.has(note.id)) {
      assignedCacheIds.add(note.id);
      return note;
    }

    let cacheId = `vault:${diskId}`;
    while (localIds.has(cacheId) || rawScannedIds.has(cacheId) || assignedCacheIds.has(cacheId)) {
      cacheId = `vault:${cacheId}`;
    }
    assignedCacheIds.add(cacheId);
    return {
      ...note,
      id: cacheId,
      vaultId: diskId,
      attachments: note.attachments?.map((attachment) => ({ ...attachment, noteId: cacheId })),
    };
  });
}

/**
 * Attachments without a vaultPath were added in Noa and have not been
 * confirmed on disk yet — dropping them would lose the upload. Ones whose
 * vaultPath vanished from the scan were deleted externally and stay dropped.
 */
function mergePendingAttachments(previous: Note, fresh: Note): Pick<Note, 'attachments'> | Record<string, never> {
  const diskAttachments = fresh.attachments ?? [];
  const diskIds = new Set(diskAttachments.map((attachment) => attachment.id));
  const pending = (previous.attachments ?? []).filter(
    (attachment) => !attachment.vaultPath && !diskIds.has(attachment.id)
  );
  const merged = [...diskAttachments, ...pending];
  return merged.length ? { attachments: merged } : {};
}

function mergeVaultAndLocalFolders(current: Folder[], scanned: Folder[]): Folder[] {
  // Folder ownership is independent across the two domains. Every Noa-owned
  // folder survives (including empty folders), while vault cache folders are
  // replaced wholesale by the directory tree that actually exists on disk.
  return [...current.filter((folder) => folder.origin !== 'vault'), ...scanned];
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
 *  - Notes present on disk replace the IndexedDB cache (linkRefs and pending
 *    local attachments are preserved — both are Noa-owned state).
 *  - A vault-origin cache row missing from disk is deleted whether or not a
 *    manifest exists. Noa-owned rows and one-time imports pass through untouched.
 */
export function mergeVaultNotes(
  notes: Note[],
  scanned: Note[],
  manifestIds: ReadonlySet<string>,
  options: MergeVaultNotesOptions = {},
): { notes: Note[]; deletedNoteIds: string[]; updatedNoteIds: string[] } {
  const scannedForMerge = options.mode === 'vault-authoritative'
    ? namespaceVaultIdCollisions(notes, scanned)
    : scanned;
  const scannedById = new Map<string, Note>();
  const uniqueScanned: Note[] = [];
  for (const n of scannedForMerge) {
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
    const localById = new Map(notes.map((note) => [note.id, note]));
    const scannedIds = new Set(uniqueScanned.map((note) => note.id));
    const deletedNoteIds = notes
      // origin is the ownership boundary. A cached vault row missing from the
      // disk scan was deleted externally even if the vault never had a manifest;
      // a Noa-owned or one-time-import row must survive regardless of source.
      .filter((note) => note.origin === 'vault' && !note.vaultDirty && !scannedIds.has(note.id))
      .map((note) => note.id);
    const keptLocal = notes.filter(
      (note) => (note.origin !== 'vault' || note.vaultDirty) && !scannedIds.has(note.id),
    );
    const updatedNoteIds: string[] = [];
    const merged = uniqueScanned.map((fresh) => {
      const previous = localById.get(fresh.id);
      if (!previous) {
        updatedNoteIds.push(fresh.id);
        return fresh;
      }
      // A failed local write leaves disk stale. Keep the cache row until a
      // confirmed write clears vaultDirty; otherwise retry/poll would silently
      // replace the user's newer edit with the old file contents.
      if (previous.vaultDirty) return previous;
      if (fresh.content !== previous.content || fresh.title !== previous.title) {
        updatedNoteIds.push(fresh.id);
      }
      return { ...fresh, linkRefs: previous.linkRefs, ...mergePendingAttachments(previous, fresh) };
    });

    return { notes: [...merged, ...keptLocal], deletedNoteIds, updatedNoteIds };
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
  // Blobs already in storage are immutable per id — telling the scan about them
  // skips re-reading every attachment payload on every merge.
  let existingAttachmentBlobIds: ReadonlySet<string> | undefined;
  try {
    existingAttachmentBlobIds = new Set(await storage.listAttachmentBlobIds());
  } catch {
    existingAttachmentBlobIds = undefined; // storage unavailable → scan reads payloads as before
  }
  const { notes: scanned, folders: scannedFolders, newFolders, manifestIds } = await withTimeout(
    scanDirectory(handle, folders, { existingAttachmentBlobIds }),
    SCAN_TIMEOUT_MS,
    'Vault directory scan'
  );
  _vaultStatSnapshot = stats;
  const { notes: merged, deletedNoteIds, updatedNoteIds } = mergeVaultNotes(notes, scanned, manifestIds, options);
  const mergedFolders = options.mode === 'vault-authoritative'
    ? mergeVaultAndLocalFolders(folders, scannedFolders)
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
  payloadOverride?: string,
): Promise<Awaited<ReturnType<typeof writeNote>>> {
  const written = await writeNote(handle, note, folders, payloadOverride);
  if (written && _vaultStatSnapshot) {
    _vaultStatSnapshot.set(written.path, written.lastModified);
  }
  return written;
}

export class VaultWriteConflictError extends Error {
  readonly conflictPath: string;

  constructor(noteTitle: string, conflictPath: string, preservation: 'copy' | 'external' = 'copy') {
    super(preservation === 'copy'
      ? `Vault conflict: "${noteTitle || 'Untitled'}" changed outside Noa. The Noa edit was preserved as "${conflictPath}".`
      : `Vault conflict: "${noteTitle || 'Untitled'}" changed outside Noa. The external file was kept at "${conflictPath}".`);
    this.name = 'VaultWriteConflictError';
    this.conflictPath = conflictPath;
  }
}

function fingerprintText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function conflictFingerprint(note: Note): string {
  return fingerprintText(`${note.id}\0${note.title}\0${note.folder}\0${note.content}`);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = '';
  let used = 0;
  for (const character of value) {
    const bytes = encoder.encode(character).byteLength;
    if (used + bytes > maxBytes) break;
    result += character;
    used += bytes;
  }
  return result;
}

function buildConflictNote(desiredNote: Note, token: string, now: string): Note {
  const {
    vaultId: _vaultId,
    vaultPath: _vaultPath,
    vaultDirty: _vaultDirty,
    vaultBaseText: _vaultBaseText,
    attachments: _attachments,
    ...conflictBase
  } = desiredNote;
  const suffix = ` (Noa conflict ${token})`;
  const title = `${truncateUtf8(
    desiredNote.title || 'Untitled',
    Math.max(0, 220 - new TextEncoder().encode(suffix).byteLength),
  )}${suffix}`;
  return {
    ...conflictBase,
    id: `noa-conflict-${desiredNote.id}-${token}`,
    title,
    createdAt: now,
    updatedAt: now,
    source: 'obsidian-import',
    origin: 'vault',
  };
}

async function preserveConflictCopy(
  handle: FileSystemDirectoryHandle,
  desiredNote: Note,
  folders: Folder[],
  structuralPayload?: string,
): Promise<string> {
  const baseToken = conflictFingerprint(desiredNote);
  const now = new Date().toISOString();
  let token = baseToken;

  // Conflict copies are write-once. Deterministic candidates make ordinary
  // retries idempotent; if the user edits one, derive a new candidate instead
  // of overwriting their newer external work.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const conflictNote = buildConflictNote(desiredNote, token, now);
    const serialized = serializeNoteForVault(conflictNote);
    // Preserve a UTF-8 BOM without copying the original file's embedded Noa
    // identity into a different conflict note. The conflict file must remain
    // unambiguous even if the manifest is lost or the file is moved.
    const desiredText = structuralPayload?.startsWith('\uFEFF')
      ? `\uFEFF${serialized}`
      : serialized;
    const existingPath = await getNoteFilePath(handle, conflictNote, folders);
    if (existingPath) {
      const existingText = await readVaultNoteText(handle, conflictNote, folders);
      if (existingText === desiredText) return existingPath;
      token = fingerprintText(`${baseToken}\0${token}\0${existingPath}\0${existingText ?? ''}\0${attempt}`);
      continue;
    }
    const written = await writeNoteTracked(handle, conflictNote, folders, desiredText);
    if (!written) throw new Error('Unable to preserve the Noa conflict copy.');
    return written.path;
  }

  // A malicious or extremely unusual vault can pre-create the deterministic
  // chain. A random final candidate remains non-destructive because writeNote
  // itself refuses to overwrite paths owned by another note.
  const fallback = buildConflictNote(
    desiredNote,
    fingerprintText(`${baseToken}\0${crypto.randomUUID()}`),
    now,
  );
  const written = await writeNoteTracked(
    handle,
    fallback,
    folders,
    structuralPayload?.startsWith('\uFEFF')
      ? `\uFEFF${serializeNoteForVault(fallback)}`
      : serializeNoteForVault(fallback),
  );
  if (!written) throw new Error('Unable to preserve the Noa conflict copy.');
  return written.path;
}

async function preserveNoaEditIfDiskChanged(
  handle: FileSystemDirectoryHandle,
  previousNote: Note,
  desiredNote: Note,
  previousFolders: Folder[],
  conflictFolders: Folder[] = previousFolders,
): Promise<void> {
  const diskText = await readVaultNoteText(handle, previousNote, previousFolders);
  const baselineText = previousNote.vaultBaseText ?? serializeNoteForVault(previousNote);
  const desiredText = serializeNoteForVault(desiredNote);
  // The second equality recognizes a Markdown write that landed before a later
  // manifest/attachment step failed. It is Noa's own partial success, not an
  // external edit.
  if (diskText === baselineText || diskText === desiredText) return;
  const exactStructuralPayload = previousNote.vaultBaseText
    && extractContentFromVaultText(previousNote.vaultBaseText) === desiredNote.content
    ? previousNote.vaultBaseText
    : undefined;
  const conflictPath = await preserveConflictCopy(
    handle,
    desiredNote,
    conflictFolders,
    exactStructuralPayload,
  );
  throw new VaultWriteConflictError(desiredNote.title, conflictPath);
}

async function preserveExternalEditBeforeDelete(
  handle: FileSystemDirectoryHandle,
  baselineNote: Note,
  currentNote: Note,
  folders: Folder[],
): Promise<void> {
  const diskText = await readVaultNoteText(handle, currentNote, folders);
  // A file already removed outside Noa satisfies the requested deletion.
  if (diskText === null) return;
  const baselineText = baselineNote.vaultBaseText ?? serializeNoteForVault(baselineNote);
  if (diskText === baselineText || diskText === serializeNoteForVault(currentNote)) return;
  const path = await getNoteFilePath(handle, currentNote, folders)
    ?? currentNote.vaultPath
    ?? `${currentNote.title || 'Untitled'}.md`;
  throw new VaultWriteConflictError(currentNote.title, path, 'external');
}

async function removeNoteFileAtPathTracked(
  handle: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const removed = await removeNoteFileAtPath(handle, path);
  if (removed && _vaultStatSnapshot) _vaultStatSnapshot.delete(path);
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
const _noteWriteBaselines = new Map<string, Note>();

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

/** Put every pending note write onto the global queue without yielding. */
function enqueueAllPendingNoteWrites(): void {
  for (const [noteId, pending] of Array.from(_noteDebounceTimers.entries())) {
    flushNoteWrite(noteId, pending.fn);
  }
}

/** A delete supersedes a debounced update that has not started yet. */
function cancelPendingNoteWrite(noteId: string, keepBaseline = false): void {
  const pending = _noteDebounceTimers.get(noteId);
  if (pending !== undefined) {
    clearTimeout(pending.timer);
    _noteDebounceTimers.delete(noteId);
  }
  const settlers = _notePendingSettlers.get(noteId);
  if (settlers) {
    settlers.forEach((settler) => settler.resolve());
    _notePendingSettlers.delete(noteId);
  }
  if (!keepBaseline) _noteWriteBaselines.delete(noteId);
}

/**
 * Flush every pending debounced note write to disk and wait for the queue to
 * drain. Called before vault scans: the disk is authoritative, so a scan must
 * never read a file that is about to be overwritten by an in-flight edit —
 * the stale disk content would clobber the newer in-memory note.
 */
async function flushAllPendingNoteWrites(): Promise<void> {
  enqueueAllPendingNoteWrites();
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
  onBaselineAdvanced?: (noteId: string, baselineText: string) => void | Promise<void>,
): Promise<void> {
  if (!_noteWriteBaselines.has(note.id)) {
    _noteWriteBaselines.set(note.id, note);
  }
  // Use per-note debounce: rapid typing collapses into one write.
  await debouncedNoteWrite(note.id, async () => {
    const baseline = _noteWriteBaselines.get(note.id) ?? note;
    const nextNote = { ...note, content, updatedAt: new Date().toISOString() };
    try {
      await preserveNoaEditIfDiskChanged(handle, baseline, nextNote, folders);
      await writeNoteTracked(
        handle,
        nextNote,
        folders,
      );
      _noteWriteBaselines.delete(note.id);
    } catch (error) {
      if (error instanceof VaultWriteConflictError) {
        _noteWriteBaselines.delete(note.id);
      } else {
        // Markdown may already be durable even when a later manifest or
        // attachment step fails. Advance the accepted baseline so a queued
        // newer edit is compared against Noa's landed version, not stale A.
        const desiredText = serializeNoteForVault(nextNote);
        try {
          const diskText = await readVaultNoteText(handle, nextNote, folders);
          if (diskText === desiredText) {
            _noteWriteBaselines.set(note.id, { ...nextNote, vaultBaseText: desiredText });
            await onBaselineAdvanced?.(note.id, desiredText);
          }
        } catch {
          // Keep the earlier baseline when read-back cannot confirm durability.
        }
      }
      throw error;
    }
  });
}

export async function syncNoteRename(
  handle: FileSystemDirectoryHandle,
  note: Note,
  newTitle: string,
  folders: Folder[],
): Promise<void> {
  // The pending write still carries the old title/path. Queue it first so the
  // rename is guaranteed to be the final operation for this note.
  const pending = _noteDebounceTimers.get(note.id);
  if (pending) flushNoteWrite(note.id, pending.fn);
  await withVaultLock(async () => {
    const baseline = _noteWriteBaselines.get(note.id) ?? note;
    const nextNote = { ...note, title: newTitle, updatedAt: new Date().toISOString() };
    try {
      await preserveNoaEditIfDiskChanged(handle, baseline, nextNote, folders);
      const previousPath = await getNoteFilePath(handle, note, folders);
      const written = await writeNoteTracked(
        handle,
        nextNote,
        folders,
        note.vaultDirty ? undefined : note.vaultBaseText,
      );
      if (previousPath && written && previousPath !== written.path) {
        await removeNoteFileAtPathTracked(handle, previousPath);
      }
      _noteWriteBaselines.delete(note.id);
    } catch (error) {
      if (error instanceof VaultWriteConflictError) _noteWriteBaselines.delete(note.id);
      throw error;
    }
  });
}

export async function syncNoteDelete(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<void> {
  // A not-yet-started content write is obsolete once the note is deleted. An
  // already queued write remains ahead of this delete via the global lock.
  const baseline = _noteWriteBaselines.get(note.id) ?? note;
  cancelPendingNoteWrite(note.id, true);
  await withVaultLock(async () => {
    try {
      await preserveExternalEditBeforeDelete(handle, baseline, note, folders);
      await deleteNoteFileTracked(handle, note, folders);
      _noteWriteBaselines.delete(note.id);
    } catch (error) {
      if (error instanceof VaultWriteConflictError) _noteWriteBaselines.delete(note.id);
      throw error;
    }
  });
}

export async function syncNoteMove(
  handle: FileSystemDirectoryHandle,
  previousNote: Note,
  nextNote: Note,
  folders: Folder[],
): Promise<void> {
  if (nextNote.origin !== 'vault') return;
  if (nextNote.folder) {
    const targetFolder = folders.find((folder) => folder.id === nextNote.folder);
    if (targetFolder?.origin !== 'vault') return;
  }
  const pending = _noteDebounceTimers.get(previousNote.id);
  if (pending) flushNoteWrite(previousNote.id, pending.fn);
  await withVaultLock(async () => {
    const baseline = _noteWriteBaselines.get(previousNote.id) ?? previousNote;
    try {
      await preserveNoaEditIfDiskChanged(handle, baseline, nextNote, folders);
      const previousPath = await getNoteFilePath(handle, previousNote, folders);
      const written = await writeNoteTracked(
        handle,
        nextNote,
        folders,
        previousNote.vaultDirty ? undefined : previousNote.vaultBaseText,
      );
      if (previousPath && written && previousPath !== written.path) {
        await removeNoteFileAtPathTracked(handle, previousPath);
      }
      _noteWriteBaselines.delete(previousNote.id);
    } catch (error) {
      if (error instanceof VaultWriteConflictError) _noteWriteBaselines.delete(previousNote.id);
      throw error;
    }
  });
}

/**
 * Reconcile the latest cached vault note after a previous write failed or the
 * app restarted with vaultDirty persisted. This is deliberately immediate and
 * idempotent: it writes the desired snapshot, then removes an obsolete path
 * left behind by a failed rename/move.
 */
export async function syncVaultNoteSnapshot(
  handle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<VaultWriteConflictError | null> {
  if (note.origin !== 'vault') return null;
  return withVaultLock(async () => {
    const baseline = _noteWriteBaselines.get(note.id) ?? note;
    const previousPath = await getNoteFilePath(handle, note, folders);
    try {
      await preserveNoaEditIfDiskChanged(handle, baseline, note, folders);
    } catch (error) {
      if (error instanceof VaultWriteConflictError) {
        _noteWriteBaselines.delete(note.id);
        return error;
      }
      throw error;
    }
    const exactStructuralPayload = note.vaultBaseText
      && extractContentFromVaultText(note.vaultBaseText) === note.content
      ? note.vaultBaseText
      : undefined;
    const written = await writeNoteTracked(handle, note, folders, exactStructuralPayload);
    const stalePaths = new Set([previousPath, note.vaultPath].filter((path): path is string => Boolean(path)));
    if (written) stalePaths.delete(written.path);
    for (const path of stalePaths) {
      await removeNoteFileAtPathTracked(handle, path);
    }
    _noteWriteBaselines.delete(note.id);
    return null;
  });
}

export async function syncFolderDelete(
  handle: FileSystemDirectoryHandle,
  folderName: string,
): Promise<void> {
  // Only empty parts of the tree are removed — untracked files (PDFs,
  // .canvas, ...) and their parent directories survive.
  // Flush note writes first so a delayed write cannot recreate the folder.
  enqueueAllPendingNoteWrites();
  await withVaultLock(() => removeEmptyFolderTree(handle, folderName));
}

export async function syncFolderRename(
  handle: FileSystemDirectoryHandle,
  folderId: string,
  previousName: string,
  currentFolders: Folder[],
  notes: Note[],
): Promise<void> {
  // Pending note payloads still reference the old folder tree. Queue them
  // before the rename so the structural operation remains last.
  enqueueAllPendingNoteWrites();
  await withVaultLock(async () => {
    const nextFolder = currentFolders.find((folder) => folder.id === folderId);
    if (nextFolder?.origin !== 'vault') return;

    // currentFolders already has the new names, so match against the new folder's
    // id plus any child that was a descendant of previousName (now updated to
    // the new prefix).  We derive the new prefix from nextFolder to avoid
    // matching stale previousName in already-renamed currentFolders.
    const newPrefix = nextFolder.name;
    const affectedFolderIds = new Set(
      currentFolders
        .filter((folder) =>
          folder.origin === 'vault'
          && (folder.id === folderId || folder.name.startsWith(`${newPrefix}/`)))
        .map((folder) => folder.id)
    );

    // Folder list as it looked before the rename, so each note's old file can
    // be located when the manifest has no entry for it.
    const previousFolders = currentFolders.map((folder) =>
      affectedFolderIds.has(folder.id)
        ? { ...folder, name: previousName + folder.name.slice(newPrefix.length) }
        : folder
    );

    const affectedNotes = notes.filter((note) =>
      note.origin === 'vault' && affectedFolderIds.has(note.folder)
    );
    // Validate the whole batch before moving anything. Otherwise a conflict
    // halfway through could leave a partially renamed folder tree.
    for (const note of affectedNotes) {
      const baseline = _noteWriteBaselines.get(note.id) ?? note;
      try {
        await preserveNoaEditIfDiskChanged(handle, baseline, note, previousFolders, currentFolders);
      } catch (error) {
        if (error instanceof VaultWriteConflictError) _noteWriteBaselines.delete(note.id);
        throw error;
      }
    }

    // Move managed notes one by one instead of deleting the directory tree —
    // vault folders may contain files Noa does not track, and those must survive.
    for (const note of affectedNotes) {
      const previousPath = await getNoteFilePath(handle, note, previousFolders);
      const written = await writeNoteTracked(
        handle,
        note,
        currentFolders,
        note.vaultDirty ? undefined : note.vaultBaseText,
      );
      if (previousPath && written && previousPath !== written.path) {
        await removeNoteFileAtPathTracked(handle, previousPath);
      }
      _noteWriteBaselines.delete(note.id);
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

export async function replayVaultPendingOperation(
  handle: FileSystemDirectoryHandle,
  operation: VaultPendingOperation,
  notes: Note[],
): Promise<void> {
  if (operation.kind === 'delete-note') {
    await syncNoteDelete(handle, operation.note, operation.folders);
    return;
  }
  if (operation.kind === 'rename-folder') {
    await syncFolderRename(
      handle,
      operation.folderId,
      operation.previousName,
      operation.nextFolders,
      notes,
    );
    return;
  }
  await syncFolderDelete(handle, operation.folder.name);
}

export function classifySyncError(error: unknown): FileSyncError {
  return toFileSyncError(error);
}
