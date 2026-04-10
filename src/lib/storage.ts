import localforage from 'localforage';
import { Note, Folder, Attachment, NoteSnapshot } from '../types';

const MAX_SNAPSHOTS_PER_NOTE = 20;

// Initialize localforage instances
const notesStore = localforage.createInstance({
  name: 'redaction-diary-notes-db',
  storeName: 'notes'
});

const foldersStore = localforage.createInstance({
  name: 'redaction-diary-folders-db',
  storeName: 'folders'
});

const workspaceStore = localforage.createInstance({
  name: 'redaction-diary-workspace-db',
  storeName: 'workspace'
});

const attachmentsStore = localforage.createInstance({
  name: 'redaction-diary-attachments-db',
  storeName: 'attachments'
});

const historyStore = localforage.createInstance({
  name: 'redaction-diary-history-db',
  storeName: 'history'
});

export const storage = {
  async verifyAccess(): Promise<void> {
    await workspaceStore.setItem('__healthcheck__', 'ok');
    await workspaceStore.removeItem('__healthcheck__');
  },
  // Per-note storage (new)
  async saveNote(note: Note): Promise<void> {
    await notesStore.setItem(`note:${note.id}`, note);
  },

  async deleteNote(id: string): Promise<void> {
    await notesStore.removeItem(`note:${id}`);
  },

  async getNotes(): Promise<Note[] | null> {
    try {
      const notes: Note[] = [];
      await notesStore.iterate<Note, void>((value, key) => {
        if (key.startsWith('note:')) {
          notes.push(value);
        }
      });
      return notes.length > 0 ? notes : null;
    } catch (err) {
      console.error('Error loading notes:', err);
      return null;
    }
  },

  // Batch save for import. Uses allSettled so a single failure doesn't leave
  // other writes in-flight with no way to roll back.
  async saveNotes(notes: Note[]): Promise<void> {
    const results = await Promise.allSettled(
      notes.map(n => notesStore.setItem(`note:${n.id}`, n))
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      throw new Error(`Failed to save ${failed}/${notes.length} notes. Storage may be full.`);
    }
  },

  // Migration: old 'all-notes' key → per-note keys
  async migrateToPerNoteStorage(): Promise<void> {
    try {
      const done = await notesStore.getItem<boolean>('migration:per-note-done');
      if (done) return;
      const legacy = await notesStore.getItem<Note[]>('all-notes');
      if (!legacy) {
        await notesStore.setItem('migration:per-note-done', true);
        return;
      }
      await Promise.all(legacy.map(n => notesStore.setItem(`note:${n.id}`, n)));
      await notesStore.removeItem('all-notes');
      await notesStore.setItem('migration:per-note-done', true);
    } catch (err) {
      console.error('Error migrating to per-note storage:', err);
    }
  },

  async getFolders(): Promise<Folder[] | null> {
    try {
      const folders = await foldersStore.getItem<Folder[]>('all-folders');
      return folders;
    } catch (err) {
      console.error('Error loading folders:', err);
      return null;
    }
  },

  async saveFolders(folders: Folder[]): Promise<void> {
    await foldersStore.setItem('all-folders', folders);
  },

  async getWorkspaceName(): Promise<string | null> {
    try {
      const name = await workspaceStore.getItem<string>('workspace-name');
      return name;
    } catch (err) {
      console.error('Error loading workspace name:', err);
      return null;
    }
  },

  async saveWorkspaceName(name: string): Promise<void> {
    await workspaceStore.setItem('workspace-name', name);
  },

  async pruneOrphanedNotes(validIds: string[]): Promise<void> {
    try {
      const validSet = new Set(validIds);
      const keysToDelete: string[] = [];
      await notesStore.iterate<Note, void>((_value, key) => {
        if (key.startsWith('note:')) {
          const id = key.slice(5);
          if (!validSet.has(id)) keysToDelete.push(key);
        }
      });
      await Promise.all(keysToDelete.map(k => notesStore.removeItem(k)));
    } catch (err) {
      console.error('Error pruning orphaned notes:', err);
    }
  },

  async clearAll(): Promise<void> {
    await Promise.all([
      notesStore.clear(),
      foldersStore.clear(),
      workspaceStore.clear(),
      attachmentsStore.clear(),
      historyStore.clear(),
    ]);
  },

  // Attachment Blob storage
  async saveAttachmentBlob(attachmentId: string, blob: Blob): Promise<void> {
    await attachmentsStore.setItem(`blob:${attachmentId}`, blob);
  },

  async getAttachmentBlob(attachmentId: string): Promise<Blob | null> {
    try {
      return await attachmentsStore.getItem<Blob>(`blob:${attachmentId}`);
    } catch {
      return null;
    }
  },

  async deleteAttachmentBlob(attachmentId: string): Promise<void> {
    await attachmentsStore.removeItem(`blob:${attachmentId}`);
  },

  async deleteAttachmentBlobsByNoteId(noteId: string, attachments: Attachment[], allNotes?: Note[]): Promise<void> {
    const noteAttachments = attachments.filter(a => a.noteId === noteId);
    // If a full note list is provided, only delete blobs not referenced by other notes.
    const toDelete = allNotes
      ? noteAttachments.filter(att =>
          !allNotes.some(n => n.id !== noteId && n.attachments?.some(a => a.id === att.id))
        )
      : noteAttachments;
    await Promise.allSettled(toDelete.map(a => attachmentsStore.removeItem(`blob:${a.id}`)));
  },

  async pruneOrphanedAttachments(validAttachmentIds: Set<string>): Promise<void> {
    const keys = await attachmentsStore.keys();
    const toDelete = keys.filter((k) => {
      const id = k.replace('blob:', '');
      return !validAttachmentIds.has(id);
    });
    await Promise.all(toDelete.map((k) => attachmentsStore.removeItem(k)));
  },

  // Version history
  async saveSnapshot(snapshot: NoteSnapshot): Promise<void> {
    const key = `history:${snapshot.noteId}:${snapshot.savedAt}`;
    await historyStore.setItem(key, snapshot);
  },

  async getSnapshots(noteId: string): Promise<NoteSnapshot[]> {
    const snapshots: NoteSnapshot[] = [];
    await historyStore.iterate<NoteSnapshot, void>((value, key) => {
      if (key.startsWith(`history:${noteId}:`)) {
        snapshots.push(value);
      }
    });
    snapshots.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return snapshots;
  },

  async deleteSnapshot(noteId: string, savedAt: string): Promise<void> {
    await historyStore.removeItem(`history:${noteId}:${savedAt}`);
  },

  // Keep only the newest MAX_SNAPSHOTS_PER_NOTE snapshots, delete the rest.
  async pruneSnapshots(noteId: string): Promise<void> {
    const snapshots = await this.getSnapshots(noteId);
    if (snapshots.length <= MAX_SNAPSHOTS_PER_NOTE) return;
    const toDelete = snapshots.slice(MAX_SNAPSHOTS_PER_NOTE);
    await Promise.allSettled(
      toDelete.map(s => historyStore.removeItem(`history:${s.noteId}:${s.savedAt}`))
    );
  },

  async deleteSnapshotsForNote(noteId: string): Promise<void> {
    const keys: string[] = [];
    await historyStore.iterate<NoteSnapshot, void>((_value, key) => {
      if (key.startsWith(`history:${noteId}:`)) keys.push(key);
    });
    await Promise.allSettled(keys.map(k => historyStore.removeItem(k)));
  },

  async getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      if (!navigator.storage?.estimate) return null;
      const est = await navigator.storage.estimate();
      if (est.usage == null || est.quota == null) return null;
      return { usage: est.usage, quota: est.quota };
    } catch {
      return null;
    }
  },

  // Migration from localStorage
  async migrateFromLocalStorage(): Promise<boolean> {
    try {
      const lsNotes = localStorage.getItem('pixel-notes');
      const lsFolders = localStorage.getItem('pixel-folders');
      const lsWorkspace = localStorage.getItem('pixel-workspace');

      let migrated = false;

      if (lsNotes) {
        const parsed: unknown = JSON.parse(lsNotes);
        if (!Array.isArray(parsed)) throw new Error('pixel-notes is not an array');
        const migratedNotes: Note[] = parsed
          .filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object')
          .map((n) => ({
            id: typeof n.id === 'string' ? n.id : crypto.randomUUID(),
            title: typeof n.title === 'string' ? n.title : 'Untitled',
            content: typeof n.content === 'string' ? n.content : '',
            folder: typeof n.folder === 'string' ? n.folder : '',
            createdAt: typeof n.createdAt === 'string' ? n.createdAt : (typeof n.date === 'string' ? n.date : new Date().toISOString()),
            updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : (typeof n.date === 'string' ? n.date : new Date().toISOString()),
            tags: Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : [],
            links: Array.isArray(n.links) ? n.links.filter((l): l is string => typeof l === 'string') : [],
            linkRefs: Array.isArray(n.linkRefs) ? n.linkRefs.filter((r): r is string => typeof r === 'string') : [],
          }));
        await this.saveNotes(migratedNotes);
        localStorage.removeItem('pixel-notes');
        migrated = true;
      }

      if (lsFolders) {
        const parsedFolders: unknown = JSON.parse(lsFolders);
        if (Array.isArray(parsedFolders)) {
          const validFolders: Folder[] = parsedFolders
            .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
            .filter((f) => typeof f.id === 'string' && typeof f.name === 'string')
            .map((f) => ({
              id: f.id as string,
              name: f.name as string,
              ...(typeof f.parentId === 'string' ? { parentId: f.parentId } : {}),
            }));
          await this.saveFolders(validFolders);
          localStorage.removeItem('pixel-folders');
          migrated = true;
        }
      }

      if (lsWorkspace) {
        if (typeof lsWorkspace === 'string' && lsWorkspace.length > 0) {
          await this.saveWorkspaceName(lsWorkspace);
          localStorage.removeItem('pixel-workspace');
          migrated = true;
        }
      }

      return migrated;
    } catch (err) {
      console.error('Error migrating from localStorage:', err);
      return false;
    }
  }
};
