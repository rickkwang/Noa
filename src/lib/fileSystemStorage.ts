import localforage from 'localforage';
import { Note, Folder, Attachment } from '../types';
import { storage } from './storage';
import { extractObsidianCreatedAt, extractObsidianTags } from './frontmatter';
import { extractLinks } from './noteUtils';

const fsHandleStore = localforage.createInstance({
  name: 'redaction-diary-fs-db',
  storeName: 'fs-handle'
});

const NOA_FRONTMATTER_KEYS = new Set(['id', 'folder', 'links', 'linkRefs', 'createdAt']);
const VAULT_MANIFEST_FILENAME = 'manifest.json';

interface VaultManifestNoteEntry {
  id: string;
  createdAt: string;
  source?: Note['source'];
}

interface VaultManifest {
  version: 1;
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
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

function sanitizePathSegment(name: string): string {
  return sanitizeFilename(name).replace(/\s+/g, '_');
}

function sanitizeFolderPath(path: string): string {
  return path
    .split('/')
    .map((segment) => sanitizeFilename(segment).replace(/\s+/g, '_'))
    .filter(Boolean)
    .join('/');
}

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
 *   meta      — flat key/value map of Noa-owned fields only (id, folder, tags, links, linkRefs, createdAt)
 *   rawBlock  — the raw YAML text between the --- delimiters, preserved verbatim for round-trip write-back
 *   content   — the body text after the closing ---
 */
function parseFrontMatter(text: string): {
  meta: Record<string, string | string[]>;
  rawBlock: string;
  content: string;
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, rawBlock: '', content: text };

  const rawBlock = match[1];
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
  return { meta, rawBlock: sanitizeRawFrontmatter(rawBlock), content: match[2] };
}

function yamlScalar(value: string): string {
  if (/[:#\n\r"']/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  return value;
}

/**
 * Rebuild the frontmatter block for writing back to the vault.
 *
 * Strategy: start from the original rawBlock (preserving all Obsidian fields,
 * comments, multi-line values, nested YAML, etc.), then replace only the 6
 * Noa-owned lines in place. If a Noa field doesn't exist yet in rawBlock, it
 * is appended. Everything else is left byte-for-byte identical.
 */
function buildFrontMatter(note: Note): string {
  const sanitized = sanitizeRawFrontmatter(note.rawFrontmatter ?? '');
  if (sanitized) return `---\n${sanitized}\n---\n`;
  if (!(note.tags?.length > 0)) return '';
  const lines = ['tags:', ...note.tags.map((tag) => `  - ${yamlScalar(tag)}`)];
  return `---\n${lines.join('\n')}\n---\n`;
}

async function readVaultManifest(rootHandle: FileSystemDirectoryHandle): Promise<VaultManifest> {
  try {
    const fileHandle = await rootHandle.getFileHandle(VAULT_MANIFEST_FILENAME);
    const text = await (await fileHandle.getFile()).text();
    const parsed = JSON.parse(text) as Partial<VaultManifest>;
    if (parsed.version !== 1 || !parsed.notes || typeof parsed.notes !== 'object') {
      return { version: 1, notes: {} };
    }
    return { version: 1, notes: parsed.notes as Record<string, VaultManifestNoteEntry> };
  } catch {
    return { version: 1, notes: {} };
  }
}

async function writeVaultManifest(rootHandle: FileSystemDirectoryHandle, manifest: VaultManifest): Promise<void> {
  const fileHandle = await rootHandle.getFileHandle(VAULT_MANIFEST_FILENAME, { create: true });
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read attachment.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.split(',')[1] ?? '');
    };
    reader.readAsDataURL(blob);
  });
}

async function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file);
}

function attachmentVaultFileName(note: Note, attachment: Attachment): string {
  return `${sanitizePathSegment(attachment.id)}-${sanitizeFilename(attachment.filename)}`;
}

