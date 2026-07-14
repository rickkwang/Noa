import type { Note } from '../types';
import type { ImportedNote } from './attachmentUtils';

export function reconcileConcurrentImportEdits(
  importedNotes: ImportedNote[],
  latestNotes: Note[],
  deferredNotes: ReadonlyMap<string, Note>,
  shouldPrune: boolean,
  deletedNoteIds: readonly string[] = [],
): ImportedNote[] {
  const latestById = new Map(latestNotes.map((note) => [note.id, note]));
  const overlaid = importedNotes.map((imported) => {
    const latest = latestById.get(imported.id);
    if (latest?.origin === 'vault' && latest.vaultDirty) return latest;
    return deferredNotes.get(imported.id) ?? imported;
  });
  if (!shouldPrune) return overlaid;

  const importedIds = new Set(importedNotes.map((note) => note.id));
  const externallyDeleted = new Set(deletedNoteIds);
  const rescued = latestNotes.filter((note) => {
    if (importedIds.has(note.id)) return false;
    if (note.origin === 'vault') return note.vaultDirty === true;
    return !externallyDeleted.has(note.id);
  });
  return rescued.length > 0 ? [...overlaid, ...rescued] : overlaid;
}
