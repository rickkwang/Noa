import { useState, useEffect, useCallback, useRef } from 'react';
import { AppErrorCode, AppSettings, Attachment, Folder, GlobalTask, Note, NoteSnapshot } from '../types';
import { storage } from '../lib/storage';
import { builtinTemplates, applyTemplate, formatDate } from '../lib/templates';
import { normalizeAndValidateNotes } from '../lib/dataIntegrity';
import { addRecentNoteId, loadRecentNoteIds, saveRecentNoteIds } from '../lib/recentNotes';
import { lsGet, lsSet } from '../lib/safeLocalStorage';
import { fromImportError, fromStorageError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';
import { sortNotesByRecent } from '../lib/noteSort';
import { isDescendantPath } from '../lib/pathUtils';

interface LoadErrorState {
  code: AppErrorCode;
  message: string;
}

import { extractLinks, extractTags, recomputeLinkRefsForNotes, recomputeLinkRefsForSubset } from '../lib/noteUtils';
import { toggleTaskInNoteContent } from '../lib/taskParser';
import { useDailyNotes } from './useDailyNotes';
import {
  inferAttachmentMimeType,
  findInvalidAttachmentPayload,
  mergeAttachmentPayloads,
  type ImportedNote,
} from '../lib/attachmentUtils';

const LAST_ACTIVE_NOTE_KEY = 'redaction-last-active-note-id';
const MAX_SNAPSHOT_INTERVAL_MS = 5 * 60_000; // 5 minutes

export function useNotes(settings?: AppSettings) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<LoadErrorState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('Default Workspace');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState('');
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>(loadRecentNoteIds);

  // Per-note debounce timers
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Per-note snapshot timers (30s idle after last save, max 5min forced)
  const snapshotTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Tracks when the first pending snapshot was scheduled per note (for max-interval enforcement)
  const snapshotFirstScheduled = useRef<Map<string, number>>(new Map());

  // Always holds the latest notes array so debounceSave can access the most
  // recent version of a note without a stale closure.
  const notesRef = useRef<Note[]>([]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  const scheduleSnapshot = useCallback((note: Note) => {
    const noteId = note.id;
    const existing = snapshotTimers.current.get(noteId);

    // Record when we first started tracking this note's pending snapshot
    if (!snapshotFirstScheduled.current.has(noteId)) {
      snapshotFirstScheduled.current.set(noteId, Date.now());
    }

    const firstScheduledAt = snapshotFirstScheduled.current.get(noteId)!;
    const elapsed = Date.now() - firstScheduledAt;
    // If we've been deferring for longer than the max interval, fire immediately
    const delay = elapsed >= MAX_SNAPSHOT_INTERVAL_MS ? 0 : 30_000;
    // Starting a new window on forced-flush so subsequent edits don't keep
    // firing at delay=0 before the previous callback drains.
    if (delay === 0) snapshotFirstScheduled.current.delete(noteId);

    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      const latest = notesRef.current.find(n => n.id === noteId) ?? note;
      const snapshot: NoteSnapshot = {
        noteId: latest.id,
        content: latest.content,
        title: latest.title,
        savedAt: new Date().toISOString(),
      };
      try {
        await storage.saveSnapshot(snapshot);
        await storage.pruneSnapshots(latest.id);
      } catch {
        // Snapshot failure is non-fatal, ignore silently
      }
      snapshotTimers.current.delete(noteId);
      snapshotFirstScheduled.current.delete(noteId);
    }, delay);
    snapshotTimers.current.set(noteId, t);
  }, []);

  const debounceSave = useCallback((note: Note) => {
    const noteId = note.id;
    const existing = saveTimers.current.get(noteId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      // Prefer the latest version from the ref so that rapid edits don't
      // cause an older closure snapshot to overwrite newer content.
      // Fall back to the passed-in note if the ref hasn't synced yet
      // (e.g. during initial mount or in test environments).
      const latest = notesRef.current.find(n => n.id === noteId) ?? note;
      try {
        await storage.saveNote(latest);
        scheduleSnapshot(latest);
      } catch {
        setSaveError('Failed to save note. Storage may be full.');
      }
      saveTimers.current.delete(noteId);
    }, 500);
    saveTimers.current.set(noteId, t);
  }, [scheduleSnapshot]);

  const sameStringArray = useCallback((a: string[] = [], b: string[] = []) => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }, []);

  const collectNotesWithChangedLinkRefs = useCallback((nextNotes: Note[], previousNotes: Note[]): Note[] => {
    const previousById = new Map(previousNotes.map((note) => [note.id, note]));
    return nextNotes.filter((note) => {
      const previous = previousById.get(note.id);
      if (!previous) return true;
      return !sameStringArray(previous.linkRefs ?? [], note.linkRefs ?? []);
    });
  }, [sameStringArray]);

  const syncLinkRefs = useCallback((nextNotes: Note[], previousNotes?: Note[], changedIds?: Set<string>) => {
    const withRefs = changedIds
      ? recomputeLinkRefsForSubset(nextNotes, changedIds)
      : recomputeLinkRefsForNotes(nextNotes);
    if (!previousNotes) return withRefs;
    const previousById = new Map(previousNotes.map((note) => [note.id, note]));
    withRefs.forEach((note) => {
      const previous = previousById.get(note.id);
      if (!previous || !sameStringArray(previous.linkRefs ?? [], note.linkRefs ?? [])) {
        debounceSave(note);
      }
    });
    return withRefs;
  }, [debounceSave, sameStringArray]);

  // Tracks whether the hook is still mounted. flushAllPendingSaves awaits
  // storage writes sequentially, so between iterations the component may have
  // unmounted; re-reading notesRef after unmount risks writing stale snapshots
  // if something else touched storage in the meantime.
  const isMountedRef = useRef(true);

  // Cleanup all pending save/snapshot timers on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      saveTimers.current.forEach(t => clearTimeout(t));
      saveTimers.current.clear();
      snapshotTimers.current.forEach(t => clearTimeout(t));
      snapshotTimers.current.clear();
      snapshotFirstScheduled.current.clear();
    };
  }, []);

  const flushAllPendingSaves = useCallback(async (_currentNotes?: Note[]) => {
    // Snapshot pending ids AND their corresponding notes atomically, before
    // awaiting. This prevents a late debounceSave between iterations from
    // inserting a newer timer whose note we'd then read from a possibly
    // stale-by-the-time-await-resolves notesRef.
    const pending = Array.from(saveTimers.current.keys());
    const notesToFlush: Note[] = [];
    for (const id of pending) {
      clearTimeout(saveTimers.current.get(id));
      saveTimers.current.delete(id);
      const note = notesRef.current.find(n => n.id === id);
      if (note) notesToFlush.push(note);
    }
    for (const note of notesToFlush) {
      // If the component unmounted mid-flush, abort — the unmount cleanup
      // already cleared timers and any further writes race with whatever
      // re-mounts after us.
      if (!isMountedRef.current) return;
      try { await storage.saveNote(note); } catch { /* best effort on quit */ }
    }
  }, []);

  const applyEmptyWorkspace = useCallback(async (name: string) => {
    const initialFolders = [
      { id: 'diary', name: 'diaries', source: 'noa' as const },
      { id: 'essay', name: 'essays', source: 'noa' as const },
    ];
    setFolders(initialFolders);
    setNotes([]);
    setWorkspaceName(name);
    setActiveNoteId('');
    await storage.saveFolders(initialFolders);
    await storage.saveWorkspaceName(name);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loadData = async () => {
      try {
        await storage.verifyAccess();
        await storage.migrateFromLocalStorage();
        await storage.migrateToPerNoteStorage();

        const [savedWorkspace, savedFolders, savedNotes] = await Promise.all([
          storage.getWorkspaceName(),
          storage.getFolders(),
          storage.getNotes(),
        ]);

        if (signal.aborted) return;

        if (savedWorkspace) setWorkspaceName(savedWorkspace);

        if (savedFolders && savedFolders.length > 0) {
          setFolders(savedFolders);
        } else {
          setFolders([
            { id: 'diary', name: 'diaries', source: 'noa' },
            { id: 'essay', name: 'essays', source: 'noa' }
          ]);
        }

        if (savedNotes && savedNotes.length > 0) {
          const { notes: normalized, report } = normalizeAndValidateNotes(savedNotes);
          if (!report.ok) {
            throw new Error(
              report.issues.find((issue) => issue.level === 'error')?.message ??
              'Data integrity check failed while loading notes.',
            );
          }
          const withRefs = syncLinkRefs(normalized);
          const changedForPersist = collectNotesWithChangedLinkRefs(withRefs, normalized);
          if (changedForPersist.length > 0) {
            await storage.saveNotes(changedForPersist);
          }
          const sorted = sortNotesByRecent(withRefs);
          setNotes(sorted);
          const lastActiveId = lsGet(LAST_ACTIVE_NOTE_KEY);
          const initialActiveId = lastActiveId && sorted.some((n) => n.id === lastActiveId)
            ? lastActiveId
            : sorted[0].id;
          setActiveNoteId(initialActiveId);
        } else {
          const welcomeNote: Note = {
          id: 'welcome',
          title: 'Welcome to Noa',
          content: `# Welcome to Noa

Your private, local-first writing space.

## Quick Start

| Shortcut | Action |
|----------|--------|
| \`⌘ N\` | New note |
| \`⌘ F\` | Search notes |
| \`⌘ K\` | Open command palette |
| \`⌘ ⇧ K\` | Open today's daily note |

## Features

- **Markdown editor** — Edit, Preview, or Split view
- **Wiki links** — Type \`[[Note Title]]\` to link notes
- **Tasks** — Use \`- [ ] task\` syntax, track in right panel
- **Tags** — Use \`#tag\` in notes, browse in sidebar
- **Knowledge Matrix** — Visualize note connections
- **Vault Folder** — Connect a local folder to mirror notes as \`.md\` files
- **Daily Notes** — One note per day, auto-dated

## Data Safety

All notes are stored **locally in your browser** (IndexedDB).
Export regularly: use Settings → Data → Export Backup.`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          folder: 'diary',
            tags: [],
            links: [],
            linkRefs: [],
            source: 'noa',
          };
          const dailyFolderId = crypto.randomUUID();
          const dateFormat = 'YYYY-MM-DD';
          const todayStr = formatDate(dateFormat);
          const dailyTemplate = builtinTemplates.find(t => t.id === 'daily') ?? builtinTemplates[0];
          const dailyNote: Note = {
            id: crypto.randomUUID(),
            title: todayStr,
            content: applyTemplate(dailyTemplate, todayStr, dateFormat),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            folder: dailyFolderId,
            tags: ['daily'],
            links: [],
            linkRefs: [],
            source: 'noa',
          };
          const initialFolders = [
            { id: 'diary', name: 'diaries', source: 'noa' as const },
            { id: 'essay', name: 'essays', source: 'noa' as const },
            { id: dailyFolderId, name: 'Daily Notes', source: 'noa' as const }
          ];
          setFolders(initialFolders);
          setNotes(syncLinkRefs([welcomeNote, dailyNote]));
          setActiveNoteId(welcomeNote.id);
          await storage.saveFolders(initialFolders);
          await storage.saveNote(welcomeNote);
          await storage.saveNote(dailyNote);
        }
        setLoadError(null);
      } catch (error) {
        if (signal.aborted) return;
        const appError = fromStorageError(error);
        setLoadError({ code: appError.code, message: appError.userMessage });
        recordErrorSnapshot({
          at: new Date().toISOString(),
          operation: 'app_bootstrap',
          code: appError.code,
          message: appError.rawMessage || appError.userMessage,
          suggestedAction: appError.suggestedAction,
        });
      } finally {
        if (!signal.aborted) setIsLoaded(true);
      }
    };
    loadData();
    return () => { controller.abort(); };
  }, [collectNotesWithChangedLinkRefs, loadAttempt, syncLinkRefs]);

  useEffect(() => {
    if (!isLoaded) return;
    const t = setTimeout(() => storage.saveWorkspaceName(workspaceName), 500);
    return () => clearTimeout(t);
  }, [workspaceName, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const t = setTimeout(() => storage.saveFolders(folders), 500);
    return () => clearTimeout(t);
  }, [folders, isLoaded]);

  const handleUpdateNote = useCallback((id: string, content: string) => {
    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === id
          ? { ...n, content, updatedAt: new Date().toISOString(),
              // Obsidian notes own their tags via frontmatter; don't re-derive from body
              ...(n.source === 'obsidian-import' ? {} : { links: extractLinks(content), tags: extractTags(content) }) }
          : n
      );
      const withRefs = syncLinkRefs(updated, prev, new Set([id]));
      const note = withRefs.find(n => n.id === id);
      if (note) debounceSave(note);
      return withRefs;
    });
  }, [debounceSave, syncLinkRefs]);

  const handleSaveNote = useCallback((note: Note) => {
    setNotes(prev => {
      const nextNote = { ...note, updatedAt: new Date().toISOString() };
      const updated = prev.map(n => n.id === note.id ? nextNote : n);
      debounceSave(nextNote);
      return updated;
    });
  }, [debounceSave]);

  const handleRenameNote = useCallback((id: string, newTitle: string) => {
    setNotes(prev => {
      const oldNote = prev.find(n => n.id === id);
      if (!oldNote) return prev;
      const oldTitle = oldNote.title;
      const updated = prev.map(n => {
        if (n.id === id) return { ...n, title: newTitle, updatedAt: new Date().toISOString() };
        if (n.id !== id && n.content.includes(`[[${oldTitle}]]`)) {
          // Sanitize newTitle so embedded "]]" cannot break the wiki-link syntax.
          const safeNewTitle = newTitle.replace(/\]\]/g, '] ]');
          const updatedContent = n.content.replace(
            new RegExp(`\\[\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g'),
            `[[${safeNewTitle}]]`
          );
          // For native notes, re-extract links from the rewritten content —
          // this is the single source of truth. For Obsidian-imported notes we
          // preserve the existing links array (frontmatter may carry aliases
          // or hand-maintained link lists that extractLinks would overwrite)
          // and just swap the old title for the new.
          const nextLinks = n.source === 'obsidian-import'
            ? n.links.map(l => l === oldTitle ? safeNewTitle : l)
            : extractLinks(updatedContent);
          return {
            ...n,
            content: updatedContent,
            links: nextLinks,
            updatedAt: new Date().toISOString(),
          };
        }
        return n;
      });
      // Save notes whose content changed (renamed note + notes with replaced [[links]]).
      // syncLinkRefs will additionally save any notes whose linkRefs changed.
      const prevById = new Map(prev.map(n => [n.id, n]));
      updated.forEach(n => {
        const p = prevById.get(n.id);
        if (!p || n.updatedAt !== p.updatedAt) debounceSave(n);
      });
      const withRefs = syncLinkRefs(updated, prev);
      return withRefs;
    });
  }, [debounceSave, syncLinkRefs]);

  const setActiveNoteIdWithRecent = useCallback((id: string) => {
    setActiveNoteId(id);
    if (!id) return;
    lsSet(LAST_ACTIVE_NOTE_KEY, id);
    setRecentNoteIds(prev => {
      const next = addRecentNoteId(prev, id);
      saveRecentNoteIds(next);
      return next;
    });
  }, []); // addRecentNoteId / saveRecentNoteIds are module-level pure functions, not reactive

  const handleCreateNote = useCallback((folderId: string, initialContent: string = '') => {
    const targetFolder = folders.find((folder) => folder.id === folderId);
    const targetSource = targetFolder?.source ?? 'noa';
    if (targetSource !== 'noa') {
      setSaveError('Cannot create notes inside imported vault area.');
      return;
    }
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: initialContent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folder: folderId,
      tags: [],
      links: [],
      linkRefs: [],
      source: 'noa',
    };
    setNotes(prev => {
      const next = syncLinkRefs([...prev, newNote], prev, new Set([newNote.id]));
      const created = next.find((n) => n.id === newNote.id) ?? newNote;
      void storage.saveNote(created).catch(() => {
        setSaveError('Failed to save note. Storage may be full.');
      });
      return next;
    });
    setActiveNoteIdWithRecent(newNote.id);
  }, [folders, setActiveNoteIdWithRecent, syncLinkRefs]);

  const handleMoveNote = useCallback((id: string, folderId: string) => {
    setNotes(prev => {
      const target = prev.find((note) => note.id === id);
      if (!target || target.folder === folderId) return prev;
      const noteSource = target.source ?? 'noa';
      if (!folderId) {
        if (noteSource !== 'noa') return prev;
      } else {
        const targetFolder = folders.find((folder) => folder.id === folderId);
        if (!targetFolder) return prev;
        if ((targetFolder.source ?? 'noa') !== noteSource) return prev;
      }
      const nextNote = { ...target, folder: folderId, updatedAt: new Date().toISOString() };
      const updated = prev.map((note) => (note.id === id ? nextNote : note));
      void storage.saveNote(nextNote).catch(() => {
        setSaveError('Failed to move note. Storage may be full.');
      });
      return syncLinkRefs(updated, prev, new Set([id]));
    });
  }, [folders, syncLinkRefs]);

  const handleImportNote = useCallback(async (title: string, content: string, folderId: string = 'diary', attachmentFile?: File | null) => {
    const targetFolder = folders.find((folder) => folder.id === folderId);
    if (targetFolder && (targetFolder.source ?? 'noa') !== 'noa') {
      setSaveError('Cannot import files directly into imported vault area.');
      return;
    }
    const newNote: Note = {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folder: folderId,
      tags: extractTags(content),
      links: extractLinks(content),
      linkRefs: [],
      source: 'noa',
    };

    if (!attachmentFile) {
      let created: Note = newNote;
      setNotes(prev => {
        const next = syncLinkRefs([...prev, newNote], prev, new Set([newNote.id]));
        created = next.find((n) => n.id === newNote.id) ?? newNote;
        return next;
      });
      try {
        await storage.saveNote(created);
      } catch {
        setSaveError('Failed to save note. Storage may be full.');
        return;
      }
      setActiveNoteIdWithRecent(newNote.id);
      return;
    }

    void (async () => {
      const attachmentId = crypto.randomUUID();
      const mimeType = inferAttachmentMimeType(attachmentFile);
      const attachment: Attachment = {
        id: attachmentId,
        noteId: newNote.id,
        filename: attachmentFile.name,
        mimeType,
        size: attachmentFile.size,
        createdAt: new Date().toISOString(),
        vaultPath: `attachments/${newNote.id}/${attachmentId}-${attachmentFile.name}`,
      };
      const noteWithAttachment: Note = {
        ...newNote,
        content: content || (mimeType.startsWith('image/') ? `![[attachments/${newNote.id}/${attachmentId}-${attachmentFile.name}]]` : `Attached file: ${attachmentFile.name}`),
        attachments: [attachment],
      };
      try {
        // Complete all storage ops before updating state — prevents note appearing then disappearing on error
        await storage.saveAttachmentBlob(attachmentId, attachmentFile);
        await storage.saveNote(noteWithAttachment);
        setNotes(prev => syncLinkRefs([...prev, noteWithAttachment], prev, new Set([noteWithAttachment.id])));
        setActiveNoteIdWithRecent(noteWithAttachment.id);
      } catch {
        // Rollback blob if it was saved before note save failed
        try { await storage.deleteAttachmentBlob(attachmentId); } catch { /* best effort */ }
        setSaveError('Failed to save attachment. Storage may be full.');
      }
    })();
  }, [folders, setActiveNoteIdWithRecent, syncLinkRefs]);

  const handleNavigateToNoteById = useCallback((id: string) => {
    setActiveNoteIdWithRecent(id);
  }, [setActiveNoteIdWithRecent]);

  const foldersRef = useRef(folders);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  const handleNavigateToNote = useCallback((title: string) => {
    // Always read from notesRef so we see the latest state even during rapid updates.
    const existing = notesRef.current.find(n => n.title === title);
    if (existing) {
      setActiveNoteIdWithRecent(existing.id);
      return;
    }
    const newNote: Note = {
      id: crypto.randomUUID(),
      title,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folder: foldersRef.current.find((folder) => (folder.source ?? 'noa') === 'noa')?.id ?? 'diary',
      tags: [],
      links: [],
      linkRefs: [],
      source: 'noa',
    };
    // Resolve the id to activate inside the updater so it always reflects the
    // latest prev — avoids a race between the closure check and the updater check.
    // React in StrictMode may invoke the updater twice; always trust the latest prev.
    const resolvedRef = { id: newNote.id };
    setNotes(prev => {
      // Prefer an existing note with the same title (any match). If a previous
      // run of this same updater already inserted newNote (StrictMode re-runs
      // updaters twice), the collision is newNote itself and we must return
      // prev untouched — inserting again or re-running syncLinkRefs would fire
      // redundant debounceSaves.
      const collision = prev.find(n => n.title === title);
      if (collision) {
        resolvedRef.id = collision.id;
        return prev;
      }
      resolvedRef.id = newNote.id;
      return syncLinkRefs([...prev, newNote], prev, new Set([newNote.id]));
    });
    // Read the final id from the updater — guaranteed set synchronously inside setNotes.
    setActiveNoteIdWithRecent(resolvedRef.id);
  }, [notesRef, setActiveNoteIdWithRecent, syncLinkRefs, foldersRef]);


  const handleDeleteNote = useCallback(async (id: string): Promise<boolean> => {
    try {
      await storage.deleteNote(id);
    } catch {
      setSaveError('Failed to delete note.');
      return false;
    }
    // Attachment blobs are pruned asynchronously via pruneOrphanedAttachments
    // using the post-deletion notes list. Computing "still referenced" from
    // a pre-deletion snapshot (as deleteAttachmentBlobsByNoteId does) races
    // with concurrent deletions of sibling notes sharing the same blob.
    const remaining = notesRef.current.filter(n => n.id !== id);
    const validIds = new Set(
      remaining.flatMap(n => (n.attachments ?? []).map(a => a.id))
    );
    storage.pruneOrphanedAttachments(validIds).catch(() => {});
    // Cancel any pending debounce save/snapshot for this note so it cannot be
    // re-written to storage after deletion.
    const pending = saveTimers.current.get(id);
    if (pending) {
      clearTimeout(pending);
      saveTimers.current.delete(id);
    }
    const pendingSnap = snapshotTimers.current.get(id);
    if (pendingSnap) {
      clearTimeout(pendingSnap);
      snapshotTimers.current.delete(id);
      snapshotFirstScheduled.current.delete(id);
    }
    // Clean up history snapshots for the deleted note (best-effort, non-fatal)
    storage.deleteSnapshotsForNote(id).catch(() => {});
    setNotes(prev => syncLinkRefs(prev.filter(n => n.id !== id), prev));
    setRecentNoteIds(prev => prev.filter(rid => rid !== id));
    return true;
  }, [syncLinkRefs]);

  const handleCreateFolder = useCallback((parentFolderId?: string) => {
    const parent = parentFolderId ? folders.find((folder) => folder.id === parentFolderId) : null;
    if (parent?.source === 'obsidian-import') {
      setSaveError('Cannot create folders inside imported vault area.');
      return;
    }
    const desiredPath = parent ? `${parent.name}/New Folder` : 'New Folder';
    const siblingPrefix = parent ? `${parent.name}/` : '';
    const existingNames = new Set(folders.map((folder) => folder.name));

    let nextPath = desiredPath;
    let suffix = 2;
    while (existingNames.has(nextPath)) {
      const leaf = `New Folder ${suffix}`;
      nextPath = parent ? `${siblingPrefix}${leaf}` : leaf;
      suffix += 1;
    }

    const newFolder: Folder = { id: crypto.randomUUID(), name: nextPath, source: 'noa' };
    setFolders(prev => [...prev, newFolder]);
  }, [folders]);

  const handleRenameFolder = useCallback((id: string, name: string) => {
    setFolders(prev => {
      const target = prev.find((folder) => folder.id === id);
      if (!target) return prev;
      const oldPath = target.name;
      const nextPath = name.trim() || 'Untitled Folder';
      return prev.map((folder) => {
        if (folder.id === id) return { ...folder, name: nextPath };
        if (isDescendantPath(folder.name, oldPath)) {
          return { ...folder, name: nextPath + folder.name.slice(oldPath.length) };
        }
        return folder;
      });
    });
  }, []);

  const handleDeleteFolder = useCallback(async (id: string): Promise<string[]> => {
    const currentFolders = foldersRef.current;
    const currentNotes = notesRef.current;
    const target = currentFolders.find((folder) => folder.id === id);
    const folderPrefix = target?.name ?? '';
    const folderIdsToDelete = new Set(
      currentFolders
        .filter((folder) => folder.id === id || folder.name.startsWith(`${folderPrefix}/`))
        .map((folder) => folder.id)
    );
    const toDelete = currentNotes.filter(n => folderIdsToDelete.has(n.folder));
    const results = await Promise.allSettled(
      toDelete.map(async (note) => {
        await storage.deleteNote(note.id);
        return note.id;
      })
    );
    const deletedIds = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map((result) => result.value);
    // Cancel pending debounce saves for all deleted notes.
    deletedIds.forEach((id) => {
      const pending = saveTimers.current.get(id);
      if (pending) {
        clearTimeout(pending);
        saveTimers.current.delete(id);
      }
    });
    const failedCount = results.length - deletedIds.length;
    if (deletedIds.length > 0 || failedCount === 0) {
      const deletedSet = new Set(deletedIds);
      setRecentNoteIds(prev => prev.filter((noteId) => !deletedSet.has(noteId)));
      // Remove deleted notes and, when no failures, also remove the folders themselves.
      // Both are applied in one setNotes call to avoid a redundant syncLinkRefs pass.
      const removeFolders = failedCount === 0;
      setNotes(prev => syncLinkRefs(
        prev.filter(n => !deletedSet.has(n.id) && !(removeFolders && folderIdsToDelete.has(n.folder))),
        prev
      ));
      if (removeFolders) {
        setFolders(prev => prev.filter((folder) => !folderIdsToDelete.has(folder.id)));
      }
    }
    if (failedCount > 0) {
      setSaveError(`Failed to delete ${failedCount} note(s) in folder. Please try again.`);
    }
    if (deletedIds.length > 0) {
      const deletedSet = new Set(deletedIds);
      const remaining = notesRef.current.filter(n => !deletedSet.has(n.id));
      const validIds = new Set(
        remaining.flatMap(n => (n.attachments ?? []).map(a => a.id))
      );
      storage.pruneOrphanedAttachments(validIds).catch(() => {});
    }
    return deletedIds;
  }, [syncLinkRefs]);

  const { handleOpenDailyNote } = useDailyNotes({
    notesRef,
    settings,
    foldersRef,
    setFolders,
    setNotes,
    setActiveNoteIdWithRecent,
  });

  const handleToggleTask = useCallback((task: GlobalTask) => {
    setNotes(prev => {
      const targetNote = prev.find(n => n.id === task.noteId);
      if (!targetNote) return prev;
      const { updatedContent, updated: didUpdate } = toggleTaskInNoteContent(targetNote.content, task);
      if (!didUpdate) return prev;
      const updated = prev.map(n =>
        n.id === task.noteId
          ? { ...n, content: updatedContent, updatedAt: new Date().toISOString(),
              ...(n.source === 'obsidian-import' ? {} : { links: extractLinks(updatedContent), tags: extractTags(updatedContent) }) }
          : n
      );
      const withRefs = syncLinkRefs(updated, prev, new Set([task.noteId]));
      const updatedNote = withRefs.find(n => n.id === task.noteId);
      if (updatedNote) debounceSave(updatedNote);
      return withRefs;
    });
  }, [debounceSave, syncLinkRefs]);

  const handleImportData = useCallback(async (importedNotes: ImportedNote[], importedFolders?: Folder[], newWorkspaceName?: string, shouldPrune = false) => {
    const savedAttachmentIds: string[] = [];
    try {
      const attachmentError = findInvalidAttachmentPayload(importedNotes);
      if (attachmentError) {
        throw new Error(attachmentError);
      }

      const importAttachments = importedNotes.flatMap((note) =>
        (note.attachments ?? [])
          .filter((attachment) => Boolean(attachment.dataBase64))
          .map((attachment) => ({
            id: attachment.id,
            mimeType: attachment.mimeType,
            dataBase64: attachment.dataBase64 as string,
          }))
      );

      // Pre-flight total-size check. base64 adds ~33% overhead, decode into
      // Blob briefly doubles footprint, so the practical peak memory is
      // roughly 2× the raw byte size. We reject imports whose decoded size
      // would exceed this threshold to prevent OOM on low-RAM devices.
      const IMPORT_TOTAL_RAW_LIMIT = 500 * 1024 * 1024; // 500 MB decoded
      const approxRawBytes = importAttachments.reduce(
        (sum, a) => sum + Math.floor(a.dataBase64.length * 0.75),
        0,
      );
      if (approxRawBytes > IMPORT_TOTAL_RAW_LIMIT) {
        throw new Error(
          `Import rejected: attachments total ~${Math.round(approxRawBytes / 1024 / 1024)}MB exceed the ${IMPORT_TOTAL_RAW_LIMIT / 1024 / 1024}MB safety limit. Split the backup into smaller parts.`,
        );
      }

      // Smaller batch size reduces peak memory usage for large attachments.
      const ATTACHMENT_BATCH_SIZE = 5;
      for (let i = 0; i < importAttachments.length; i += ATTACHMENT_BATCH_SIZE) {
        const batch = importAttachments.slice(i, i + ATTACHMENT_BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (attachment) => {
            // Decode base64 via fetch/blob to avoid holding a giant Uint8Array.
            const blob = await fetch(`data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.dataBase64}`)
              .then(r => r.blob());
            await storage.saveAttachmentBlob(attachment.id, blob);
            return attachment.id;
          })
        );
        for (const r of batchResults) {
          if (r.status === 'fulfilled') savedAttachmentIds.push(r.value);
        }
      }

      const { notes: normalizedNotes } = normalizeAndValidateNotes(importedNotes);
      // When vault-sync prunes, rescue any local Noa-native notes that were
      // created between mergeScannedNotes() capturing its snapshot and this
      // import landing. Without this, a note created during bootstrap
      // (Cmd+N while the vault is still scanning) would be prune-deleted.
      const mergedBase: ImportedNote[] = (() => {
        if (!shouldPrune) return normalizedNotes;
        const importedIds = new Set(normalizedNotes.map(n => n.id));
        const rescued = notesRef.current.filter(
          n => (n.source ?? 'noa') === 'noa' && !importedIds.has(n.id)
        );
        return rescued.length > 0 ? [...normalizedNotes, ...rescued] : normalizedNotes;
      })();
      const withRefs = syncLinkRefs(mergedBase.map((note) => {
        // Obsidian-imported notes carry their own tags/links from frontmatter;
        // re-extracting from body content would overwrite them with wrong data.
        if ((note.source ?? 'noa') === 'obsidian-import') return note;
        return {
          ...note,
          tags: extractTags(note.content),
          links: extractLinks(note.content),
        };
      }));
      await storage.saveNotes(withRefs);
      if (shouldPrune) {
        await storage.pruneOrphanedNotes(withRefs.map(n => n.id));
      }
      if (importedFolders) await storage.saveFolders(importedFolders);
      if (newWorkspaceName) await storage.saveWorkspaceName(newWorkspaceName);
      // 清理孤立附件 Blob（best-effort，非关键路径）
      const validIds = new Set(
        importedNotes.flatMap((n) => (n.attachments ?? []).map((a) => a.id))
      );
      storage.pruneOrphanedAttachments(validIds).catch((err) => {
        console.error('[Noa] Failed to prune orphaned attachments:', err);
      });
      // 所有 storage 写入成功后，更新 React state
      setNotes(withRefs);
      if (importedFolders) setFolders(importedFolders);
      if (newWorkspaceName) setWorkspaceName(newWorkspaceName);
    } catch (error) {
      await Promise.allSettled(savedAttachmentIds.map((attachmentId) => storage.deleteAttachmentBlob(attachmentId)));
      throw error;
    }
  }, [syncLinkRefs]);

  const retryInitialization = useCallback(() => {
    setIsLoaded(false);
    setLoadError(null);
    setLoadAttempt((v) => v + 1);
  }, []);

  const resetWorkspaceFromRecovery = useCallback(async () => {
    try {
      await storage.clearAll();
      await applyEmptyWorkspace('Recovered Workspace');
      setLoadError(null);
    } catch (error) {
      const appError = fromStorageError(error);
      setLoadError({ code: appError.code, message: appError.userMessage });
    }
  }, [applyEmptyWorkspace]);

  const clearWorkspaceAfterDisconnect = useCallback(async (): Promise<string[]> => {
    const pending = Array.from(saveTimers.current.values());
    pending.forEach((timer) => clearTimeout(timer));
    saveTimers.current.clear();

    const importedFolderIds = new Set(
      folders.filter((folder) => (folder.source ?? 'noa') === 'obsidian-import').map((folder) => folder.id),
    );
    const importedNotes = notes.filter(
      (note) => (note.source ?? 'noa') === 'obsidian-import' || importedFolderIds.has(note.folder),
    );
    const results = await Promise.allSettled(
      importedNotes.map(async (note) => {
        if (note.attachments?.length) {
          await storage.deleteAttachmentBlobsByNoteId(note.id, note.attachments, notes);
        }
        await storage.deleteNote(note.id);
        return note.id;
      }),
    );

    const deletedNoteIds = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map((result) => result.value);
    const deletedNoteIdsSet = new Set(deletedNoteIds);
    const failedCount = results.length - deletedNoteIds.length;

    const remainingImportedNotes = importedNotes.filter((note) => !deletedNoteIdsSet.has(note.id));
    const importedFolders = folders.filter((folder) => (folder.source ?? 'noa') === 'obsidian-import');
    const importedFolderById = new Map(importedFolders.map((folder) => [folder.id, folder]));
    const importedFolderByName = new Map(importedFolders.map((folder) => [folder.name, folder]));

    const keptImportedFolderIds = new Set<string>();
    for (const note of remainingImportedNotes) {
      const directFolder = importedFolderById.get(note.folder);
      if (!directFolder) continue;
      const segments = directFolder.name.split('/').filter(Boolean);
      let currentPath = '';
      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const matched = importedFolderByName.get(currentPath);
        if (matched) keptImportedFolderIds.add(matched.id);
      }
    }

    const nextFolders = folders.filter((folder) => {
      const source = folder.source ?? 'noa';
      if (source !== 'obsidian-import') return true;
      return keptImportedFolderIds.has(folder.id);
    });
    const nextNotes = notes.filter((note) => !deletedNoteIdsSet.has(note.id));

    if (deletedNoteIds.length > 0 || importedFolderIds.size > 0) {
      const nextNotesWithRefs = syncLinkRefs(nextNotes, notes);
      setFolders(nextFolders);
      setNotes(nextNotesWithRefs);
      setRecentNoteIds((prev) => {
        const next = prev.filter((id) => !deletedNoteIdsSet.has(id));
        saveRecentNoteIds(next);
        return next;
      });
      setActiveNoteId((prev) => (prev && deletedNoteIdsSet.has(prev) ? (nextNotesWithRefs[0]?.id ?? '') : prev));
      await storage.saveFolders(nextFolders);
    }

    // Reset workspace name so Current Path no longer shows the vault name
    // after disconnecting. Use a neutral default rather than the previous
    // vault name which is now stale.
    const DEFAULT_WORKSPACE = 'Default Workspace';
    setWorkspaceName(DEFAULT_WORKSPACE);
    await storage.saveWorkspaceName(DEFAULT_WORKSPACE);

    if (failedCount > 0) {
      setSaveError('Failed to remove some imported notes while disconnecting.');
    } else {
      setSaveError(null);
    }
    return deletedNoteIds;
  }, [folders, notes, syncLinkRefs]);

  const importBackupFromRecovery = useCallback(async (file: File) => {
    try {
      const content = await file.text();
      let parsed: { notes?: ImportedNote[]; folders?: Folder[]; workspaceName?: string };
      try {
        parsed = JSON.parse(content) as { notes?: ImportedNote[]; folders?: Folder[]; workspaceName?: string };
      } catch (error) {
        const appError = fromImportError('import_invalid_json', 'Error parsing backup file.');
        setLoadError({ code: appError.code, message: appError.userMessage });
        return;
      }
      if (!parsed.notes || !Array.isArray(parsed.notes)) {
        const appError = fromImportError('import_invalid_json', 'Invalid backup file.');
        setLoadError({ code: appError.code, message: appError.userMessage });
        return;
      }
      const rawNotes = parsed.notes as ImportedNote[];
      const { notes: normalizedNotes, report } = normalizeAndValidateNotes(rawNotes);
      if (!report.ok) {
        const appError = fromImportError('import_integrity_failed', 'Invalid backup payload.');
        setLoadError({ code: appError.code, message: appError.userMessage });
        return;
      }

      const rawById = new Map(rawNotes.map((note) => [note.id, note]));
      const normalizedWithPayloads: ImportedNote[] = normalizedNotes.map((note) => {
        const merged = mergeAttachmentPayloads(note, rawById.get(note.id));
        const contentValue = merged.content || '';
        return {
          ...merged,
          tags: extractTags(contentValue),
          links: extractLinks(contentValue),
        };
      });
      const attachmentError = findInvalidAttachmentPayload(normalizedWithPayloads);
      if (attachmentError) {
        setLoadError({ code: 'import_integrity_failed', message: attachmentError });
        return;
      }

      await handleImportData(normalizedWithPayloads, parsed.folders || [], parsed.workspaceName || 'Recovered Workspace', true);
      setLoadError(null);
    } catch (error) {
      const importErrorCode = error instanceof Error && error.message.startsWith('Attachment payload is invalid')
        ? 'import_integrity_failed'
        : error instanceof Error && error.message === 'Invalid backup payload.'
          ? 'import_integrity_failed'
          : error instanceof Error && error.message === 'Invalid backup file.'
            ? 'import_invalid_json'
            : null;
      const appError = importErrorCode
        ? fromImportError(importErrorCode, importErrorCode === 'import_invalid_json' ? 'Error parsing backup file.' : 'Import integrity check failed.')
        : fromStorageError(error);
      setLoadError({ code: appError.code, message: appError.userMessage });
    }
  }, [handleImportData]);

  const restoreSnapshot = useCallback(async (snapshot: NoteSnapshot): Promise<void> => {
    const currentNote = notesRef.current.find(n => n.id === snapshot.noteId);
    if (!currentNote) return;

    // Save the current state as a "before restore" snapshot so the user can undo
    const beforeSnapshot: NoteSnapshot = {
      noteId: currentNote.id,
      content: currentNote.content,
      title: currentNote.title,
      savedAt: new Date().toISOString(),
    };
    try {
      await storage.saveSnapshot(beforeSnapshot);
      await storage.pruneSnapshots(currentNote.id);
    } catch { /* non-fatal */ }

    // Apply the restored content, re-deriving links/tags so graph and search stay consistent
    const restoredBase: Note = {
      ...currentNote,
      content: snapshot.content,
      updatedAt: new Date().toISOString(),
      ...(currentNote.source === 'obsidian-import'
        ? {}
        : { links: extractLinks(snapshot.content), tags: extractTags(snapshot.content) }),
    };
    setNotes(prev => {
      const updated = prev.map(n => n.id === restoredBase.id ? restoredBase : n);
      return syncLinkRefs(updated, prev, new Set([restoredBase.id]));
    });
    try {
      await storage.saveNote(restoredBase);
    } catch {
      setSaveError('Failed to save restored note. Storage may be full.');
    }
  }, [syncLinkRefs]);

  return {
    isLoaded,
    loadError,
    saveError,
    setSaveError,
    clearSaveError: () => setSaveError(null),
    flushAllPendingSaves,
    workspaceName,
    setWorkspaceName,
    folders,
    notes,
    activeNoteId,
    setActiveNoteId: setActiveNoteIdWithRecent,
    recentNoteIds,
    handleUpdateNote,
    handleSaveNote,
    handleRenameNote,
    handleCreateNote,
    handleMoveNote,
    handleImportNote,
    handleNavigateToNote,
    handleNavigateToNoteById,
    handleDeleteNote,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleOpenDailyNote: handleOpenDailyNote as (targetDate?: string) => void,
    handleToggleTask,
    handleImportData,
    retryInitialization,
    resetWorkspaceFromRecovery,
    clearWorkspaceAfterDisconnect,
    importBackupFromRecovery,
    restoreSnapshot,
  };
}
