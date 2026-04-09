import { STORAGE_KEYS } from '../constants/storageKeys';

const RECENT_NOTES_KEY = STORAGE_KEYS.RECENT_NOTES;
const MAX_RECENT = 10;

export function loadRecentNoteIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_NOTES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecentNoteIds(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(ids));
  } catch { /* quota exceeded */ }
}

export function addRecentNoteId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENT);
}
