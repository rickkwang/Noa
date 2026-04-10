import { STORAGE_KEYS } from '../constants/storageKeys';
import { lsGetJson, lsSetJson } from './safeLocalStorage';

const RECENT_NOTES_KEY = STORAGE_KEYS.RECENT_NOTES;
const MAX_RECENT = 10;

export function loadRecentNoteIds(): string[] {
  const parsed = lsGetJson<unknown[]>(RECENT_NOTES_KEY);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
}

export function saveRecentNoteIds(ids: string[]): void {
  lsSetJson(RECENT_NOTES_KEY, ids);
}

export function addRecentNoteId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENT);
}
