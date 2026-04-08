import { useState, useEffect, useCallback, useRef } from 'react';
import { AppErrorCode, AppSettings, Attachment, Folder, GlobalTask, Note } from '../types';
import { storage } from '../lib/storage';
import { builtinTemplates, applyTemplate, formatDate } from '../lib/templates';
import { normalizeAndValidateNotes } from '../lib/dataIntegrity';
import { addRecentNoteId, loadRecentNoteIds, saveRecentNoteIds } from '../lib/recentNotes';
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

export function useNotes(settings?: AppSettings) {
  const LAST_ACTIVE_NOTE_KEY = 'redaction-last-active-note-id';
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

  const debounceSave = useCallback((note: Note) => {
    const snapshot = { ...note };
    const existing = saveTimers.current.get(note.id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      try {
        await storage.saveNote(snapshot);
      } catch {
        setSaveError('Failed to save note. Storage may be full.');
      }
      saveTimers.current.delete(snapshot.id);
    }, 500);
    saveTimers.current.set(note.id, t);
  }, []);

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

  // Cleanup all pending save timers on unmount
  useEffect(() => {
    return () => {
      saveTimers.current.forEach(t => clearTimeout(t));
      saveTimers.current.clear();
    };
  }, []);

  const flushAllPendingSaves = useCallback(async (currentNotes: Note[]) => {
    const pending = Array.from(saveTimers.current.keys());
    for (const id of pending) {
      clearTimeout(saveTimers.current.get(id));
      saveTimers.current.delete(id);
      const note = currentNotes.find(n => n.id === id);
      if (note) {
        try { await storage.saveNote(note); } catch { /* best effort on quit */ }
      }
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
    let mounted = true;
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

        if (!mounted) return;

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
          let lastActiveId: string | null = null;
          try { lastActiveId = localStorage.getItem(LAST_ACTIVE_NOTE_KEY); } catch { /* quota exceeded */ }
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
- **Knowledge Graph** — Visualize note connections
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
          const dailyTemplate = builtinTemplates.find(t => t.id === 'daily')!;
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
        if (!mounted) return;
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
        if (mounted) setIsLoaded(true);
      }
    };
    loadData();
    return () => { mounted = false; };
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
          ? { ...n, content, updatedAt: new Date().toISOString(), links: extractLinks(content), tags: extractTags(content) }
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
          return {
            ...n,
            content: updatedContent,
            links: n.links.map(l => l === oldTitle ? newTitle : l),
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
    try {
      localStorage.setItem(LAST_ACTIVE_NOTE_KEY, id);
    } catch {
      // ignore storage write issues
    }
    setRecentNoteIds(prev => {
      const next = addRecentNoteId(prev, id);
      saveRecentNoteIds(next);
      return next;
    });
  }, [LAST_ACTIVE_NOTE_KEY]);

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

  const handleImportNote = useCallback((title: string, content: string, folderId: string = 'diary', attachmentFile?: File | null) => {
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
      setNotes(prev => {
        const next = syncLinkRefs([...prev, newNote], prev, new Set([newNote.id]));
        const created = next.find((n) => n.id === newNote.id) ?? newNote;
        void storage.saveNote(created).catch(() => {
          setSaveError('Failed to save note. Storage may be full.');
        });
        return next;
      });
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
      let blobSaved = false;
      try {
        await storage.saveAttachmentBlob(attachmentId, attachmentFile);
        blobSaved = true;
        setNotes(prev => {
          const next = syncLinkRefs([...prev, noteWithAttachment], prev, new Set([noteWithAttachment.id]));
          return next;
        });
        await storage.saveNote(noteWithAttachment);
        setActiveNoteIdWithRecent(noteWithAttachment.id);
      } catch {
        const pendingSave = saveTimers.current.get(noteWithAttachment.id);
        if (pendingSave) {
          clearTimeout(pendingSave);
          saveTimers.current.delete(noteWithAttachment.id);
        }
        setNotes(prev => prev.filter((note) => note.id !== noteWithAttachment.id));
        if (blobSaved) {
          try {
            await storage.deleteAttachmentBlob(attachmentId);
          } catch {
            // best effort rollback
          }
        }
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
    setNotes(prev => {
      const target = prev.find(n => n.title === title);
      if (target) {
        setActiveNoteIdWithRecent(target.id);
        return prev;
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
      setActiveNoteIdWithRecent(newNote.id);
      return syncLinkRefs([...prev, newNote], prev, new Set([newNote.id]));
    });
  }, [setActiveNoteIdWithRecent, syncLinkRefs]);

  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  const handleDeleteNote = useCallback(async (id: string): Promise<boolean> => {
    const noteToDelete = notesRef.current.find(n => n.id === id);
    try {
      if (noteToDelete?.attachments?.length) {
        await storage.deleteAttachmentBlobsByNoteId(id, noteToDelete.attachments);
      }
      await storage.deleteNote(id);
    } catch {
      setSaveError('Failed to delete note.');
      return false;
    }
    // Cancel any pending debounce save for this note so it cannot be
    // re-written to storage after deletion.
    const pending = saveTimers.current.get(id);
    if (pending) {
      clearTimeout(pending);
      saveTimers.current.delete(id);
    }
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
        if (note.attachments?.length) {
          await storage.deleteAttachmentBlobsByNoteId(note.id, note.attachments);
        }
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
    if (failedCount > 0) {
      setSaveError('Failed to delete some notes in folder.');
      if (deletedIds.length > 0) {
        const deletedSet = new Set(deletedIds);
        setRecentNoteIds(prev => prev.filter((noteId) => !deletedSet.has(noteId)));
        setNotes(prev => syncLinkRefs(prev.filter((note) => !deletedSet.has(note.id)), prev));
      }
      return deletedIds;
    }
    setFolders(prev => prev.filter((folder) => !folderIdsToDelete.has(folder.id)));
    setRecentNoteIds(prev => prev.filter((noteId) => !deletedIds.includes(noteId)));
    setNotes(prev => syncLinkRefs(prev.filter(n => !folderIdsToDelete.has(n.folder)), prev));
    return deletedIds;
  }, [syncLinkRefs]);

  const { handleOpenDailyNote } = useDailyNotes({
    notes,
    settings,
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
          ? { ...n, content: updatedContent, updatedAt: new Date().toISOString(), links: extractLinks(updatedContent), tags: extractTags(updatedContent) }
          : n
      );
      const withRefs = syncLinkRefs(updated, prev, new Set([task.noteId]));
      const updatedNote = withRefs.find(n => n.id === task.noteId)!;
      debounceSave(updatedNote);
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

      const ATTACHMENT_BATCH_SIZE = 20;
      for (let i = 0; i < importAttachments.length; i += ATTACHMENT_BATCH_SIZE) {
        const batch = importAttachments.slice(i, i + ATTACHMENT_BATCH_SIZE);
        await Promise.all(
          batch.map(async (attachment) => {
            const binary = atob(attachment.dataBase64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j += 1) {
              bytes[j] = binary.charCodeAt(j);
            }
            const blob = new Blob([bytes], { type: attachment.mimeType || 'application/octet-stream' });
            await storage.saveAttachmentBlob(attachment.id, blob);
            savedAttachmentIds.push(attachment.id);
          })
        );
      }

      const { notes: normalizedNotes } = normalizeAndValidateNotes(importedNotes);
      const withRefs = syncLinkRefs(normalizedNotes.map((note) => ({
        ...note,
        tags: extractTags(note.content),
        links: extractLinks(note.content),
      })));
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
      storage.pruneOrphanedAttachments(validIds).catch(() => {});
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
          await storage.deleteAttachmentBlobsByNoteId(note.id, note.attachments);
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

  return {
    isLoaded,
    loadError,
    saveError,
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
  };
}
