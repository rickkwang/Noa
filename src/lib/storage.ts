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
  // Per-note storage (new)
  async saveNote(note: Note): Promise<void> {
    try {
      await notesStore.setItem(`note:${note.id}`, note);
    } catch (err) {
      console.error('Error saving note:', err);
    }
  },

  async deleteNote(id: string): Promise<void> {
    try {
      await notesStore.removeItem(`note:${id}`);
    } catch (err) {
      console.error('Error deleting note:', err);
    }
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
    try {
      await Promise.all(notes.map(n => notesStore.setItem(`note:${n.id}`, n)));
    } catch (err) {
      console.error('Error saving notes:', err);
    }
  },

  // Migration: old 'all-notes' key → per-note keys
  async migrateToPerNoteStorage(): Promise<void> {
    try {
      const legacy = await notesStore.getItem<Note[]>('all-notes');
      if (!legacy) return;
      await Promise.all(legacy.map(n => notesStore.setItem(`note:${n.id}`, n)));
      await notesStore.removeItem('all-notes');
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
    try {
      await foldersStore.setItem('all-folders', folders);
    } catch (err) {
      console.error('Error saving folders:', err);
    }
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
    try {
      await workspaceStore.setItem('workspace-name', name);
    } catch (err) {
      console.error('Error saving workspace name:', err);
    }
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
