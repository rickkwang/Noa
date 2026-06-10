import { Folder, Note } from '../types';
import { extractLinks, extractTags } from './noteUtils';
import { findInvalidAttachmentPayload, type ImportedNote } from './attachmentUtils';

export const TEXT_IMPORT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdown', 'txt', 'text', 'csv', 'tsv', 'json', 'xml',
  'yaml', 'yml', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs',
  'cjs', 'ini', 'toml', 'log',
]);

export const ATTACHMENT_IMPORT_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff',
]);

export interface ConflictSummary {
  sameIdCount: number;
  dupeTitleCount: number;
  newCount: number;
}

export function analyzeConflicts(incoming: Note[], existing: Note[]): ConflictSummary {
  const existingIds = new Set(existing.map(n => n.id));
  const existingTitles = new Set(existing.map(n => n.title));
  let sameIdCount = 0;
  let dupeTitleCount = 0;
  let newCount = 0;
  for (const note of incoming) {
    if (existingIds.has(note.id)) {
      sameIdCount++;
    } else if (existingTitles.has(note.title)) {
      dupeTitleCount++;
    } else {
      newCount++;
    }
  }
  return { sameIdCount, dupeTitleCount, newCount };
}

export function prepareImportedNotes<T extends Note>(notes: T[]): T[] {
  return notes.map((note) => {
    // Obsidian-imported notes own their tags/links via frontmatter, and their
    // content no longer carries that frontmatter — re-extracting from the body
    // would clobber the curated values.
    if ((note.source ?? 'noa') === 'obsidian-import') return note;
    return {
      ...note,
      tags: extractTags(note.content),
      links: extractLinks(note.content),
    };
  });
}

export function validateAttachmentPayloads(notes: ImportedNote[]): string | null {
  return findInvalidAttachmentPayload(notes);
}

export function applyImportStrategy(
  incoming: Note[],
  existing: Note[],
  strategy: 'overwrite' | 'merge' | 'skip',
): Note[] {
  if (strategy === 'overwrite') return incoming;
  const existingIds = new Set(existing.map(n => n.id));
  const existingTitles = new Set(existing.map(n => n.title));
  if (strategy === 'skip') {
    return [...existing, ...incoming.filter(n => !existingIds.has(n.id) && !existingTitles.has(n.title))];
  }
  const merged = [...existing];
  const mergedIds = new Set(existing.map(n => n.id));
  const mergedTitles = new Set(existing.map(n => n.title));
  for (const note of incoming) {
    if (mergedIds.has(note.id) || mergedTitles.has(note.title)) {
      const renamed = { ...note, id: crypto.randomUUID(), title: note.title + ' (imported)' };
      merged.push(renamed);
      mergedIds.add(renamed.id);
      mergedTitles.add(renamed.title);
    } else {
      merged.push(note);
      mergedIds.add(note.id);
      mergedTitles.add(note.title);
    }
  }
  return merged;
}

/**
 * Folders to persist after a JSON import. Only the destructive 'overwrite'
 * strategy may replace the existing folder set; merge/skip preserve current
 * folders (so kept notes don't lose their folder) and append unseen ones.
 */
export function resolveImportedFolders(
  strategy: 'overwrite' | 'merge' | 'skip',
  existing: Folder[],
  incoming: Folder[],
): Folder[] {
  if (strategy === 'overwrite') return incoming;
  const existingIds = new Set(existing.map((folder) => folder.id));
  return [...existing, ...incoming.filter((folder) => !existingIds.has(folder.id))];
}

/** Workspace name to apply after a JSON import; undefined keeps the current name. */
export function resolveImportedWorkspaceName(
  strategy: 'overwrite' | 'merge' | 'skip',
  importedName: unknown,
): string | undefined {
  if (strategy !== 'overwrite') return undefined;
  return typeof importedName === 'string' && importedName.trim() ? importedName : 'Imported Workspace';
}

export function countImportedNotes(
  finalNotes: Note[],
  existingNotes: Note[],
  strategy: 'overwrite' | 'merge' | 'skip',
): number {
  if (strategy === 'overwrite') return finalNotes.length;
  return Math.max(0, finalNotes.length - existingNotes.length);
}

function getFileExtension(name: string): string {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] ?? '';
}

export function getFolderImportPath(file: Pick<File, 'webkitRelativePath'>): string {
  const relativePath = (file.webkitRelativePath || '').trim();
  if (!relativePath) return '';
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  if (parts.length === 2) return parts[0];
  return parts.slice(0, -1).join('/');
}

