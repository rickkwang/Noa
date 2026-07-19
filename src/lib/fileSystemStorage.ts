import localforage from 'localforage';
import { Note, Folder, Attachment } from '../types';
import { blobToBase64 } from './attachmentUtils';
import { extractObsidianCreatedAt, extractObsidianTags, splitFrontmatter } from './frontmatter';
import { extractLinks } from './noteUtils';
import { storage } from './storage';

const fsHandleStore = localforage.createInstance({
  name: 'redaction-diary-fs-db',
  storeName: 'fs-handle'
});

const NOA_FRONTMATTER_KEYS = new Set(['id', 'folder', 'links', 'linkRefs', 'createdAt', 'noaSource']);
const VAULT_MANIFEST_FILENAME = 'manifest.json';
const NOA_DATA_DIRNAME = '.noa';

interface VaultManifestNoteEntry {
  id: string;
  createdAt: string;
  source?: Note['source'];
}

interface VaultManifest {
  version: 1;
  vaultId?: string;
  notes: Record<string, VaultManifestNoteEntry>;
}

export function isFileSystemSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

export async function requestDirectoryAccess(): Promise<FileSystemDirectoryHandle> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('File System Access API is not supported in this environment.');
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await fsHandleStore.setItem('root-handle', handle);
}

async function restoreHandleFromStore(
  store: Pick<LocalForage, 'getItem'>
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await store.getItem<FileSystemDirectoryHandle>('root-handle');
    if (!handle) return null;
    // Do not prompt during app bootstrap. Persisted handles should still be
    // restorable so the user can explicitly reconnect or disconnect later.
    return handle;
  } catch {
    return null;
  }
}

export async function getPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  return restoreHandleFromStore(fsHandleStore);
}

export async function clearPersistedHandle(): Promise<void> {
  await fsHandleStore.removeItem('root-handle');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function sanitizePathSegment(name: string): string {
  return sanitizeFilename(name).replace(/\s+/g, '_');
}

// Must apply the exact same per-segment transformation as getFolderHandle —
// manifest keys and scan matching compare against real on-disk directory
// names, which keep their spaces (Obsidian vault folders are created with
// spaces; replacing them here would make every manifest lookup miss).
function sanitizeFolderPath(path: string): string {
  return path
    .split('/')
    .map((segment) => sanitizeFilename(segment))
    .filter(Boolean)
    .join('/');
}

// Strips Noa-owned keys from a frontmatter block. Only ever call this on
// frontmatter Noa itself authored (source === 'noa') — user frontmatter from
// Obsidian vaults commonly contains keys like id:/links:/createdAt: as their
// own metadata, and stripping or reformatting it would corrupt their files.
function sanitizeRawFrontmatter(rawBlock: string): string {
  if (!rawBlock) return '';
  const lines = rawBlock.split(/\r?\n/);
  const kept: string[] = [];
  let skippingList = false;
  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    if (keyMatch) {
      const key = keyMatch[1];
      skippingList = false;
      if (NOA_FRONTMATTER_KEYS.has(key)) {
        const value = line.slice(line.indexOf(':') + 1).trim();
        skippingList = value === '';
        continue;
      }
      kept.push(line);
      continue;
    }
    if (skippingList && /^\s+-\s+/.test(line)) {
      continue;
    }
    skippingList = false;
    kept.push(line);
  }

  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return kept.join('\n');
}

export const __test__ = {
  sanitizeRawFrontmatter,
  buildFrontMatter,
  restoreHandleFromStore,
};

/**
 * Parse frontmatter from a vault file.
 * Returns:
 *   meta      — flat key/value map of Noa-owned fields only (id, folder, tags, links, linkRefs, createdAt).
 *               Callers must only TRUST these on Noa-authored files (noaSource/manifest) — an Obsidian
 *               user's own id:/links: keys land here too and must not be adopted.
 *   rawBlock  — the raw YAML text between the --- delimiters, verbatim (line endings included) so
 *               write-back can round-trip the file byte-for-byte
 *   content   — the body text after the closing ---
 */
