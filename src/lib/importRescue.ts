import { STORAGE_KEYS } from '../constants/storageKeys';
import { Note } from '../types';
import { lsGetJson, lsRemove, lsSetJson } from './safeLocalStorage';

/**
 * Generous on purpose: converts a *wedged* IndexedDB into a rejection without
 * aborting legitimately slow writes on large vaults.
 */
export const STORAGE_STALL_TIMEOUT_MS = 60_000;

export class StorageStalledError extends Error {
  constructor(label: string) {
    super(`Storage did not respond within ${STORAGE_STALL_TIMEOUT_MS / 1000}s (${label}).`);
    this.name = 'StorageStalledError';
  }
}

/**
 * Reject if `promise` has not settled within `ms`. The operation itself is not
 * cancelled; the point is to return control to the caller's catch/finally, so a
 * hang inside the import lock can't strand the lock forever.
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
 * Returns false when localStorage refuses the write (quota/private mode): the
 * one case where edits are unrecoverable and the user must be told.
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
 * Read parked edits without consuming them; clearing is a separate step so the
 * caller can clear only after the notes are safely back in the real store.
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
 * Drop one note from the parking lot when the user deletes it; otherwise
 * mergeRescuedNotes' append path would resurrect it on next launch.
 */
export function unparkRescuedNote(noteId: string): void {
  const parked = lsGetJson<Note[]>(STORAGE_KEYS.RESCUED_IMPORT_EDITS);
  if (!parked || !Array.isArray(parked)) return;
  lsSetJson(STORAGE_KEYS.RESCUED_IMPORT_EDITS, parked.filter((note) => note?.id !== noteId));
}

/**
 * Overlay rescued edits onto notes just loaded from storage.
 *
 * A parked edit wins only if newer than the stored copy (parking isn't
 * invalidated by later saves, so the stored note may be strictly newer). If
 * either side lacks a comparable updatedAt, the parked edit wins: losing
 * unrecovered text is the greater harm. Parked notes with no stored copy are
 * appended, not dropped; user deletes never reach here (they unpark at source).
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
