import { Note } from '../types';

function toTimestamp(value?: string): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

// Deterministic note ordering for bootstrap and restore paths.
export function sortNotesByRecent(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const updatedDelta = toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;

    const createdDelta = toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    if (createdDelta !== 0) return createdDelta;

    return a.id.localeCompare(b.id);
  });
}
