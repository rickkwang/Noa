import { useState, useEffect, useCallback, useRef } from 'react';
import { AppErrorCode, AppSettings, Attachment, Folder, GlobalTask, Note } from '../types';
import { storage } from '../lib/storage';
import { builtinTemplates, applyTemplate, formatDate } from '../lib/templates';
import { normalizeAndValidateNotes } from '../lib/dataIntegrity';
import { addRecentNoteId, loadRecentNoteIds, saveRecentNoteIds } from '../lib/recentNotes';
import { fromStorageError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';
import { sortNotesByRecent } from '../lib/noteSort';

interface LoadErrorState {
  code: AppErrorCode;
  message: string;
}

type ImportedAttachment = Attachment & { dataBase64?: string };
type ImportedNote = Note & { attachments?: ImportedAttachment[] };

import { extractLinks, extractTags, recomputeLinkRefsForNotes, recomputeLinkRefsForSubset } from '../lib/noteUtils';
import { toggleTaskInNoteContent } from '../lib/taskParser';
import { useDailyNotes } from './useDailyNotes';

function inferAttachmentMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.avif')) return 'image/avif';
  return 'application/octet-stream';
}

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
    const existing = saveTimers.current.get(note.id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      try {
        await storage.saveNote(note);
      } catch {
        setSaveError('Failed to save note. Storage may be full.');
      }
      saveTimers.current.delete(note.id);
    }, 500);
    saveTimers.current.set(note.id, t);
  }, []);

  const sameStringArray = useCallback((a: string[] = [], b: string[] = []) => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }, []);

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
      { id: 'diary', name: 'diaries' },
      { id: 'essay', name: 'essays' },
    ];
    setFolders(initialFolders);
    setNotes([]);
    setWorkspaceName(name);
    setActiveNoteId('');
    await storage.saveFolders(initialFolders);
    await storage.saveWorkspaceName(name);
  }, []);

  useEffect(() => {
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

        if (savedWorkspace) setWorkspaceName(savedWorkspace);

        if (savedFolders && savedFolders.length > 0) {
          setFolders(savedFolders);
        } else {
          setFolders([
            { id: 'diary', name: 'diaries' },
            { id: 'essay', name: 'essays' }
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
          const hasLegacyLinkRefs = normalized.some((note) => note.linkRefs == null);
          const sorted = sortNotesByRecent(syncLinkRefs(normalized));
          setNotes(sorted);
          if (hasLegacyLinkRefs) {
            void storage.saveNotes(sorted).catch(() => setSaveError('Failed to save note. Storage may be full.'));
          }
          const lastActiveId = localStorage.getItem(LAST_ACTIVE_NOTE_KEY);
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
| \`⌘ S\` | Save (auto-saved) |

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
          };
          const initialFolders = [
            { id: 'diary', name: 'diaries' },
            { id: 'essay', name: 'essays' },
            { id: dailyFolderId, name: 'Daily Notes' }
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
        setIsLoaded(true);
      }
    };
    loadData();
  }, [loadAttempt]);

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
        if (n.id !== id && (
          (n.links && n.links.includes(oldTitle)) ||
          n.content.includes(`[[${oldTitle}]]`)
        )) {
          const updatedContent = n.content.replace(
            new RegExp(`\\[\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g'),
            `[[${newTitle}]]`
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
      const withRefs = syncLinkRefs(updated, prev);
      withRefs.forEach(n => {
        if (n.id === id || (n.links?.includes(newTitle) && n.id !== id)) {
          debounceSave(n);
        }
      });
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
  }, [setActiveNoteIdWithRecent, syncLinkRefs]);

  const handleMoveNote = useCallback((id: string, folderId: string) => {
    setNotes(prev => {
      const target = prev.find((note) => note.id === id);
      if (!target || target.folder === folderId) return prev;
      const nextNote = { ...target, folder: folderId, updatedAt: new Date().toISOString() };
      const updated = prev.map((note) => (note.id === id ? nextNote : note));
      void storage.saveNote(nextNote).catch(() => {
        setSaveError('Failed to move note. Storage may be full.');
      });
      return syncLinkRefs(updated, prev, new Set([id]));
    });
  }, [syncLinkRefs]);

  const handleImportNote = useCallback((title: string, content: string, folderId: string = 'diary', attachmentFile?: File | null) => {
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
  }, [setActiveNoteIdWithRecent, syncLinkRefs]);

  const handleNavigateToNoteById = useCallback((id: string) => {
    setActiveNoteIdWithRecent(id);
  }, [setActiveNoteIdWithRecent]);

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
        folder: folders[0]?.id ?? 'diary',
        tags: [],
        links: [],
        linkRefs: [],
      };
      setActiveNoteIdWithRecent(newNote.id);
      return syncLinkRefs([...prev, newNote], prev, new Set([newNote.id]));
    });
  }, [setActiveNoteIdWithRecent, folders, syncLinkRefs]);

  const handleDeleteNote = useCallback(async (id: string): Promise<boolean> => {
    const noteToDelete = (await storage.getNotes())?.find(n => n.id === id);
    try {
      await storage.deleteNote(id);
    } catch {
      setSaveError('Failed to delete note.');
      return false;
    }
    if (noteToDelete?.attachments?.length) {
      try {
        await storage.deleteAttachmentBlobsByNoteId(id, noteToDelete.attachments);
      } catch (error) {
        console.error('Failed to clean up attachment blobs after note deletion:', error);
      }
    }
    setNotes(prev => syncLinkRefs(prev.filter(n => n.id !== id), prev));
    setRecentNoteIds(prev => prev.filter(rid => rid !== id));
    return true;
  }, [syncLinkRefs]);

  const handleCreateFolder = useCallback((parentFolderId?: string) => {
    const parent = parentFolderId ? folders.find((folder) => folder.id === parentFolderId) : null;
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

    const newFolder: Folder = { id: crypto.randomUUID(), name: nextPath };
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
        if (folder.name === oldPath || folder.name.startsWith(`${oldPath}/`)) {
          return { ...folder, name: nextPath + folder.name.slice(oldPath.length) };
        }
        return folder;
      });
    });
  }, []);

  const handleDeleteFolder = useCallback(async (id: string): Promise<string[]> => {
    const target = folders.find((folder) => folder.id === id);
    const folderPrefix = target?.name ?? '';
    const folderIdsToDelete = new Set(
      folders
        .filter((folder) => folder.id === id || folder.name === folderPrefix || folder.name.startsWith(`${folderPrefix}/`))
        .map((folder) => folder.id)
    );
    const toDelete = notes.filter(n => folderIdsToDelete.has(n.folder));
    try {
      await Promise.all(
        toDelete.flatMap((note) => {
          const ops = [storage.deleteNote(note.id)];
          if (note.attachments?.length) {
            ops.push(storage.deleteAttachmentBlobsByNoteId(note.id, note.attachments));
          }
          return ops;
        })
      );
    } catch {
      setSaveError('Failed to delete some notes in folder.');
      return [];
    }
    const deletedIds = toDelete.map((note) => note.id);
    setFolders(prev => prev.filter((folder) => !folderIdsToDelete.has(folder.id)));
    setRecentNoteIds(prev => prev.filter((noteId) => !deletedIds.includes(noteId)));
    setNotes(prev => syncLinkRefs(prev.filter(n => !folderIdsToDelete.has(n.folder)), prev));
    return deletedIds;
  }, [folders, notes, syncLinkRefs]);

  const { handleOpenDailyNote } = useDailyNotes({
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
      for (const note of importedNotes) {
        for (const attachment of note.attachments ?? []) {
          if (!attachment.dataBase64) continue;
          const binary = atob(attachment.dataBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: attachment.mimeType || 'application/octet-stream' });
          await storage.saveAttachmentBlob(attachment.id, blob);
          savedAttachmentIds.push(attachment.id);
        }
      }

      const { notes: normalizedNotes } = normalizeAndValidateNotes(importedNotes);
      const withRefs = syncLinkRefs(normalizedNotes);
      setNotes(withRefs);
      if (importedFolders) setFolders(importedFolders);
      if (newWorkspaceName) setWorkspaceName(newWorkspaceName);
      await storage.saveNotes(withRefs);
      if (shouldPrune) {
        await storage.pruneOrphanedNotes(withRefs.map(n => n.id));
      }
      // 清理孤立附件 Blob（best-effort）
      const validIds = new Set(
        importedNotes.flatMap((n) => (n.attachments ?? []).map((a) => a.id))
      );
      storage.pruneOrphanedAttachments(validIds).catch(() => {});
      if (importedFolders) await storage.saveFolders(importedFolders);
      if (newWorkspaceName) await storage.saveWorkspaceName(newWorkspaceName);
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

  const importBackupFromRecovery = useCallback(async (file: File) => {
    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      if (!parsed.notes || !Array.isArray(parsed.notes)) {
        throw new Error('Invalid backup file.');
      }
      const rawNotes = parsed.notes as ImportedNote[];
      const { report } = normalizeAndValidateNotes(rawNotes);
      if (!report.ok) {
        throw new Error(report.issues.find((issue) => issue.level === 'error')?.message || 'Invalid backup payload.');
      }
      await handleImportData(rawNotes, parsed.folders || [], parsed.workspaceName || 'Recovered Workspace', true);
      setLoadError(null);
    } catch (error) {
      const appError = fromStorageError(error);
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
    importBackupFromRecovery,
  };
}