function parseFrontMatter(text: string): {
  meta: Record<string, string | string[]>;
  rawBlock: string;
  content: string;
  eol?: '\n' | '\r\n';
} {
  const { rawBlock, body, eol } = splitFrontmatter(text);
  if (!eol) return { meta: {}, rawBlock: '', content: text };
  const meta: Record<string, string | string[]> = {};

  for (const line of rawBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!NOA_FRONTMATTER_KEYS.has(key)) continue; // only parse fields Noa owns
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|["']$/g, '')).filter(Boolean);
    } else {
      meta[key] = val.replace(/^['"]|["']$/g, '');
    }
  }
  return {
    meta,
    rawBlock,
    content: body,
    eol,
  };
}

function yamlScalar(value: string): string {
  if (/[:#\n\r"']/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  return value;
}

function frontmatterLine(key: string, value: string): string {
  return `${key}: ${yamlScalar(value)}`;
}

function rawFrontmatterHasTopLevelKey(rawBlock: string, key: string): boolean {
  return rawBlock.split('\n').some((line) => line.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1] === key);
}

function vaultDiskNoteId(note: Note): string {
  return note.vaultId?.trim() || note.id;
}

function buildNoaFrontmatterLines(note: Note, includeTags = true): string[] {
  const lines = [
    frontmatterLine('id', vaultDiskNoteId(note)),
    frontmatterLine('createdAt', note.createdAt),
    'noaSource: noa',
  ];
  if (includeTags && note.tags?.length) {
    lines.push('tags:', ...note.tags.map((tag) => `  - ${yamlScalar(tag)}`));
  }
  return lines;
}

function stableVaultId(path: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `vault-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function noteCollisionSuffix(noteId: string): string {
  const hexPrefix = noteId.match(/^([0-9a-f]{8})/i)?.[1];
  if (hexPrefix) return hexPrefix.toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < noteId.length; i += 1) {
    hash ^= noteId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Rebuild the frontmatter block for writing back to the vault.
 *
 * Strategy: imported notes keep their sanitized Obsidian frontmatter. Native
 * Noa notes always write enough metadata for a Markdown-only restore.
 */
function buildFrontMatter(note: Note): string {
  if ((note.source ?? 'noa') !== 'noa') {
    // Imported notes: the user (Obsidian) owns this frontmatter. Reproduce it
    // byte-for-byte — matching the block's own line endings — so writing an
    // unmodified note back never alters the original file.
    const rawBlock = note.rawFrontmatter ?? '';
    if (note.rawFrontmatter !== undefined) {
      const eol = note.frontmatterEol ?? (rawBlock.includes('\r\n') ? '\r\n' : '\n');
      return `---${eol}${rawBlock}${eol}---${eol}`;
    }
    if (!note.tags?.length) return '';
    const lines = ['tags:', ...note.tags.map((tag) => `  - ${yamlScalar(tag)}`)];
    return `---\n${lines.join('\n')}\n---\n`;
  }

  const sanitized = sanitizeRawFrontmatter(note.rawFrontmatter ?? '');
  const lines = sanitized
    ? [...sanitized.split('\n'), ...buildNoaFrontmatterLines(note, !rawFrontmatterHasTopLevelKey(sanitized, 'tags'))]
    : buildNoaFrontmatterLines(note);
  return `---\n${lines.join('\n')}\n---\n`;
}

function parseManifestText(text: string): VaultManifest {
  const parsed = JSON.parse(text) as Partial<VaultManifest>;
  if (parsed.version !== 1 || !parsed.notes || typeof parsed.notes !== 'object') {
    return { version: 1, notes: {} };
  }
  const vaultId = typeof parsed.vaultId === 'string' && parsed.vaultId.trim()
    ? parsed.vaultId
    : undefined;
  return {
    version: 1,
    ...(vaultId ? { vaultId } : {}),
    notes: parsed.notes as Record<string, VaultManifestNoteEntry>,
  };
}

/** Return the stable identity for this vault, creating it in Noa's manifest once. */
export async function getVaultIdentity(rootHandle: FileSystemDirectoryHandle): Promise<string> {
  const manifest = await readVaultManifest(rootHandle);
  if (manifest.vaultId) return manifest.vaultId;
  const vaultId = crypto.randomUUID();
  await writeVaultManifest(rootHandle, { ...manifest, vaultId });
  return vaultId;
}

// Noa's app data lives in a hidden .noa/ directory — the Obsidian convention
// (.obsidian/): never place app files where they show up as vault content.
// Older versions wrote manifest.json at the vault root; reads fall back to it
// and the next manifest write removes it.
async function readVaultManifest(rootHandle: FileSystemDirectoryHandle): Promise<VaultManifest> {
  try {
    const noaDir = await rootHandle.getDirectoryHandle(NOA_DATA_DIRNAME);
    const fileHandle = await noaDir.getFileHandle(VAULT_MANIFEST_FILENAME);
    return parseManifestText(await (await fileHandle.getFile()).text());
  } catch {
    // Fall through to the legacy root location.
  }
  try {
    const fileHandle = await rootHandle.getFileHandle(VAULT_MANIFEST_FILENAME);
    return parseManifestText(await (await fileHandle.getFile()).text());
  } catch {
    return { version: 1, notes: {} };
  }
}

async function writeVaultManifest(rootHandle: FileSystemDirectoryHandle, manifest: VaultManifest): Promise<void> {
  const noaDir = await rootHandle.getDirectoryHandle(NOA_DATA_DIRNAME, { create: true });
  const fileHandle = await noaDir.getFileHandle(VAULT_MANIFEST_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(manifest, null, 2));
  await writable.close();
  try {
    await rootHandle.removeEntry(VAULT_MANIFEST_FILENAME);
  } catch {
    // No legacy root manifest to migrate away.
  }
}

function relativeNotePath(folderName: string | undefined, filename: string): string {
  const folderPath = folderName ? sanitizeFolderPath(folderName) : '';
  return folderPath ? `${folderPath}/${filename}` : filename;
}

function manifestEntryForId(manifest: VaultManifest, noteId: string): [string, VaultManifestNoteEntry] | undefined {
  return Object.entries(manifest.notes).find(([, entry]) => entry.id === noteId);
}

async function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file);
}

function attachmentVaultFileName(note: Note, attachment: Attachment): string {
  return `${sanitizePathSegment(attachment.id)}-${sanitizeFilename(attachment.filename)}`;
}

function attachmentVaultPath(note: Note, attachment: Attachment): string {
  return attachment.vaultPath ?? `attachments/${sanitizePathSegment(vaultDiskNoteId(note))}/${attachmentVaultFileName(note, attachment)}`;
}

async function ensureDirectory(
  rootHandle: FileSystemDirectoryHandle,
  path: string[],
  create = true
): Promise<FileSystemDirectoryHandle | null> {
  let current: FileSystemDirectoryHandle | null = rootHandle;
  for (const segment of path) {
    if (!current) return null;
    try {
      current = await current.getDirectoryHandle(segment, { create });
    } catch {
      return null;
    }
  }
  return current;
}

async function getFolderHandle(
  rootHandle: FileSystemDirectoryHandle,
  folderName: string,
  create = true
): Promise<FileSystemDirectoryHandle | null> {
  const segments = folderName.split('/').filter(Boolean).map((segment) => sanitizeFilename(segment));
  if (segments.length === 0) return rootHandle;
  return ensureDirectory(rootHandle, segments, create);
}

async function fileExists(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<boolean> {
  try {
    await dirHandle.getFileHandle(filename);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && String(error.name) === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

/**
 * Materialise a folder as a real directory on disk. Folders are first-class
 * vault objects (as in Obsidian): an empty folder must exist as a directory,
 * otherwise disk-authoritative scans would drop it.
 */
export async function createFolderDirectory(
  rootHandle: FileSystemDirectoryHandle,
  folderPath: string,
): Promise<void> {
  await getFolderHandle(rootHandle, folderPath, true);
}

async function writeAttachment(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  attachment: Attachment
): Promise<void> {
  const dirHandle = await ensureDirectory(rootHandle, ['attachments', sanitizePathSegment(vaultDiskNoteId(note))]);
  if (!dirHandle) return;
  const fileName = attachmentVaultFileName(note, attachment);
  // Attachment blobs are immutable per id — an existing file is already correct.
  try {
    await dirHandle.getFileHandle(fileName);
    return;
  } catch {
    // Not on disk yet — write it below.
  }
  const blob = await storage.getAttachmentBlob(attachment.id);
  if (!blob) return;
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function syncAttachmentsForNote(
  rootHandle: FileSystemDirectoryHandle,
  note: Note
): Promise<void> {
  // Obsidian-imported notes are never owned by Noa — their attachment folders
  // exist in the vault and must not be modified. Only sync attachments for
  // Noa-native notes.
  if ((note.source ?? 'noa') !== 'noa') return;
  if (!(note.attachments?.length)) return;

  const dirHandle = await ensureDirectory(rootHandle, ['attachments', sanitizePathSegment(vaultDiskNoteId(note))]);
  if (!dirHandle) return;
  const expected = new Set((note.attachments ?? []).map((att) => attachmentVaultFileName(note, att)));
  const existingEntries = [] as Array<[string, FileSystemHandle]>;
  for await (const entry of dirHandle.entries()) {
    existingEntries.push(entry);
  }
  await Promise.all(
    existingEntries.map(async ([name, handle]) => {
      if (!expected.has(name) && handle.kind === 'file') {
        await dirHandle.removeEntry(name);
      }
    })
  );
  await Promise.all((note.attachments ?? []).map((attachment) => writeAttachment(rootHandle, note, attachment)));
}

function rewriteAttachmentEmbedsForVault(note: Note): string {
  const attachments = note.attachments ?? [];
  return note.content.replace(/!\[\[(.*?)\]\]/g, (match, rawName) => {
    const name = String(rawName ?? '').trim();
    const attachment = attachments.find((att) =>
      att.filename === name ||
      att.vaultPath === name ||
      att.vaultPath?.endsWith(`/${name}`) ||
      attachmentVaultPath(note, att) === name
    );
    // Embeds that don't resolve to a Noa attachment (note embeds, Obsidian's
    // own attachments) are the user's text — keep them byte-for-byte.
    if (!attachment) return match;
    return `![[${attachmentVaultPath(note, attachment)}]]`;
  });
}

export interface WrittenNoteFile {
  path: string;
  lastModified: number;
}

export async function writeNote(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[]
): Promise<WrittenNoteFile | null> {
  // Defense in depth for mirror mode: only vault-origin notes are ever
  // materialised on disk. A Noa-owned note (no origin marker) reaching this
  // path through a stray caller must never pollute the user's vault.
  if (note.origin !== 'vault') return null;
  const diskNoteId = vaultDiskNoteId(note);
  const manifest = await readVaultManifest(rootHandle);
  const folder = folders.find(f => f.id === note.folder);
  // A vault note may stay at the vault root, but a non-root destination must
  // itself be a vault-origin folder. This prevents cross-section moves from
  // materialising private Noa folder names inside the connected vault.
  if (note.folder && (!folder || folder.origin !== 'vault')) return null;
  const dirHandle = folder
    ? await getFolderHandle(rootHandle, folder.name)
    : rootHandle;
  if (!dirHandle) return null;

  const baseName = sanitizeFilename(note.title || 'Untitled');
  const defaultFilename = `${baseName}.md`;
  const existingManifestEntry = manifestEntryForId(manifest, diskNoteId);
  const preferredPath = relativeNotePath(folder?.name, defaultFilename);
  const preferredOwner = manifest.notes[preferredPath];
  const preferredIsOwned = preferredOwner?.id === diskNoteId
    || existingManifestEntry?.[0] === preferredPath
    || note.vaultPath === preferredPath;
  const preferredOccupied = (preferredOwner !== undefined && preferredOwner.id !== diskNoteId)
    || (!preferredIsOwned && await fileExists(dirHandle, defaultFilename));
  const filename = preferredOccupied
    ? `${baseName}_${noteCollisionSuffix(diskNoteId)}.md`
    : defaultFilename;

  const payload = buildFrontMatter(note) + rewriteAttachmentEmbedsForVault(note);
  const nextPath = relativeNotePath(folder?.name, filename);
  if (filename !== defaultFilename) {
    const alternateOwner = manifest.notes[nextPath];
    const alternateIsOwned = alternateOwner?.id === diskNoteId
      || existingManifestEntry?.[0] === nextPath
      || note.vaultPath === nextPath;
    if (!alternateIsOwned && await fileExists(dirHandle, filename)) {
      throw new Error(`Cannot write "${note.title}": both the preferred and collision-safe vault paths already exist.`);
    }
  }

  // A byte-identical file on disk is never rewritten — unchanged files keep
  // their mtime (git/iCloud/Obsidian treat mtime as "modified", and a scanned
  // note's updatedAt IS the file mtime). This also keeps the first write after
  // connecting an existing vault from touching an unchanged note file.
  const currentEntry = manifest.notes[nextPath];
  const manifestUnchanged =
    currentEntry?.id === diskNoteId &&
    currentEntry.createdAt === note.createdAt &&
    currentEntry.source === note.source &&
    (!existingManifestEntry || existingManifestEntry[0] === nextPath);
  try {
    const existingFile = await (await dirHandle.getFileHandle(filename)).getFile();
    if ((await existingFile.text()) === payload) {
      if (!manifestUnchanged) {
        if (existingManifestEntry && existingManifestEntry[0] !== nextPath) {
          delete manifest.notes[existingManifestEntry[0]];
        }
        manifest.notes[nextPath] = {
          id: diskNoteId,
          createdAt: note.createdAt,
          source: note.source,
        };
        await writeVaultManifest(rootHandle, manifest);
      }
      // Attachments may still be pending even when the text is unchanged.
      await syncAttachmentsForNote(rootHandle, note);
      return { path: nextPath, lastModified: existingFile.lastModified };
    }
  } catch {
    // No file at the target path yet — write it below.
  }

  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(payload);
  await writable.close();
  if (existingManifestEntry && existingManifestEntry[0] !== nextPath) {
    delete manifest.notes[existingManifestEntry[0]];
  }
  manifest.notes[nextPath] = {
    id: diskNoteId,
    createdAt: note.createdAt,
    source: note.source,
  };
  await writeVaultManifest(rootHandle, manifest);
  await syncAttachmentsForNote(rootHandle, note);
  // Report the written file's path+mtime so the external-change poller can
  // tell self-writes apart from edits made by other apps.
  const writtenFile = await fileHandle.getFile();
  return { path: nextPath, lastModified: writtenFile.lastModified };
}

export async function deleteNoteFile(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
  options?: { keepAttachments?: boolean }
): Promise<string | null> {
  // Defense in depth for mirror mode: a Noa-owned note has no vault file, and
  // its title could collide with an unrelated vault file — never let a delete
  // fall through to title heuristics against the vault.
  if (note.origin !== 'vault') return null;
  const diskNoteId = vaultDiskNoteId(note);
  const manifest = await readVaultManifest(rootHandle);
  const manifestEntry = manifestEntryForId(manifest, diskNoteId);

  // The manifest records which file this note id owns — use it so duplicate
  // titles never cause a sibling note's file to be removed.
  let deleted = false;
  let removedPath: string | null = null;
  if (manifestEntry) {
    const segments = manifestEntry[0].split('/').filter(Boolean);
    const parentHandle = segments.length > 1
      ? await ensureDirectory(rootHandle, segments.slice(0, -1), false)
      : rootHandle;
    if (parentHandle) {
      try {
        await parentHandle.removeEntry(segments[segments.length - 1]);
        deleted = true;
        removedPath = manifestEntry[0];
      } catch {
        // Stale manifest path — fall through to title heuristics.
      }
    }
  }

  if (!deleted && note.vaultPath) {
    const removedExactPath = await removeNoteFileAtPath(rootHandle, note.vaultPath);
    if (removedExactPath) {
      deleted = true;
      removedPath = note.vaultPath;
    }
  }

  // Legacy cache rows may predate vaultPath. Only those rows use the title
  // fallback; a modern row with an exact path must never delete a same-titled
  // unrelated file when its own path is already gone.
  if (!deleted && !note.vaultPath) {
    const folder = folders.find(f => f.id === note.folder);
    const dirHandle = folder
      ? await getFolderHandle(rootHandle, folder.name, false)
      : rootHandle;
    if (dirHandle) {
      const baseName = sanitizeFilename(note.title || 'Untitled');
      for (const filename of [`${baseName}.md`, `${baseName}_${noteCollisionSuffix(diskNoteId)}.md`]) {
        // Never remove a path the manifest attributes to a different note.
        const owner = manifest.notes[relativeNotePath(folder?.name, filename)];
        if (owner && owner.id !== diskNoteId) continue;
        try {
          await dirHandle.removeEntry(filename);
          removedPath = relativeNotePath(folder?.name, filename);
          break;
        } catch {
          // try next variant
        }
      }
    }
  }

  if (!options?.keepAttachments) {
    try {
      const attachmentsRoot = await getFolderHandle(rootHandle, 'attachments', false);
      if (attachmentsRoot) {
        await attachmentsRoot.removeEntry(sanitizePathSegment(diskNoteId), { recursive: true });
      }
    } catch {
      // ignore
    }
  }
  if (manifestEntry) {
    delete manifest.notes[manifestEntry[0]];
    await writeVaultManifest(rootHandle, manifest);
  }
  return removedPath;
}

/** Resolve the current on-disk path before a structural write changes manifest state. */
export async function getNoteFilePath(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<string | null> {
  if (note.origin !== 'vault') return null;
  const diskNoteId = vaultDiskNoteId(note);
  const manifest = await readVaultManifest(rootHandle);
  const manifestEntry = manifestEntryForId(manifest, diskNoteId);
  if (manifestEntry) return manifestEntry[0];
  if (note.vaultPath) return note.vaultPath;

  const folder = folders.find((item) => item.id === note.folder);
  if (note.folder && folder?.origin !== 'vault') return null;
  const dirHandle = folder ? await getFolderHandle(rootHandle, folder.name, false) : rootHandle;
  if (!dirHandle) return null;
  const baseName = sanitizeFilename(note.title || 'Untitled');
  for (const filename of [`${baseName}.md`, `${baseName}_${noteCollisionSuffix(diskNoteId)}.md`]) {
    if (await fileExists(dirHandle, filename)) return relativeNotePath(folder?.name, filename);
  }
  return null;
}

/** Remove one exact note path without consulting or mutating the manifest. */
export async function removeNoteFileAtPath(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  const parentHandle = segments.length > 1
    ? await ensureDirectory(rootHandle, segments.slice(0, -1), false)
    : rootHandle;
  if (!parentHandle) return false;
  try {
    await parentHandle.removeEntry(segments[segments.length - 1]);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && String(error.name) === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

async function pruneEmptySubdirectories(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  const subdirs: Array<[string, FileSystemDirectoryHandle]> = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') subdirs.push([name, handle as FileSystemDirectoryHandle]);
  }
  for (const [name, handle] of subdirs) {
    await pruneEmptySubdirectories(handle);
    try {
      // Non-recursive removeEntry only succeeds on empty directories, so any
      // untracked files (PDFs, .canvas, ...) keep their parent chain alive.
      await dirHandle.removeEntry(name);
    } catch {
      // Directory still has content — keep it.
    }
  }
}

/**
 * Remove a folder tree, but only the parts that are empty. Vault folders may
 * contain files Noa does not track; those files (and their parent directories)
 * must survive structural operations like folder renames.
 */
export async function removeEmptyFolderTree(
  rootHandle: FileSystemDirectoryHandle,
  folderPath: string
): Promise<void> {
  const segments = folderPath.split('/').filter(Boolean).map((segment) => sanitizeFilename(segment));
  if (segments.length === 0) return;
  const dirHandle = await ensureDirectory(rootHandle, segments, false);
  if (!dirHandle) return;
  await pruneEmptySubdirectories(dirHandle);
  const parentHandle = segments.length > 1
    ? await ensureDirectory(rootHandle, segments.slice(0, -1), false)
    : rootHandle;
  if (!parentHandle) return;
  try {
    await parentHandle.removeEntry(segments[segments.length - 1]);
  } catch {
    // Not empty (untracked files remain) or already gone — leave as is.
  }
}

/**
 * Lightweight vault walk for external-change polling: collects path → mtime for
 * every markdown note file without reading any file contents. Attachments and
 * hidden/config directories are skipped — polling only watches note files.
 */
export async function scanNoteFileStats(
  rootHandle: FileSystemDirectoryHandle
): Promise<Map<string, number>> {
  const stats = new Map<string, number>();
  const MAX_DIR_DEPTH = 50;
  async function walk(dirHandle: FileSystemDirectoryHandle, pathSegments: string[], depth: number): Promise<void> {
    if (depth > MAX_DIR_DEPTH) return;
    for await (const [name, handle] of dirHandle.entries()) {
      // Hidden entries (.noa, .obsidian, .DS_Store, ...) are never vault
      // content — same convention as Obsidian.
      if (name.startsWith('.')) continue;
      if (handle.kind === 'file') {
        if (!name.endsWith('.md')) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        stats.set([...pathSegments, name].join('/'), file.lastModified);
      } else if (handle.kind === 'directory') {
        if (name === 'attachments') continue;
        await walk(handle as FileSystemDirectoryHandle, [...pathSegments, name], depth + 1);
      }
    }
  }
  await walk(rootHandle, [], 0);
  return stats;
}

export interface ScanDirectoryOptions {
  /**
   * Attachment blob ids already present in storage. Blobs are immutable per
   * id, so their file payloads are skipped instead of being re-read and
   * re-base64'd on every scan — without this, large vaults pay a full
   * attachment read on every merge and can trip the import size guard.
   */
  existingAttachmentBlobIds?: ReadonlySet<string>;
}

export async function scanDirectory(
  rootHandle: FileSystemDirectoryHandle,
  folders: Folder[],
  options?: ScanDirectoryOptions
): Promise<{ notes: Note[]; folders: Folder[]; newFolders: Folder[]; manifestIds: Set<string> }> {
  const manifest = await readVaultManifest(rootHandle);
  const notes: Note[] = [];
  const scannedFolders: Folder[] = [];
  const newFolders: Folder[] = [];
  const attachmentsByNoteId = new Map<string, Attachment[]>();
  // Combined folder lookup: existing + newly created during this scan
  // Folder names are not globally unique across the two ownership domains.
  // Only a previously scanned vault folder may be reused for a disk directory;
  // a same-named Noa folder must remain a distinct local row.
  const allFolders = folders.filter((folder) => folder.origin === 'vault');
  const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
    handle.kind === 'file';
  const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle =>
    handle.kind === 'directory';

  const MAX_DIR_DEPTH = 50;
  async function readDir(dirHandle: FileSystemDirectoryHandle, folderId?: string, pathSegments: string[] = [], depth = 0) {
    if (depth > MAX_DIR_DEPTH) {
      console.warn(`[Noa] Vault folder nesting exceeded ${MAX_DIR_DEPTH} levels at "${pathSegments.join('/')}", skipping subtree.`);
      return;
    }
    for await (const [name, handle] of dirHandle.entries()) {
      const currentPath = [...pathSegments, name];
      const currentPathKey = currentPath.join('/');
      // Hidden entries are never vault content — same convention as Obsidian.
      if (name.startsWith('.')) continue;
      if (isFileHandle(handle) && name.endsWith('.md')) {
        const file = await handle.getFile();
        const text = await file.text();
        const { meta, rawBlock, content, eol } = parseFrontMatter(text);
        const notePath = currentPath.join('/');
        const manifestEntry = manifest.notes[notePath];
        const metaSource = meta.noaSource === 'noa' ? 'noa' : undefined;
        const noteSource = manifestEntry?.source ?? metaSource ?? 'obsidian-import';
        // Only Noa-authored files get their id/createdAt/linkRefs keys trusted
        // (and stripped from the preserved block for re-append on write). On
        // Obsidian files these are the USER's own metadata: adopting a
        // template-duplicated id: would collapse distinct notes into one.
        const trustNoaMeta = noteSource === 'noa';
        const metaId = trustNoaMeta && typeof meta.id === 'string' && meta.id.length > 0 ? meta.id : undefined;
        const metaTags = extractObsidianTags(text);
        const metaLinks = extractLinks(content);
        const metaLinkRefs = trustNoaMeta && Array.isArray(meta.linkRefs) ? meta.linkRefs : [];
        const metaCreatedAt = extractObsidianCreatedAt(text)
          ?? (trustNoaMeta && typeof meta.createdAt === 'string' ? meta.createdAt : undefined);
        const preservedFrontmatter = trustNoaMeta ? sanitizeRawFrontmatter(rawBlock) : rawBlock;
        const noteId = manifestEntry?.id || metaId || stableVaultId(notePath);
        const baseTitle = name.replace(/\.md$/, '');
        const collisionSuffix = noteCollisionSuffix(noteId);
        // Only strip the `_xxxxxxxx` collision suffix Noa itself appends — it
        // always mirrors the owning note id. User filenames that happen to end
        // in eight hex chars (journal_20240115.md) keep their suffix.
        const title = baseTitle.endsWith(`_${collisionSuffix}`)
          ? baseTitle.slice(0, -(collisionSuffix.length + 1))
          : baseTitle;
        notes.push({
          id: noteId,
          title,
          content,
          folder: folderId ?? '',
          tags: metaTags,
          links: metaLinks,
          linkRefs: metaLinkRefs,
          createdAt: manifestEntry?.createdAt || metaCreatedAt || new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          source: noteSource,
          // Every scanned file is a live mirror of a disk file — mark it so the
          // merge and write-path guards can tell vault rows from Noa-owned notes.
          origin: 'vault',
          vaultPath: notePath,
          // Preserved verbatim (minus Noa's own keys on Noa-authored files) for
          // byte-exact round-trip write-back.
          ...(eol ? { rawFrontmatter: preservedFrontmatter, frontmatterEol: eol } : {}),
        });
      } else if (isDirectoryHandle(handle)) {
        if (name === 'attachments') {
          // Attachment filename format written by Noa: `${uuid}-${originalFilename}`
          // UUID has 5 dash-separated groups (8-4-4-4-12 chars = 36 chars total).
          const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;
          // Noa uses a two-level structure: attachments/{noteId}/{uuid}-{filename}
          // The noteId directory name must itself look like a UUID.
          for await (const [noteId, attachmentDir] of handle.entries()) {
            // Skip non-UUID directory names — those are Obsidian-native attachment
            // folders (e.g. a flat "attachments/image.png") and must not be touched.
            if (!isDirectoryHandle(attachmentDir)) continue;
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(noteId)) continue;
            const noteAttachments: Attachment[] = [];
            for await (const [attachmentName, attachmentHandle] of attachmentDir.entries()) {
              if (!isFileHandle(attachmentHandle)) continue;
              // Only read files that match Noa's own naming convention.
              const uuidMatch = attachmentName.match(UUID_RE);
              if (!uuidMatch) continue;
              const attachmentId = uuidMatch[1];
              const originalFilename = uuidMatch[2];
              const file = await attachmentHandle.getFile();
              const blobAlreadyStored = options?.existingAttachmentBlobIds?.has(attachmentId) ?? false;
              noteAttachments.push({
                id: attachmentId,
                noteId,
                filename: originalFilename,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
                createdAt: new Date(file.lastModified).toISOString(),
                ...(blobAlreadyStored ? {} : { dataBase64: await fileToBase64(file) }),
                vaultPath: `attachments/${noteId}/${attachmentName}`,
              });
            }
            if (noteAttachments.length > 0) attachmentsByNoteId.set(noteId, noteAttachments);
          }
        } else {
          let matchedFolder = allFolders.find((folder) => sanitizeFolderPath(folder.name) === currentPathKey);
          if (!matchedFolder) {
            // Directory exists in vault but not in Noa — create it on the fly.
            // origin: 'vault' marks it as a live mirror of the disk directory.
            matchedFolder = { id: crypto.randomUUID(), name: currentPath.join('/'), source: 'obsidian-import' as const, origin: 'vault' as const };
            newFolders.push(matchedFolder);
            allFolders.push(matchedFolder);
          }
          if (!scannedFolders.some((folder) => folder.id === matchedFolder.id)) {
            // Any directory present on disk is a vault folder — mark it so folder
            // write-path guards never mistake it for a Noa-owned folder.
            scannedFolders.push(matchedFolder.origin === 'vault' ? matchedFolder : { ...matchedFolder, origin: 'vault' as const });
          }
          await readDir(handle, matchedFolder.id, currentPath, depth + 1);
        }
      }
    }
  }

  await readDir(rootHandle);
  notes.forEach((note) => {
    const noteAttachments = attachmentsByNoteId.get(sanitizePathSegment(note.id)) ?? attachmentsByNoteId.get(note.id);
    if (noteAttachments?.length) {
      note.attachments = noteAttachments;
    }
  });
  // Note ids the manifest tracked when the scan started: any of these whose
  // file is now missing was deleted externally (see mergeScannedNotes).
  const manifestIds = new Set(Object.values(manifest.notes).map((entry) => entry.id));
  return { notes, folders: scannedFolders, newFolders, manifestIds };
}
