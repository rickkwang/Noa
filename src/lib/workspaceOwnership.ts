import type { Folder, Note } from '../types';

/**
 * Create target meaning "the connected vault's root". Vault root has no folder
 * row (note.folder is ''), so creation needs a name for it that cannot be
 * mistaken for a Noa folder id.
 */
export const VAULT_ROOT_FOLDER_ID = '__vault_root__';

export interface NoaOwnedWorkspace {
  notes: Note[];
  folders: Folder[];
}

/**
 * Select rows owned by Noa for backup and export operations.
 *
 * `source` describes how a row was originally imported, not who owns it, so
 * one-time Obsidian imports remain included unless they are explicitly marked
 * as a live Vault cache row.
 */
export function selectNoaOwnedWorkspace(notes: Note[], folders: Folder[]): NoaOwnedWorkspace {
  return {
    notes: notes.filter((note) => note.origin !== 'vault'),
    folders: folders.filter((folder) => folder.origin !== 'vault'),
  };
}

/**
 * Cached vault rows mean the vault is the workspace, even before its handle
 * restores. App.tsx also counts a live handle.
 */
export function hasVaultRows(notes: Note[], folders: Folder[]): boolean {
  return notes.some((note) => note.origin === 'vault') || folders.some((folder) => folder.origin === 'vault');
}

/**
 * The note to open on launch: the session as it was left. Only notes of the
 * workspace that will be shown qualify, so a Noa note hidden behind a vault is
 * never opened. With tabs saved, an empty strip means the user closed every
 * tab, so nothing opens. Without them (first run after an upgrade), fall back
 * to the last active note, then the first one.
 */
export function pickInitialActiveNoteId(
  notes: Note[],
  folders: Folder[],
  lastActiveId: string | null,
  savedOpenTabIds: string[] | null,
): string {
  const vault = hasVaultRows(notes, folders);
  const visible = new Set(notes.filter((note) => !vault || note.origin === 'vault').map((note) => note.id));
  if (savedOpenTabIds) {
    const open = savedOpenTabIds.filter((id) => visible.has(id));
    if (lastActiveId && open.includes(lastActiveId)) return lastActiveId;
    return open[open.length - 1] ?? '';
  }
  if (lastActiveId && visible.has(lastActiveId)) return lastActiveId;
  return notes.find((note) => visible.has(note.id))?.id ?? '';
}

/** Strip cache ownership markers from folders supplied by external imports. */
export function stripVaultMetadataFromImportedFolders(folders: Folder[]): Folder[] {
  return folders.map(({ origin: _origin, vaultPath: _vaultPath, ...folder }) => folder);
}
