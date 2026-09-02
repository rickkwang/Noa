import { STORAGE_KEYS } from '../constants/storageKeys';
import { Note } from '../types';
import { lsGetJson, lsRemove, lsSetJson } from './safeLocalStorage';

/**
 * Generous on purpose. This exists to convert a *wedged* IndexedDB into a
 * rejection, not to police slow ones — a large vault on a slow disk can take
 * tens of seconds legitimately, and aborting that would fail a healthy import.
 */
export const STORAGE_STALL_TIMEOUT_MS = 60_000;

export class StorageStalledError extends Error {
  constructor(label: string) {
    super(`Storage did not respond within ${STORAGE_STALL_TIMEOUT_MS / 1000}s (${label}).`);
    this.name = 'StorageStalledError';
  }
}

/**
 * Reject if `promise` has not settled within the timeout.
 *
 * The underlying operation is not cancelled — it cannot be. The point is to
 * hand control back to the caller's catch/finally: an await that never settles
 * runs neither, so a hang inside the import lock would otherwise strand the
 * lock forever and silently strip every later edit of its write path.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = STORAGE_STALL_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StorageStalledError(label)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Park edits that could not reach IndexedDB so the next launch can restore them.
 * Returns false when localStorage refused the write (quota/private mode), which
 * is the one case where the edits really are unrecoverable and the user has to
 * be told while their text is still on screen.
 */
export function parkRescuedNotes(notes: Note[]): boolean {
  if (notes.length === 0) return true;
  const existing = lsGetJson<Note[]>(STORAGE_KEYS.RESCUED_IMPORT_EDITS) ?? [];
  // Later edit of the same note supersedes the earlier parked copy.
  const byId = new Map(existing.map((note) => [note.id, note]));
  for (const note of notes) byId.set(note.id, note);
  return lsSetJson(STORAGE_KEYS.RESCUED_IMPORT_EDITS, Array.from(byId.values()));
}

/**
 * Read parked edits without consuming them. Clearing is a separate step so the
 * caller can wait until the notes are safely back in the real store — reading
 * destructively would lose them for good if that write then failed.
 */
export function peekRescuedNotes(): Note[] {
  const parked = lsGetJson<Note[]>(STORAGE_KEYS.RESCUED_IMPORT_EDITS);
  if (!parked || !Array.isArray(parked) || parked.length === 0) return [];
  return parked.filter((note): note is Note => Boolean(note && typeof note === 'object' && typeof note.id === 'string'));
}

export function clearRescuedNotes(): void {
  lsRemove(STORAGE_KEYS.RESCUED_IMPORT_EDITS);
}

/**
 * Drop one note from the parking lot. Called when the user deliberately deletes
 * the note — without this, the append path in mergeRescuedNotes would resurrect
 * it on the next launch.
 */
export function unparkRescuedNote(noteId: string): void {
  const parked = lsGetJson<Note[]>(STORAGE_KEYS.RESCUED_IMPORT_EDITS);
  if (!parked || !Array.isArray(parked)) return;
  lsSetJson(STORAGE_KEYS.RESCUED_IMPORT_EDITS, parked.filter((note) => note?.id !== noteId));
}

/**
 * Overlay rescued edits onto the notes just loaded from storage.
 *
 * A parked edit wins only when it is newer than the stored copy: parking is not
 * invalidated by later successful saves, so once IndexedDB recovers mid-session
 * the stored note can hold strictly newer text that must not be clobbered by a
 * stale parked copy. When either side lacks a comparable updatedAt the parked
 * edit keeps winning — losing text the user never got back is the greater harm.
 *
 * Parked notes with no stored copy are appended rather than dropped: an import
 * may have deleted the note, but resurfacing a note the user has to delete
 * again is a smaller harm than discarding text they typed and never got back.
 * User-initiated deletes never reach here — they unpark at the source.
 */
export function mergeRescuedNotes(loaded: Note[], rescued: Note[]): Note[] {
  if (rescued.length === 0) return loaded;
  const rescuedById = new Map(rescued.map((note) => [note.id, note]));
  const merged = loaded.map((note) => {
    const parked = rescuedById.get(note.id);
    if (!parked) return note;
    rescuedById.delete(note.id);
    // The stored copy accepted newer writes after this edit was parked → it wins.
    if (parked.updatedAt && note.updatedAt && parked.updatedAt <= note.updatedAt) return note;
    return parked;
  });
  return [...merged, ...rescuedById.values()];
}
