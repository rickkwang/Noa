import localforage from 'localforage';
import { Note, Folder } from '../types';

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

function parseFrontMatter(text: string): { meta: Record<string, any>; content: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: text };

  const meta: Record<string, any> = {};
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

function buildFrontMatter(note: Note): string {
  const tags = note.tags?.length ? `[${note.tags.join(', ')}]` : '[]';
  const links = note.links?.length ? `[${note.links.map(l => `"${l}"`).join(', ')}]` : '[]';
  const linkRefs = note.linkRefs?.length ? `[${note.linkRefs.map(id => `"${id}"`).join(', ')}]` : '[]';
  return `---\nid: ${note.id}\nfolder: ${note.folder || ''}\ntags: ${tags}\nlinks: ${links}\nlinkRefs: ${linkRefs}\ncreatedAt: ${note.createdAt}\n---\n`;
}

async function getFolderHandle(
  rootHandle: FileSystemDirectoryHandle,
  folderName: string,
  create = true
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await rootHandle.getDirectoryHandle(folderName, { create });
  } catch {
    return null;
  }
}

export async function writeNote(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[]
): Promise<void> {
  const folder = folders.find(f => f.id === note.folder);
  const dirHandle = folder
    ? await getFolderHandle(rootHandle, sanitizeFilename(folder.name))
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
  await writable.write(buildFrontMatter(note) + note.content);
  await writable.close();
}

export async function deleteNoteFile(
  rootHandle: FileSystemDirectoryHandle,
  note: Note,
  folders: Folder[]
): Promise<void> {
  const folder = folders.find(f => f.id === note.folder);
  const dirHandle = folder
    ? await getFolderHandle(rootHandle, sanitizeFilename(folder.name), false)
    : rootHandle;
  if (!dirHandle) return;

  const baseName = sanitizeFilename(note.title || 'Untitled');
  for (const filename of [`${baseName}.md`, `${baseName}_${note.id.slice(0, 8)}.md`]) {
    try {
      await dirHandle.removeEntry(filename);
      return;
    } catch {
      // try next variant
    }
  }
}

export async function scanDirectory(
  rootHandle: FileSystemDirectoryHandle,
  folders: Folder[]
): Promise<Note[]> {
  const notes: Note[] = [];
  const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
    handle.kind === 'file';
  const isDirectoryHandle = (handle: FileSystemHandle): handle is FileSystemDirectoryHandle =>
    handle.kind === 'directory';

  async function readDir(dirHandle: FileSystemDirectoryHandle, folderId?: string) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (isFileHandle(handle) && name.endsWith('.md')) {
        const file = await handle.getFile();
        const text = await file.text();
        const { meta, content } = parseFrontMatter(text);
        notes.push({
          id: meta.id || crypto.randomUUID(),
          title: name.replace(/(_[0-9a-f]{8})?\.md$/, ''),
          content,
          folder: folderId,
          tags: meta.tags || [],
          links: meta.links || [],
          linkRefs: meta.linkRefs || [],
          createdAt: meta.createdAt || new Date(file.lastModified).toISOString(),
          updatedAt: new Date(file.lastModified).toISOString(),
        });
      } else if (isDirectoryHandle(handle)) {
        const matchedFolder = folders.find(f => sanitizeFilename(f.name) === name);
        await readDir(handle, matchedFolder?.id);
      }
    }
  }

  await readDir(rootHandle);
  return notes;
}
