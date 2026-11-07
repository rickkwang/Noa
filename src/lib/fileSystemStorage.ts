import localforage from 'localforage';
import { Note, Folder, Attachment } from '../types';
import { blobToBase64, inferAttachmentMimeType, mapAttachmentReferences, resolveAttachmentPath } from './attachmentUtils';
import { extractObsidianCreatedAt, extractObsidianTags, splitFrontmatter } from './frontmatter';
import { sanitizeFilename, sanitizeFolderPath } from './importUtils';
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
  pendingCreate?: 'reserved' | 'publishing' | true;
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
    // No permission prompt at bootstrap; the user reconnects explicitly.
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

// Unlike sanitizeFolderPath, also collapses whitespace; used only for
// attachments/ directory names. sanitizeFolderPath must keep spaces, since
// manifest keys and scan matching compare against real on-disk names.
function sanitizePathSegment(name: string): string {
  return sanitizeFilename(name).replace(/\s+/g, '_');
}

// Strips Noa-owned keys. Only call on Noa-authored frontmatter (source ===
// 'noa'): Obsidian users' own id:/links:/createdAt: keys must be preserved.
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
 *   meta     — Noa-owned keys only. Trust these only on Noa-authored files
 *              (noaSource/manifest); Obsidian users' id:/links: must not be adopted.
 *   rawBlock — YAML between the --- delimiters, verbatim, for byte-exact write-back.
 *   content  — body after the closing ---.
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

export function extractContentFromVaultText(exactText: string): string {
  const text = exactText.startsWith('\uFEFF') ? exactText.slice(1) : exactText;
  return parseFrontMatter(text).content;
}

