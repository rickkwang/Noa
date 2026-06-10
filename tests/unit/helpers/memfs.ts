// In-memory mock of the File System Access API directory/file handles,
// covering the subset used by fileSystemStorage/fileSyncService:
// getFileHandle, getDirectoryHandle, removeEntry, entries, getFile, createWritable.

function domError(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

export class MemFileHandle {
  readonly kind = 'file' as const;
  private data: string | Blob = '';
  private lastModified = Date.now();

  constructor(public readonly name: string) {}

  async getFile(): Promise<File> {
    return new File([this.data], this.name, { lastModified: this.lastModified });
  }

  async createWritable() {
    const chunks: Array<string | Blob> = [];
    return {
      write: async (chunk: string | Blob) => {
        chunks.push(chunk);
      },
      close: async () => {
        this.data = chunks.length === 1 && typeof chunks[0] !== 'string'
          ? chunks[0]
          : chunks.map((c) => (typeof c === 'string' ? c : '')).join('');
        this.lastModified = Date.now();
      },
    };
  }

  async text(): Promise<string> {
    return (await this.getFile()).text();
  }
}

export class MemDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MemDirectoryHandle | MemFileHandle>();

  constructor(public readonly name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw domError('TypeMismatchError');
      return existing;
    }
    if (!opts?.create) throw domError('NotFoundError', `No file named ${name}`);
    const handle = new MemFileHandle(name);
    this.children.set(name, handle);
    return handle;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw domError('TypeMismatchError');
      return existing;
    }
    if (!opts?.create) throw domError('NotFoundError', `No directory named ${name}`);
    const handle = new MemDirectoryHandle(name);
    this.children.set(name, handle);
    return handle;
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) throw domError('NotFoundError', `No entry named ${name}`);
    if (existing.kind === 'directory' && existing.children.size > 0 && !opts?.recursive) {
      throw domError('InvalidModificationError', `Directory ${name} is not empty`);
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, MemDirectoryHandle | MemFileHandle]> {
    for (const entry of this.children) yield entry;
  }
}

export function createMemRoot(name = 'vault'): MemDirectoryHandle {
  return new MemDirectoryHandle(name);
}

/** Resolve a slash-separated path to a handle, or null when missing. */
export function resolvePath(
  root: MemDirectoryHandle,
  path: string,
): MemDirectoryHandle | MemFileHandle | null {
  const segments = path.split('/').filter(Boolean);
  let current: MemDirectoryHandle | MemFileHandle = root;
  for (const segment of segments) {
    if (current.kind !== 'directory') return null;
    const next = current.children.get(segment);
    if (!next) return null;
    current = next;
  }
  return current;
}

export async function readFileText(root: MemDirectoryHandle, path: string): Promise<string | null> {
  const handle = resolvePath(root, path);
  if (!handle || handle.kind !== 'file') return null;
  return handle.text();
}

export function listPaths(root: MemDirectoryHandle): string[] {
  const paths: string[] = [];
  const walk = (dir: MemDirectoryHandle, prefix: string) => {
    for (const [name, handle] of dir.children) {
      const path = prefix ? `${prefix}/${name}` : name;
      paths.push(handle.kind === 'directory' ? `${path}/` : path);
      if (handle.kind === 'directory') walk(handle, path);
    }
  };
  walk(root, '');
  return paths.sort();
}