function attachmentVaultPath(note: Note, attachment: Attachment): string {
  return attachment.vaultPath ?? `attachments/${sanitizePathSegment(note.id)}/${attachmentVaultFileName(note, attachment)}`;
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

async function writeAttachment(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  attachment: Attachment
): Promise<void> {
  const blob = await storage.getAttachmentBlob(attachment.id);
  if (!blob) return;
  const dirHandle = await ensureDirectory(rootHandle, ['attachments', sanitizePathSegment(note.id)]);
  if (!dirHandle) return;
  const fileName = attachmentVaultFileName(note, attachment);
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function syncAttachmentsForNote(
  rootHandle: FileSystemDirectoryHandle,
  note: Note
): Promise<void> {
  const dirHandle = await ensureDirectory(rootHandle, ['attachments', sanitizePathSegment(note.id)]);
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
  return note.content.replace(/!\[\[(.*?)\]\]/g, (_match, rawName) => {
    const name = String(rawName ?? '').trim();
    const attachment = attachments.find((att) =>
      att.filename === name ||
      att.vaultPath === name ||
      att.vaultPath?.endsWith(`/${name}`) ||
      attachmentVaultPath(note, att) === name
    );
    if (!attachment) return `![[${name}]]`;
    return `![[${attachmentVaultPath(note, attachment)}]]`;
  });
}

function folderPathKey(folderName: string): string {
  return sanitizeFolderPath(folderName);
}

export async function writeNote(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[]
): Promise<void> {
  const manifest = await readVaultManifest(rootHandle);
  const folder = folders.find(f => f.id === note.folder);
  const dirHandle = folder
    ? await getFolderHandle(rootHandle, folder.name)
    : rootHandle;
  if (!dirHandle) return;

  const baseName = sanitizeFilename(note.title || 'Untitled');
  const defaultFilename = `${baseName}.md`;
  const existingManifestEntry = manifestEntryForId(manifest, note.id);
  const preferredPath = relativeNotePath(folder?.name, defaultFilename);
  const preferredOwner = manifest.notes[preferredPath];
  const filename = preferredOwner && preferredOwner.id !== note.id
    ? `${baseName}_${note.id.slice(0, 8)}.md`
    : defaultFilename;

  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(buildFrontMatter(note) + rewriteAttachmentEmbedsForVault(note));
  await writable.close();
  const nextPath = relativeNotePath(folder?.name, filename);
  if (existingManifestEntry && existingManifestEntry[0] !== nextPath) {
    delete manifest.notes[existingManifestEntry[0]];
  }
  manifest.notes[nextPath] = {
    id: note.id,
    createdAt: note.createdAt,
    source: note.source,
  };
  await writeVaultManifest(rootHandle, manifest);
  await syncAttachmentsForNote(rootHandle, note);
}

export async function deleteNoteFile(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[]
): Promise<void> {
  const manifest = await readVaultManifest(rootHandle);
  const folder = folders.find(f => f.id === note.folder);
  const dirHandle = folder
    ? await getFolderHandle(rootHandle, folder.name, false)
    : rootHandle;
  if (!dirHandle) return;

  const baseName = sanitizeFilename(note.title || 'Untitled');
  for (const filename of [`${baseName}.md`, `${baseName}_${note.id.slice(0, 8)}.md`]) {
    try {
      await dirHandle.removeEntry(filename);
      break;
    } catch {
      // try next variant
    }
  }
  try {
    const attachmentsRoot = await getFolderHandle(rootHandle, 'attachments', false);
    if (attachmentsRoot) {
      await attachmentsRoot.removeEntry(sanitizePathSegment(note.id), { recursive: true });
    }
  } catch {
    // ignore
  }
  const manifestEntry = manifestEntryForId(manifest, note.id);
  if (manifestEntry) {
    delete manifest.notes[manifestEntry[0]];
    await writeVaultManifest(rootHandle, manifest);
  }
}

export async function deleteFolderTree(
  rootHandle: FileSystemDirectoryHandle,
  folderPath: string
): Promise<void> {
  const segments = folderPath.split('/').filter(Boolean).map((segment) => sanitizeFilename(segment));
  if (segments.length === 0) return;
  const parentSegments = segments.slice(0, -1);
  const folderName = segments[segments.length - 1];
  const parentHandle = parentSegments.length > 0
    ? await ensureDirectory(rootHandle, parentSegments, false)
    : rootHandle;
  if (!parentHandle) return;
  try {
    await parentHandle.removeEntry(folderName, { recursive: true });
  } catch {
    // ignore missing directories during best-effort cleanup
  }
}

export async function scanDirectory(
  rootHandle: FileSystemDirectoryHandle,
  folders: Folder[]
): Promise<{ notes: Note[]; newFolders: Folder[] }> {
  const manifest = await readVaultManifest(rootHandle);
  const notes: Note[] = [];
  const newFolders: Folder[] = [];
  const attachmentsByNoteId = new Map<string, Attachment[]>();
  // Combined folder lookup: existing + newly created during this scan
  const allFolders = [...folders];
  const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
    handle.kind === 'file';
  const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle =>
    handle.kind === 'directory';

  async function readDir(dirHandle: FileSystemDirectoryHandle, folderId?: string, pathSegments: string[] = []) {
    for await (const [name, handle] of dirHandle.entries()) {
      const currentPath = [...pathSegments, name];
      const currentPathKey = currentPath.join('/');
      if (isFileHandle(handle) && name.endsWith('.md')) {
        if (pathSegments.length === 0 && (name === 'README.md' || name === 'manifest.json')) {
          continue;
        }
        const file = await handle.getFile();
        const text = await file.text();
        const { meta, rawBlock, content } = parseFrontMatter(text);
        const notePath = currentPath.join('/');
        const manifestEntry = manifest.notes[notePath];
        const metaId = typeof meta.id === 'string' && meta.id.length > 0 ? meta.id : undefined;
        const metaTags = extractObsidianTags(text);
        const metaLinks = extractLinks(content);
        const metaLinkRefs = Array.isArray(meta.linkRefs) ? meta.linkRefs : [];
        const metaCreatedAt = extractObsidianCreatedAt(text) ?? (typeof meta.createdAt === 'string' ? meta.createdAt : undefined);
        notes.push({
          id: manifestEntry?.id || metaId || crypto.randomUUID(),
          title: name.replace(/(_[0-9a-f]{8})?\.md$/, ''),
          content,
          folder: folderId,
          tags: metaTags,
          links: metaLinks,
          linkRefs: metaLinkRefs,
          createdAt: manifestEntry?.createdAt || metaCreatedAt || new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          source: manifestEntry?.source ?? 'obsidian-import',
          // rawBlock preserves all original YAML verbatim for safe round-trip write-back.
          ...(rawBlock ? { rawFrontmatter: rawBlock } : {}),
        });
      } else if (isDirectoryHandle(handle)) {
        if (name === 'attachments') {
          for await (const [noteId, attachmentDir] of handle.entries()) {
            if (!isDirectoryHandle(attachmentDir)) continue;
            const noteAttachments: Attachment[] = [];
            for await (const [attachmentName, attachmentHandle] of attachmentDir.entries()) {
              if (!isFileHandle(attachmentHandle)) continue;
              const file = await attachmentHandle.getFile();
              const base64 = await fileToBase64(file);
              // Attachment filename format: `${uuid}-${originalFilename}`
              // UUID has 5 dash-separated groups (8-4-4-4-12 chars = 36 chars total).
              const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;
              const uuidMatch = attachmentName.match(UUID_RE);
              const originalFilename = uuidMatch ? uuidMatch[2] : attachmentName;
              const attachmentId = uuidMatch ? uuidMatch[1] : `${noteId}:${attachmentName}`;
              noteAttachments.push({
                id: attachmentId,
                noteId,
                filename: originalFilename,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
                createdAt: new Date(file.lastModified).toISOString(),
                dataBase64: base64,
                vaultPath: `attachments/${noteId}/${attachmentName}`,
              });
            }
            if (noteAttachments.length > 0) attachmentsByNoteId.set(noteId, noteAttachments);
          }
        } else if (name !== '.obsidian' && name !== '.DS_Store') {
          let matchedFolder = allFolders.find((folder) => folderPathKey(folder.name) === currentPathKey);
          if (!matchedFolder) {
            // Directory exists in vault but not in Noa — create it on the fly
            matchedFolder = { id: crypto.randomUUID(), name: currentPath.join('/'), source: 'obsidian-import' as const };
            newFolders.push(matchedFolder);
            allFolders.push(matchedFolder);
          }
          await readDir(handle, matchedFolder.id, currentPath);
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
  return { notes, newFolders };
}