export function classifyFolderImportFile(file: Pick<File, 'name' | 'type'>): { kind: 'text' | 'attachment' | 'unsupported' } {
  const extension = getFileExtension(file.name);
  const mimeType = file.type || '';
  if (
    mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'application/xhtml+xml'
    || TEXT_IMPORT_EXTENSIONS.has(extension)
  ) {
    return { kind: 'text' };
  }
  if (mimeType.startsWith('image/') || ATTACHMENT_IMPORT_EXTENSIONS.has(extension)) {
    return { kind: 'attachment' };
  }
  return { kind: 'unsupported' };
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Filename for one exported note, unique within its archive directory.
 * Duplicate titles get the vault-style `_<id-prefix>` suffix instead of
 * silently overwriting the earlier entry. Registers the result in usedNames.
 */
export function uniqueExportFilename(
  usedNames: Set<string>,
  title: string,
  noteId: string,
  extension: string,
): string {
  const base = sanitizeFilename(title || 'Untitled');
  let candidate = `${base}${extension}`;
  if (usedNames.has(candidate)) {
    candidate = `${base}_${noteId.slice(0, 8)}${extension}`;
  }
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}_${noteId.slice(0, 8)}_${counter}${extension}`;
    counter += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VAULT_ATTACHMENT_BASENAME_RE = new RegExp(`^(${UUID_SOURCE})-(.+)$`, 'i');
const UUID_ONLY_RE = new RegExp(`^${UUID_SOURCE}$`, 'i');

/**
 * ZIP archive path for an attachment blob. Mirrors the vault-on-disk layout
 * (attachments/{noteId}/{attachmentId}-{filename}) so exported archives and
 * connected vault folders share one format.
 */
export function zipAttachmentPath(noteId: string, attachment: { id: string; filename: string }): string {
  return `attachments/${noteId}/${attachment.id}-${sanitizeFilename(attachment.filename)}`;
}

/**
 * Recover { attachmentId, filename } from a ZIP attachment path. Accepts the
 * vault layout (attachments/{noteId}/{uuid}-{filename}) and the legacy export
 * layout (attachments/{uuid}/{filename}). Returns null when the id cannot be
 * determined — never guesses from dash-splitting, which corrupted ids for
 * filenames containing dashes.
 */
export function parseZipAttachmentPath(path: string): { attachmentId: string; filename: string } | null {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'attachments' || parts.length < 3) return null;
  const basename = parts[parts.length - 1];
  const vaultMatch = basename.match(VAULT_ATTACHMENT_BASENAME_RE);
  if (vaultMatch) {
    return { attachmentId: vaultMatch[1], filename: vaultMatch[2] };
  }
  if (UUID_ONLY_RE.test(parts[1])) {
    return { attachmentId: parts[1], filename: parts.slice(2).join('/') };
  }
  return null;
}

export function sanitizeFolderPath(path: string): string {
  return path.split('/').map((segment) => sanitizeFilename(segment)).filter(Boolean).join('/');
}

export function mergeImportedWorkspaceData(
  existingNotes: Note[],
  existingFolders: Folder[],
  incomingNotes: ImportedNote[],
  incomingFolders: Folder[],
): { notes: ImportedNote[]; folders: Folder[] } {
  const incomingFolderPathById = new Map(incomingFolders.map((folder) => [folder.id, folder.name]));
  const mergedFolders = [...existingFolders];
  const folderKey = (folder: Pick<Folder, 'name' | 'source'>) => `${folder.source ?? 'noa'}::${folder.name}`;
  const mergedFolderIdByPath = new Map(existingFolders.map((folder) => [folderKey(folder), folder.id]));

  for (const folder of incomingFolders) {
    const key = folderKey(folder);
    if (mergedFolderIdByPath.has(key)) continue;
    mergedFolders.push(folder);
    mergedFolderIdByPath.set(key, folder.id);
  }

  const existingTitles = new Set(existingNotes.map((note) => note.title));
  const remappedNotes = incomingNotes.map((note) => {
    const sourcePath = incomingFolderPathById.get(note.folder);
    const resolvedFolderId = sourcePath
      ? (mergedFolderIdByPath.get(`${note.source ?? 'noa'}::${sourcePath}`) ?? note.folder)
      : note.folder;
    const title = existingTitles.has(note.title) ? `${note.title} (imported)` : note.title;
    existingTitles.add(title);
    return { ...note, folder: resolvedFolderId, title };
  });

  return { notes: remappedNotes, folders: mergedFolders };
}