function yamlScalar(value: string): string {
  if (/[:#\n\r"']/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  return value;
}

function rawFrontmatterHasTopLevelKey(rawBlock: string, key: string): boolean {
  return rawBlock.split('\n').some((line) => line.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1] === key);
}

function vaultDiskNoteId(note: Note): string {
  return note.vaultId?.trim() || note.id;
}

function tagFrontmatterLines(tags: string[]): string[] {
  return ['tags:', ...tags.map((tag) => `  - ${yamlScalar(tag)}`)];
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
 * Noa notes write only the user's own keys plus tags — identity lives in
 * .noa/manifest.json, so the file carries no Noa-specific frontmatter.
 */
function buildFrontMatter(note: Note): string {
  if ((note.source ?? 'noa') !== 'noa') {
    // Imported notes: reproduce the user's frontmatter byte-for-byte so an
    // unmodified note never alters the original file.
    const rawBlock = note.rawFrontmatter ?? '';
    if (note.rawFrontmatter !== undefined) {
      const eol = note.frontmatterEol ?? (rawBlock.includes('\r\n') ? '\r\n' : '\n');
      return `---${eol}${rawBlock}${eol}---${eol}`;
    }
    if (!note.tags?.length) return '';
    return `---\n${tagFrontmatterLines(note.tags).join('\n')}\n---\n`;
  }

  // Legacy Noa files carried id/createdAt/noaSource; strip them on write-back.
  const sanitized = sanitizeRawFrontmatter(note.rawFrontmatter ?? '');
  const lines = sanitized ? sanitized.split('\n') : [];
  if (note.tags?.length && !rawFrontmatterHasTopLevelKey(sanitized, 'tags')) {
    lines.push(...tagFrontmatterLines(note.tags));
  }
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
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

// App data lives in hidden .noa/ so it never shows up as vault content. Reads
// fall back to a root-level manifest.json; writes leave that file alone since
// it may not be Noa's.
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

function attachmentVaultFileName(attachment: Attachment): string {
  return `${sanitizePathSegment(attachment.id)}-${sanitizeFilename(attachment.filename)}`;
}

function noaAttachmentDir(note: Note): string {
  return `attachments/${sanitizePathSegment(vaultDiskNoteId(note))}/`;
}

function attachmentVaultPath(note: Note, attachment: Attachment): string {
  return attachment.vaultPath ?? `${noaAttachmentDir(note)}${attachmentVaultFileName(attachment)}`;
}

// Images the scan found elsewhere in the vault belong to the user: Noa neither
// copies them into its attachment folder nor rewrites embeds that point at them.
function isNoaOwnedAttachment(note: Note, attachment: Attachment): boolean {
  return !attachment.vaultPath || attachment.vaultPath.startsWith(noaAttachmentDir(note));
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

async function fileExistsAtPath(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  const segments = path.split('/').filter(Boolean);
  const filename = segments.pop();
  if (!filename) return false;
  const parent = segments.length > 0
    ? await ensureDirectory(rootHandle, segments, false)
    : rootHandle;
  return parent ? fileExists(parent, filename) : false;
}

async function readUtf8TextPreservingBom(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hasBom = bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf;
  const text = new TextDecoder('utf-8').decode(hasBom ? bytes.subarray(3) : bytes);
  return hasBom ? `\uFEFF${text}` : text;
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
  const fileName = attachmentVaultFileName(attachment);
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
  // Obsidian-imported notes' attachment folders belong to the vault; never modify them.
  if ((note.source ?? 'noa') !== 'noa') return;
  const attachments = (note.attachments ?? []).filter((att) => isNoaOwnedAttachment(note, att));
  if (!attachments.length) return;

  const dirHandle = await ensureDirectory(rootHandle, ['attachments', sanitizePathSegment(vaultDiskNoteId(note))]);
  if (!dirHandle) return;
  const expected = new Set(attachments.map((att) => attachmentVaultFileName(att)));
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
  await Promise.all(attachments.map((attachment) => writeAttachment(rootHandle, note, attachment)));
}

function rewriteAttachmentEmbedsForVault(note: Note): string {
  const attachments = (note.attachments ?? []).filter((att) => isNoaOwnedAttachment(note, att));
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

export function serializeNoteForVault(note: Note): string {
  return buildFrontMatter(note) + rewriteAttachmentEmbedsForVault(note);
}

export interface WrittenNoteFile {
  path: string;
  lastModified: number;
  size: number;
}

type PendingVaultConflict = { note: Note; diskText: string | null; unconfirmedCreate?: true };

export class VaultWriteConflictError extends Error {
  readonly conflictPath: string;
  readonly pending?: PendingVaultConflict;

  constructor(noteTitle: string, conflictPath: string, pending?: PendingVaultConflict) {
    super(pending?.unconfirmedCreate
      ? `Vault conflict: Noa could not confirm the previous save of "${noteTitle || 'Untitled'}".`
      : pending ? `Vault conflict: "${noteTitle || 'Untitled'}" changed outside Noa. Writing paused; choose which version to keep.`
      : `Vault conflict: "${noteTitle || 'Untitled'}" changed outside Noa. The external file was kept at "${conflictPath}".`);
    this.name = 'VaultWriteConflictError';
    this.conflictPath = conflictPath;
    this.pending = pending;
  }
}

export interface WriteNoteOptions {
  firstWrite?: boolean;
  recovering?: boolean;
  expectedDiskText?: string | null;
  onFirstWriteCommitted?: (path: string, payload: string) => void | Promise<void>;
}

export async function writeNote(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
  payloadOverride?: string,
  existingPath?: string,
  options?: WriteNoteOptions,
): Promise<WrittenNoteFile | null> {
  // Defense in depth: only vault-origin notes are ever written to disk.
  if (note.origin !== 'vault') return null;
  const diskNoteId = vaultDiskNoteId(note);
  const manifest = await readVaultManifest(rootHandle);
  const existingManifestEntry = manifestEntryForId(manifest, diskNoteId);
  if (options?.firstWrite && existingManifestEntry?.[1].pendingCreate) {
    const [path, { pendingCreate }] = existingManifestEntry;
    const diskText = await readVaultNoteTextAtPath(rootHandle, path);
    // Opening a new handle can leave an empty file before publishing starts.
    if (pendingCreate !== 'reserved' || diskText === '') {
      throw new VaultWriteConflictError(note.title, path, { note, diskText, unconfirmedCreate: true });
    }
  }
  const folder = folders.find(f => f.id === note.folder);
  // A non-root destination must be a vault-origin folder, so private Noa folder
  // names never leak into the connected vault.
  if (note.folder && (!folder || folder.origin !== 'vault')) return null;
  const existingSegments = existingPath?.split('/').filter(Boolean);
  const existingFilename = existingSegments?.pop();
  const dirHandle = existingFilename
    ? await ensureDirectory(rootHandle, existingSegments!, false)
    : folder ? await getFolderHandle(rootHandle, folder.name) : rootHandle;
  if (!dirHandle) return null;

  const baseName = sanitizeFilename(note.title || 'Untitled');
  const defaultFilename = `${baseName}.md`;
  const preferredPath = relativeNotePath(folder?.name, defaultFilename);
  const suffixedFilename = `${baseName}_${noteCollisionSuffix(diskNoteId)}.md`;
  const suffixedPath = relativeNotePath(folder?.name, suffixedFilename);
  const owns = (path: string) => note.vaultPath === path
    || (manifest.notes[path]?.id === diskNoteId && !manifest.notes[path].pendingCreate);
  const payload = payloadOverride ?? serializeNoteForVault(note);
  // Old versions could leave a matching Markdown file with no ownership record.
  // Preserve the file and ask before adopting it or creating a second copy.
  if (options?.recovering && !existingManifestEntry) {
    for (const [path, filename] of [[preferredPath, defaultFilename], [suffixedPath, suffixedFilename]]) {
      if (manifest.notes[path]) continue;
      const file = await readVaultFile(dirHandle, filename);
      const diskText = file && await readUtf8TextPreservingBom(file);
      if (diskText !== null && (diskText === payload || diskText === note.vaultBaseText)) {
        throw new VaultWriteConflictError(note.title, path, { note, diskText, unconfirmedCreate: true });
      }
    }
  }

  const preferredOccupied = !existingFilename && !owns(preferredPath) && await fileExists(dirHandle, defaultFilename);
  const filename = existingFilename ?? (preferredOccupied || owns(suffixedPath) ? suffixedFilename : defaultFilename);
  const nextPath = existingPath ?? relativeNotePath(folder?.name, filename);
  const ownsPath = owns(nextPath);
  if (!existingFilename && filename !== defaultFilename && !ownsPath && await fileExists(dirHandle, filename)) {
    throw new Error(`Cannot write "${note.title}": both the preferred and collision-safe vault paths already exist.`);
  }

  const currentEntry = manifest.notes[nextPath];
  const entry = { id: diskNoteId, createdAt: note.createdAt, source: note.source };
  const existingFile = await readVaultFile(dirHandle, filename);
  const diskText = existingFile ? await readUtf8TextPreservingBom(existingFile) : null;
  const conflict = (text: string | null) => new VaultWriteConflictError(note.title, nextPath,
    // A structural destination collision cancels the operation. The edit
    // resolver cannot finish a rename or move or remove its source file.
    existingPath || ownsPath || options?.firstWrite ? { note, diskText: text } : undefined);

  if (options?.expectedDiskText !== undefined && diskText !== options.expectedDiskText) {
    throw conflict(diskText);
  }
  // A destination that looked free may have been created by another app.
  if (!existingPath && !ownsPath && diskText !== null) throw conflict(diskText);
  if (options?.firstWrite && ownsPath && diskText !== payload && diskText !== note.vaultBaseText) {
    throw conflict(diskText);
  }

  const setManifestEntry = async (value: VaultManifestNoteEntry) => {
    if (existingManifestEntry && existingManifestEntry[0] !== nextPath) {
      delete manifest.notes[existingManifestEntry[0]];
    }
    manifest.notes[nextPath] = value;
    await writeVaultManifest(rootHandle, manifest);
  };
  const manifestUnchanged = currentEntry?.id === diskNoteId
    && currentEntry.createdAt === note.createdAt
    && currentEntry.source === note.source
    && !currentEntry.pendingCreate
    && (!existingManifestEntry || existingManifestEntry[0] === nextPath);

  // Never rewrite a byte-identical file, even when only its index needs repair.
  if (existingFile && diskText === payload) {
    if (!manifestUnchanged) await setManifestEntry(entry);
    await syncAttachmentsForNote(rootHandle, note);
    return { path: nextPath, lastModified: existingFile.lastModified, size: existingFile.size };
  }

  // A reservation records intent. Only the completed write establishes ownership.
  const firstWrite = options?.firstWrite && !ownsPath;
  if (firstWrite && (currentEntry?.id !== diskNoteId || currentEntry.pendingCreate !== 'reserved')) {
    await setManifestEntry({ ...entry, pendingCreate: 'reserved' });
  }

  const fileHandle = await dirHandle.getFileHandle(filename, { create: diskText === null }).catch(error => {
    if (diskText !== null && error instanceof DOMException && error.name === 'NotFoundError') throw conflict(null);
    throw error;
  });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(payload);
    if (firstWrite) await setManifestEntry({ ...entry, pendingCreate: 'publishing' });
    const currentFile = await readVaultFile(dirHandle, filename);
    const currentText = currentFile ? await readUtf8TextPreservingBom(currentFile) : null;
    // A newly created handle starts as an empty file. Check again after staging
    // the payload, as close() is what publishes it to the real file.
    if (currentText !== (diskText ?? '')) throw conflict(currentText);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  if (firstWrite) await options?.onFirstWriteCommitted?.(nextPath, payload);
  await setManifestEntry(entry);
  await syncAttachmentsForNote(rootHandle, note);
  // Report the written file's path+mtime so the external-change poller can
  // tell self-writes apart from edits made by other apps.
  const writtenFile = await fileHandle.getFile();
  return { path: nextPath, lastModified: writtenFile.lastModified, size: writtenFile.size };
}

export async function deleteNoteFile(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<string | null> {
  if (note.origin !== 'vault') return null;
  const manifest = await readVaultManifest(rootHandle);
  const manifestEntry = manifestEntryForId(manifest, vaultDiskNoteId(note));
  const path = await getNoteFilePath(rootHandle, note, folders);
  if (path) {
    const segments = path.split('/');
    const filename = segments.pop()!;
    const parent = segments.length ? await ensureDirectory(rootHandle, segments, false) : rootHandle;
    if (!parent) return null;
    const file = await (await parent.getFileHandle(filename)).getFile();
    // A separate directory for each deletion preserves paths and earlier copies.
    const trash = await ensureDirectory(rootHandle, ['.trash', crypto.randomUUID(), ...segments], true);
    if (!trash) throw new Error('Could not create the vault trash folder.');
    const writable = await (await trash.getFileHandle(filename, { create: true })).createWritable();
    await writable.write(file);
    await writable.close();
    await parent.removeEntry(filename);
  }
  // Attachments can be shared and are needed if the note is restored from trash.
  if (manifestEntry) {
    delete manifest.notes[manifestEntry[0]];
    await writeVaultManifest(rootHandle, manifest);
  }
  return path;
}

/** True when `path` is where the note's title and folder already map, modulo host-legal characters. */
export function isNoteAtCanonicalPath(path: string, note: Note, folders: Folder[]): boolean {
  const folder = folders.find((item) => item.id === note.folder);
  const baseName = sanitizeFilename(note.title || 'Untitled');
  const canonical = sanitizeFolderPath(path);
  return canonical === relativeNotePath(folder?.name, `${baseName}.md`)
    || canonical === relativeNotePath(folder?.name, `${baseName}_${noteCollisionSuffix(vaultDiskNoteId(note))}.md`);
}

export async function isPendingVaultNoteCreate(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
): Promise<boolean> {
  if (note.vaultPath || note.source !== 'noa') return false;
  const entry = manifestEntryForId(await readVaultManifest(rootHandle), vaultDiskNoteId(note));
  return !entry || Boolean(entry[1].pendingCreate);
}

export async function releaseVaultCreateReservation(rootHandle: FileSystemDirectoryHandle, note: Note): Promise<void> {
  const manifest = await readVaultManifest(rootHandle);
  const entry = manifestEntryForId(manifest, vaultDiskNoteId(note));
  if (!entry?.[1].pendingCreate) return;
  delete manifest.notes[entry[0]];
  await writeVaultManifest(rootHandle, manifest);
}

/** Resolve the current on-disk path before a structural write changes manifest state. */
export async function getNoteFilePath(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
  includeMissing = false,
): Promise<string | null> {
  if (note.origin !== 'vault') return null;
  const diskNoteId = vaultDiskNoteId(note);
  const manifest = await readVaultManifest(rootHandle);
  const manifestEntry = manifestEntryForId(manifest, diskNoteId);
  if (manifestEntry && !manifestEntry[1].pendingCreate && await fileExistsAtPath(rootHandle, manifestEntry[0])) {
    return manifestEntry[0];
  }
  if (note.vaultPath && await fileExistsAtPath(rootHandle, note.vaultPath)) {
    return note.vaultPath;
  }
  // A missing known file must never resolve to a same-titled sibling.
  if (manifestEntry || note.vaultPath) {
    return includeMissing ? note.vaultPath ?? (manifestEntry?.[1].pendingCreate ? null : manifestEntry?.[0] ?? null) : null;
  }

  const folder = folders.find((item) => item.id === note.folder);
  if (note.folder && folder?.origin !== 'vault') return null;
  const dirHandle = folder ? await getFolderHandle(rootHandle, folder.name, false) : rootHandle;
  if (!dirHandle) return null;
  const baseName = sanitizeFilename(note.title || 'Untitled');
  for (const filename of [`${baseName}.md`, `${baseName}_${noteCollisionSuffix(diskNoteId)}.md`]) {
    const path = relativeNotePath(folder?.name, filename);
    const owner = manifest.notes[path];
    if (owner && owner.id !== diskNoteId) continue;
    if (await fileExists(dirHandle, filename)) return path;
  }
  return null;
}

/** Read the exact current payload of the managed Markdown file. */
export async function readVaultNoteText(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[],
): Promise<string | null> {
  const path = await getNoteFilePath(rootHandle, note, folders);
  return path ? readVaultNoteTextAtPath(rootHandle, path) : null;
}

export async function readVaultNoteTextAtPath(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<string | null> {
  const segments = path.split('/').filter(Boolean);
  const filename = segments.pop();
  if (!filename) return null;
  const parent = segments.length > 0
    ? await ensureDirectory(rootHandle, segments, false)
    : rootHandle;
  if (!parent) return null;
  const file = await readVaultFile(parent, filename);
  return file ? readUtf8TextPreservingBom(file) : null;
}

async function readVaultFile(dir: FileSystemDirectoryHandle, filename: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(filename)).getFile();
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && String(error.name) === 'NotFoundError') return null;
    throw error;
  }
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
      // Non-recursive removeEntry fails on non-empty dirs, preserving untracked files.
      await dirHandle.removeEntry(name);
    } catch {
      // Directory still has content — keep it.
    }
  }
  const remaining: string[] = [];
  for await (const [name] of dirHandle.entries()) remaining.push(name);
  if (remaining.length === 1 && remaining[0] === '.DS_Store') {
    // Finder's .DS_Store must not keep an otherwise empty folder alive.
    try {
      await dirHandle.removeEntry('.DS_Store');
    } catch {
      // Finder may have removed or rewritten it meanwhile — leave as is.
    }
  }
}

/**
 * Remove only the empty parts of a folder tree. Untracked vault files and
 * their parent directories must survive folder renames.
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

/** Collect directory paths and file mtime/size without reading contents. */
export async function scanNoteFileStats(
  rootHandle: FileSystemDirectoryHandle
): Promise<Map<string, string>> {
  const stats = new Map<string, string>();
  const MAX_DIR_DEPTH = 50;
  async function walk(dirHandle: FileSystemDirectoryHandle, pathSegments: string[], depth: number): Promise<void> {
    if (depth > MAX_DIR_DEPTH) return;
    for await (const [name, handle] of dirHandle.entries()) {
      // Hidden entries (.noa, .obsidian, .DS_Store) are never vault content.
      if (name.startsWith('.')) continue;
      if (handle.kind === 'file') {
        if (!name.endsWith('.md') && !pathSegments.includes('attachments')) continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        stats.set([...pathSegments, name].join('/'), `${file.lastModified}:${file.size}`);
      } else if (handle.kind === 'directory') {
        stats.set(`${[...pathSegments, name].join('/')}/`, '');
        await walk(handle as FileSystemDirectoryHandle, [...pathSegments, name], depth + 1);
      }
    }
  }
  await walk(rootHandle, [], 0);
  return stats;
}

export interface ScanDirectoryOptions {
  /** Skip cached payloads only when their disk metadata still matches. */
  existingAttachmentBlobIds?: ReadonlySet<string>;
  existingAttachments?: ReadonlyMap<string, Attachment>;
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
  const imageFiles = new Map<string, FileSystemFileHandle>();
  // Folder names aren't unique across ownership domains: only vault folders may
  // be reused for a disk directory; a same-named Noa folder stays a distinct row.
  const allFolders = folders.filter((folder) => folder.origin === 'vault');
  const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
    handle.kind === 'file';
  const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle =>
    handle.kind === 'directory';

  const MAX_DIR_DEPTH = 50;
  async function readImageHandles(dir: FileSystemDirectoryHandle, path: string[], depth: number): Promise<void> {
    if (depth > MAX_DIR_DEPTH) return;
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      const segments = [...path, name];
      if (isDirectoryHandle(handle)) await readImageHandles(handle, segments, depth + 1);
      else if (isFileHandle(handle) && inferAttachmentMimeType({ name, type: '' }).startsWith('image/')) {
        imageFiles.set(segments.join('/'), handle);
      }
    }
  }
  async function readDir(dirHandle: FileSystemDirectoryHandle, folderId?: string, pathSegments: string[] = [], depth = 0) {
    if (depth > MAX_DIR_DEPTH) {
      console.warn(`[Noa] Vault folder nesting exceeded ${MAX_DIR_DEPTH} levels at "${pathSegments.join('/')}", skipping subtree.`);
      return;
    }
    for await (const [name, handle] of dirHandle.entries()) {
      const currentPath = [...pathSegments, name];
      const currentPathKey = currentPath.join('/');
      // Hidden entries are never vault content.
      if (name.startsWith('.')) continue;
      if (isFileHandle(handle) && name.endsWith('.md')) {
        const file = await handle.getFile();
        const exactText = await readUtf8TextPreservingBom(file);
        const text = exactText.startsWith('\uFEFF') ? exactText.slice(1) : exactText;
        const { meta, rawBlock, content, eol } = parseFrontMatter(text);
        const notePath = currentPath.join('/');
        const entry = manifest.notes[notePath];
        const manifestEntry = entry?.pendingCreate ? undefined : entry;
        const metaSource = meta.noaSource === 'noa' ? 'noa' : undefined;
        const noteSource = manifestEntry?.source ?? metaSource ?? 'obsidian-import';
        // Trust id/createdAt/linkRefs only on Noa-authored files; on Obsidian
        // files they are the user's metadata (adopting a template-duplicated id:
        // would collapse distinct notes into one).
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
        // Strip only the `_xxxxxxxx` suffix Noa appends (it mirrors the note id);
        // user filenames that end in 8 hex chars keep theirs.
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
          // Live mirror of a disk file; lets merge/write guards tell vault rows apart.
          origin: 'vault',
          vaultPath: notePath,
          // Exact bytes, kept until attachments are associated below.
          vaultBaseText: exactText,
          // Verbatim frontmatter (minus Noa's keys) for byte-exact write-back.
          ...(eol ? { rawFrontmatter: preservedFrontmatter, frontmatterEol: eol } : {}),
        });
      } else if (isDirectoryHandle(handle)) {
        if (name === 'attachments') {
          await readImageHandles(handle, currentPath, depth + 1);
          // Noa layout: attachments/{noteId}/{uuid}-{filename}; both must look like UUIDs.
          const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;
          for await (const [noteId, attachmentDir] of handle.entries()) {
            // Non-UUID entries are Obsidian-native attachments; leave them alone.
            if (!isDirectoryHandle(attachmentDir)) continue;
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(noteId)) continue;
            const noteAttachments: Attachment[] = [];
            for await (const [attachmentName, attachmentHandle] of attachmentDir.entries()) {
              if (!isFileHandle(attachmentHandle)) continue;
              // Only Noa-named files.
              const uuidMatch = attachmentName.match(UUID_RE);
              if (!uuidMatch) continue;
              const attachmentId = uuidMatch[1];
              const originalFilename = uuidMatch[2];
              const file = await attachmentHandle.getFile();
              const vaultPath = `attachments/${noteId}/${attachmentName}`;
              const cached = options?.existingAttachments?.get(attachmentId);
              const blobAlreadyStored = options?.existingAttachmentBlobIds?.has(attachmentId)
                && cached?.vaultPath === vaultPath
                && cached.size === file.size
                && cached.createdAt === new Date(file.lastModified).toISOString();
              noteAttachments.push({
                id: attachmentId,
                noteId,
                filename: originalFilename,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
                createdAt: new Date(file.lastModified).toISOString(),
                ...(blobAlreadyStored ? {} : { dataBase64: await fileToBase64(file) }),
                vaultPath,
              });
            }
            if (noteAttachments.length > 0) attachmentsByNoteId.set(noteId, noteAttachments);
          }
        } else {
          let matchedFolder = allFolders.find((folder) => sanitizeFolderPath(folder.name) === currentPathKey);
          if (!matchedFolder) {
            // Disk directory unknown to Noa: create it as a vault-origin folder.
            matchedFolder = { id: crypto.randomUUID(), name: currentPath.join('/'), source: 'obsidian-import' as const, origin: 'vault' as const };
            newFolders.push(matchedFolder);
            allFolders.push(matchedFolder);
          }
          if (!scannedFolders.some((folder) => folder.id === matchedFolder.id)) {
            // Mark every on-disk directory vault-origin so write guards never treat it as Noa-owned.
            scannedFolders.push(matchedFolder.origin === 'vault' ? matchedFolder : { ...matchedFolder, origin: 'vault' as const });
          }
          await readDir(handle, matchedFolder.id, currentPath, depth + 1);
        }
      } else if (isFileHandle(handle) && inferAttachmentMimeType({ name, type: '' }).startsWith('image/')) {
        imageFiles.set(currentPathKey, handle);
      }
    }
  }

  await readDir(rootHandle);
  const imagePaths = new Set(imageFiles.keys());
  for (const note of notes) {
    const noteAttachments = attachmentsByNoteId.get(sanitizePathSegment(note.id)) ?? attachmentsByNoteId.get(note.id);
    if (noteAttachments?.length) {
      note.attachments = noteAttachments;
    }
    const referencedPaths = new Set<string>();
    mapAttachmentReferences(note.content, target => {
      const path = resolveAttachmentPath(target, note.vaultPath ?? '', imagePaths);
      if (path && !note.attachments?.some(a => a.vaultPath === path)) referencedPaths.add(path);
      return undefined;
    });
    for (const path of referencedPaths) {
      const file = await imageFiles.get(path)!.getFile();
      const id = stableVaultId(`attachment:${note.id}:${path}`);
      const createdAt = new Date(file.lastModified).toISOString();
      const cached = options?.existingAttachments?.get(id);
      const blobAlreadyStored = options?.existingAttachmentBlobIds?.has(id)
        && cached?.vaultPath === path && cached.size === file.size && cached.createdAt === createdAt;
      (note.attachments ??= []).push({
        id, noteId: note.id, filename: file.name, mimeType: inferAttachmentMimeType(file),
        size: file.size, createdAt, vaultPath: path,
        ...(blobAlreadyStored ? {} : { dataBase64: await fileToBase64(file) }),
      });
    }
    // Canonical files are rebuilt from fields (no IndexedDB duplicate); non-canonical
    // ones keep exact bytes so the first edit doesn't raise a false conflict.
    if (note.vaultBaseText === serializeNoteForVault(note)) {
      delete note.vaultBaseText;
    }
  }
  // Note ids the manifest tracked when the scan started: any of these whose
  // file is now missing was deleted externally (see mergeScannedNotes).
  const manifestIds = new Set(Object.values(manifest.notes).filter((entry) => !entry.pendingCreate).map((entry) => entry.id));
  return { notes, folders: scannedFolders, newFolders, manifestIds };
}
