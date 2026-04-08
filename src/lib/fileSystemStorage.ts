import localforage from 'localforage';
import { Note, Folder, Attachment } from '../types';
import { storage } from './storage';

const fsHandleStore = localforage.createInstance({
  name: 'redaction-diary-fs-db',
  storeName: 'fs-handle'
});

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

export async function getPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await fsHandleStore.getItem<FileSystemDirectoryHandle>('root-handle');
    if (!handle) return null;
    // Verify permission is still granted
    const perm = typeof handle.queryPermission === 'function'
      ? await handle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    if (perm === 'granted') return handle;
    const req = typeof handle.requestPermission === 'function'
      ? await handle.requestPermission({ mode: 'readwrite' })
      : 'denied';
    return req === 'granted' ? handle : null;
  } catch {
    return null;
  }
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

function parseFrontMatter(text: string): { meta: Record<string, string | string[]>; content: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: text };

  const meta: Record<string, string | string[]> = {};
  const yamlLines = match[1].split('\n');
  for (const line of yamlLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, content: match[2] };
}

function yamlScalar(value: string): string {
  // Quote the value if it contains characters that would break simple YAML parsing
  if (/[:#\n\r"']/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  return value;
}

function buildFrontMatter(note: Note): string {
  const tags = note.tags?.length ? `[${note.tags.map(yamlScalar).join(', ')}]` : '[]';
  const links = note.links?.length ? `[${note.links.map(l => `"${l.replace(/"/g, '\\"')}"`).join(', ')}]` : '[]';
  const linkRefs = note.linkRefs?.length ? `[${note.linkRefs.map(id => `"${id.replace(/"/g, '\\"')}"`).join(', ')}]` : '[]';
  return `---\nid: ${yamlScalar(note.id)}\nfolder: ${yamlScalar(note.folder || '')}\ntags: ${tags}\nlinks: ${links}\nlinkRefs: ${linkRefs}\ncreatedAt: ${yamlScalar(note.createdAt)}\n---\n`;
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
  const folder = folders.find(f => f.id === note.folder);
  const dirHandle = folder
    ? await getFolderHandle(rootHandle, folder.name)
    : rootHandle;
  if (!dirHandle) return;

  const baseName = sanitizeFilename(note.title || 'Untitled');
  let filename = `${baseName}.md`;

  // Check for id conflict (another note with same filename)
  try {
    const existing = await dirHandle.getFileHandle(filename);
    const existingFile = await existing.getFile();
    const text = await existingFile.text();
    const { meta } = parseFrontMatter(text);
    if (meta.id && meta.id !== note.id) {
      filename = `${baseName}_${note.id.slice(0, 8)}.md`;
    }
  } catch {
    // file doesn't exist yet, ok
  }

  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(buildFrontMatter(note) + rewriteAttachmentEmbedsForVault(note));
  await writable.close();
  await syncAttachmentsForNote(rootHandle, note);
}

export async function deleteNoteFile(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[]
): Promise<void> {
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
        const { meta, content } = parseFrontMatter(text);
        const metaId = typeof meta.id === 'string' && meta.id.length > 0 ? meta.id : undefined;
        const metaTags = Array.isArray(meta.tags) ? meta.tags : [];
        const metaLinks = Array.isArray(meta.links) ? meta.links : [];
        const metaLinkRefs = Array.isArray(meta.linkRefs) ? meta.linkRefs : [];
        const metaCreatedAt = typeof meta.createdAt === 'string' ? meta.createdAt : undefined;
        notes.push({
          id: metaId || crypto.randomUUID(),
          title: name.replace(/(_[0-9a-f]{8})?\.md$/, ''),
          content,
          folder: folderId,
          tags: metaTags,
          links: metaLinks,
          linkRefs: metaLinkRefs,
          createdAt: metaCreatedAt || new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
          source: 'obsidian-import',
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
              const dashIdx = attachmentName.indexOf('-');
              const originalFilename = dashIdx > 0 ? attachmentName.slice(dashIdx + 1) : attachmentName;
              const attachmentId = dashIdx > 0 ? attachmentName.slice(0, dashIdx) : `${noteId}:${attachmentName}`;
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
