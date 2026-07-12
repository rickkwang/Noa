import type { Folder, Note } from '../types';

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

/** Strip cache ownership markers from folders supplied by external imports. */
export function stripVaultMetadataFromImportedFolders(folders: Folder[]): Folder[] {
  return folders.map(({ origin: _origin, vaultPath: _vaultPath, ...folder }) => folder);
}
