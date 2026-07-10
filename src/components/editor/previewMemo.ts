import type { Note } from '../../types';

/**
 * Keep the note context used by react-markdown components stable while only
 * the active note's body changes. The active body is supplied separately as
 * `note`; this array is used for link structure and embedded-note content.
 */
export function canReusePreviewContextNotes(
  previous: Note[],
  next: Note[],
  activeNoteId: string,
): boolean {
  if (previous.length !== next.length) return false;
  return next.every((note, index) => {
    const prior = previous[index];
    if (!prior || prior.id !== note.id) return false;
    if (note.id === activeNoteId) {
      return prior.title === note.title && prior.folder === note.folder;
    }
    return prior.title === note.title
      && prior.content === note.content
      && prior.folder === note.folder
      && prior.attachments === note.attachments;
  });
}
