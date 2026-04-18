import localforage from 'localforage';
import { Note, Folder, Attachment, NoteSnapshot } from '../types';

const MAX_SNAPSHOTS_PER_NOTE = 60;
// Exponential-decay retention window (ms). Within the newest snapshot, adjacent
// kept snapshots must be separated by at least BASE_SPACING_MS × 2^depth.
// This gives dense history for the last few minutes and sparse history hours back,
// instead of the previous "last 10 minutes only" behavior at 20/30s cadence.
const DECAY_BASE_SPACING_MS = 30_000;

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

  // Batch save for import. Writes sequentially so we can roll back on failure
  // without leaving the store in a partially-imported state.
  async saveNotes(notes: Note[]): Promise<void> {
    const written: string[] = [];
    try {
      for (const n of notes) {
        await notesStore.setItem(`note:${n.id}`, n);
        written.push(n.id);
      }
    } catch {
      // Roll back all keys written so far so the store stays consistent.
      const rollback = await Promise.allSettled(
        written.map(id => notesStore.removeItem(`note:${id}`))
      );
      const rollbackFailures = rollback.filter(r => r.status === 'rejected').length;
      if (rollbackFailures > 0) {
        // Store is now in an inconsistent state — partial writes remain.
        // Surface this explicitly so the caller can prompt the user to
        // reset or restore from backup instead of silently proceeding.
        throw new Error(
          `Import failed after writing ${written.length}/${notes.length} notes, and ${rollbackFailures} rollback operation(s) also failed. Storage is in an inconsistent state — please reset the workspace and restore from backup.`
        );
      }
      throw new Error(
        `Import failed after writing ${written.length}/${notes.length} notes (rolled back). Storage may be full.`
      );
    }
  },

  // Migration: old 'all-notes' key → per-note keys
  // Safe: writes all new keys first, only removes the legacy key after
  // all writes succeed. If the process dies mid-flight the migration flag
  // is never set, so we will retry (idempotent because setItem overwrites).
  async migrateToPerNoteStorage(): Promise<void> {
    try {
      const done = await notesStore.getItem<boolean>('migration:per-note-done');
      if (done) return;
      const legacy = await notesStore.getItem<Note[]>('all-notes');
      if (!legacy) {
        await notesStore.setItem('migration:per-note-done', true);
        return;
      }
      // Write all per-note keys first. If any fail we abort and leave the
      // legacy key intact so the next startup can retry.
      const results = await Promise.allSettled(
        legacy.map(n => notesStore.setItem(`note:${n.id}`, n))
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.error(`Migration: ${failed.length}/${legacy.length} writes failed — will retry next startup.`);
        return; // Do NOT remove legacy key or set done flag
      }
      // All writes succeeded — safe to remove legacy blob and mark done.
      await notesStore.removeItem('all-notes');
      await notesStore.setItem('migration:per-note-done', true);
    } catch (err) {
      console.error('Error migrating to per-note storage:', err);
      // Do not set migration:per-note-done so we retry next time.
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

  // Keep the newest snapshot plus an exponentially-spaced tail, then cap at
  // MAX_SNAPSHOTS_PER_NOTE. Dense recent history, thinning as we look back —
  // so an 8-hour editing session still has snapshots from hours 1 and 2, not
  // only the last 10 minutes.
  async pruneSnapshots(noteId: string): Promise<void> {
    const snapshots = await this.getSnapshots(noteId);
    if (snapshots.length === 0) return;
    // snapshots are pre-sorted newest-first.
    const kept: NoteSnapshot[] = [snapshots[0]];
    let lastKeptTs = Date.parse(snapshots[0].savedAt);
    let depth = 0;
    for (let i = 1; i < snapshots.length; i++) {
      const ts = Date.parse(snapshots[i].savedAt);
      if (Number.isNaN(ts)) continue;
      const minGap = DECAY_BASE_SPACING_MS * Math.pow(2, depth);
      if (lastKeptTs - ts >= minGap) {
        kept.push(snapshots[i]);
        lastKeptTs = ts;
        depth += 1;
        if (kept.length >= MAX_SNAPSHOTS_PER_NOTE) break;
      }
    }
    const keepSet = new Set(kept.map(s => s.savedAt));
    const toDelete = snapshots.filter(s => !keepSet.has(s.savedAt));
    if (toDelete.length === 0) return;
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
