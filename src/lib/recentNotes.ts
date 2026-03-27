const RECENT_NOTES_KEY = 'redaction-diary-recent-notes';
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
  localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(ids));
}

export function addRecentNoteId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENT);
}
