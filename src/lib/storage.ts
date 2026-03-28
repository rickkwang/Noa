import localforage from 'localforage';
import { Note, Folder } from '../types';

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

  // Batch save for import
  async saveNotes(notes: Note[]): Promise<void> {
    await Promise.all(notes.map(n => notesStore.setItem(`note:${n.id}`, n)));
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
    ]);
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
        const parsed = JSON.parse(lsNotes);
        const migratedNotes = parsed.map((n: any) => ({
          ...n,
          createdAt: n.createdAt || n.date || new Date().toISOString(),
          updatedAt: n.updatedAt || n.date || new Date().toISOString(),
          tags: n.tags || [],
          links: n.links || []
        }));
        await this.saveNotes(migratedNotes);
        localStorage.removeItem('pixel-notes');
        migrated = true;
      }

      if (lsFolders) {
        await this.saveFolders(JSON.parse(lsFolders));
        localStorage.removeItem('pixel-folders');
        migrated = true;
      }

      if (lsWorkspace) {
        await this.saveWorkspaceName(lsWorkspace);
        localStorage.removeItem('pixel-workspace');
        migrated = true;
      }

      return migrated;
    } catch (err) {
      console.error('Error migrating from localStorage:', err);
      return false;
    }
  }
};
