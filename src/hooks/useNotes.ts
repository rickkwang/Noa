import { useState, useEffect, useCallback, useRef } from 'react';
import { AppErrorCode, AppSettings, Folder, GlobalTask, Note } from '../types';
import { storage } from '../lib/storage';
import { builtinTemplates, applyTemplate, formatDate } from '../lib/templates';
import { normalizeAndValidateNotes } from '../lib/dataIntegrity';
import { addRecentNoteId, loadRecentNoteIds, saveRecentNoteIds } from '../lib/recentNotes';
import { fromStorageError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';

interface LoadErrorState {
  code: AppErrorCode;
  message: string;
}

import { extractLinks, extractTags } from '../lib/noteUtils';

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

        const savedWorkspace = await storage.getWorkspaceName();
        if (savedWorkspace) setWorkspaceName(savedWorkspace);

        const savedFolders = await storage.getFolders();
        if (savedFolders && savedFolders.length > 0) {
          setFolders(savedFolders);
        } else {
          setFolders([
            { id: 'diary', name: 'diaries' },
            { id: 'essay', name: 'essays' }
          ]);
        }

        const savedNotes = await storage.getNotes();
        if (savedNotes && savedNotes.length > 0) {
          const { notes: normalized, report } = normalizeAndValidateNotes(savedNotes);
          if (!report.ok) {
            throw new Error(
              report.issues.find((issue) => issue.level === 'error')?.message ??
              'Data integrity check failed while loading notes.',
            );
          }
          setNotes(normalized);
          setActiveNoteId(normalized[0].id);
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
| \`⌘ K\` | Open today's daily note |
| \`⌘ S\` | Save (auto-saved) |

## Features

- **Markdown editor** — Edit, Preview, or Split view
- **Wiki links** — Type \`[[Note Title]]\` to link notes
- **Tasks** — Use \`- [ ] task\` syntax, track in right panel
- **Tags** — Use \`#tag\` in notes, browse in sidebar
- **Knowledge Graph** — Visualize note connections
- **File Sync** — Connect a local folder to sync \`.md\` files
- **Daily Notes** — One note per day, auto-dated

## Data Safety

All notes are stored **locally in your browser** (IndexedDB).
Export regularly: use Settings → Data → Export Backup.`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          folder: 'diary',
          tags: [],
          links: []
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
            links: []
          };
          const initialFolders = [
            { id: 'diary', name: 'diaries' },
            { id: 'essay', name: 'essays' },
            { id: dailyFolderId, name: 'Daily Notes' }
          ];
          setFolders(initialFolders);
          setNotes([welcomeNote, dailyNote]);
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
      const note = updated.find(n => n.id === id);
      if (note) debounceSave(note);
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
      updated.forEach(n => {
        if (n.id === id || (n.links?.includes(newTitle) && n.id !== id)) {
          debounceSave(n);
        }
      });
      return updated;
    });
  }, [debounceSave]);

  const setActiveNoteIdWithRecent = useCallback((id: string) => {
    setActiveNoteId(id);
    if (!id) return;
    setRecentNoteIds(prev => {
      const next = addRecentNoteId(prev, id);
      saveRecentNoteIds(next);
      return next;
    });
  }, []);

  const handleCreateNote = useCallback((folderId: string, initialContent: string = '') => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: initialContent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folder: folderId,
      tags: [],
      links: []
    };
    setNotes(prev => [...prev, newNote]);
    storage.saveNote(newNote);
    setActiveNoteIdWithRecent(newNote.id);
  }, [setActiveNoteIdWithRecent]);

  const handleImportNote = useCallback((title: string, content: string, folderId: string = 'diary') => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folder: folderId,
      tags: extractTags(content),
      links: extractLinks(content)
    };
    setNotes(prev => [...prev, newNote]);
    storage.saveNote(newNote);
    setActiveNoteIdWithRecent(newNote.id);
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
        links: []
      };
      storage.saveNote(newNote);
      setActiveNoteIdWithRecent(newNote.id);
      return [...prev, newNote];
    });
  }, [setActiveNoteIdWithRecent, folders]);

  const handleDeleteNote = useCallback((id: string) => {
    storage.deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleCreateFolder = useCallback(() => {
    const newFolder: Folder = { id: crypto.randomUUID(), name: 'New Folder' };
    setFolders(prev => [...prev, newFolder]);
  }, []);

  const handleRenameFolder = useCallback((id: string, name: string) => {
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
  }, []);

  const handleDeleteFolder = useCallback((id: string) => {
    setFolders(prev => prev.filter(f => f.id !== id));
    setNotes(prev => {
      const toDelete = prev.filter(n => n.folder === id);
      toDelete.forEach(n => storage.deleteNote(n.id));
      return prev.filter(n => n.folder !== id);
    });
  }, []);

  const DAILY_FOLDER_KEY = 'redaction-diary-daily-folder-id';

  const handleOpenDailyNote = useCallback((targetDate?: string) => {
    const dateFormat = settings?.dailyNotes?.dateFormat ?? 'YYYY-MM-DD';
    const today = targetDate ?? formatDate(dateFormat);
    const customTemplate = settings?.dailyNotes?.template?.trim();
    const dailyTemplate = customTemplate
      ? { id: 'custom', name: 'Custom', content: customTemplate }
      : builtinTemplates.find(t => t.id === 'daily')!;

    setFolders(prevFolders => {
      const savedId = localStorage.getItem(DAILY_FOLDER_KEY);
      const existingFolder = savedId
        ? (prevFolders.find(f => f.id === savedId) ?? prevFolders.find(f => f.name === 'Daily Notes'))
        : prevFolders.find(f => f.name === 'Daily Notes');
      const isNew = !existingFolder;
      const dailyFolder = existingFolder ?? { id: crypto.randomUUID(), name: 'Daily Notes' };
      if (isNew) localStorage.setItem(DAILY_FOLDER_KEY, dailyFolder.id);
      const newFolders = existingFolder ? prevFolders : [...prevFolders, dailyFolder];

      setNotes(prevNotes => {
        const existingNote = prevNotes.find(n => n.title === today && n.folder === dailyFolder.id);
        if (existingNote) {
          setActiveNoteIdWithRecent(existingNote.id);
          return prevNotes;
        }
        const newNote: Note = {
          id: crypto.randomUUID(),
          title: today,
          content: applyTemplate(dailyTemplate, today, dateFormat),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          folder: dailyFolder.id,
          tags: ['daily'],
          links: []
        };
        storage.saveNote(newNote);
        setActiveNoteIdWithRecent(newNote.id);
        return [...prevNotes, newNote];
      });

      return newFolders;
    });
  }, [settings?.dailyNotes?.dateFormat, settings?.dailyNotes?.template, setActiveNoteIdWithRecent]);

  const handleToggleTask = useCallback((task: GlobalTask) => {
    setNotes(prev => {
      const targetNote = prev.find(n => n.id === task.noteId);
      if (!targetNote) return prev;
      const lines = targetNote.content.split('\n');
      const line = lines[task.lineIndex];
      // Prefer exact line index match; only fall back to text search if line text doesn't match
      const isCorrectLine = line !== undefined &&
        line.includes(task.content) &&
        (task.completed ? /\[x\]/i.test(line) : /\[ \]/.test(line));
      const exactMatchIndex = lines.findIndex(l => l === task.originalString);
      const targetIndex = isCorrectLine
        ? task.lineIndex
        : exactMatchIndex !== -1
          ? exactMatchIndex
          : lines.findIndex(l =>
              l.includes(task.content) &&
              (task.completed ? /\[x\]/i.test(l) : /\[ \]/.test(l))
            );
      if (targetIndex === -1) return prev;
      lines[targetIndex] = task.completed
        ? lines[targetIndex].replace(/\[x\]/i, '[ ]')
        : lines[targetIndex].replace('[ ]', '[x]');
      const newContent = lines.join('\n');
      const updated = prev.map(n => n.id === task.noteId ? { ...n, content: newContent, updatedAt: new Date().toISOString() } : n);
      const updatedNote = updated.find(n => n.id === task.noteId)!;
      debounceSave(updatedNote);
      return updated;
    });
  }, [debounceSave]);

  const handleImportData = useCallback(async (importedNotes: Note[], importedFolders?: Folder[], newWorkspaceName?: string) => {
    const { notes: normalizedNotes } = normalizeAndValidateNotes(importedNotes);
    setNotes(normalizedNotes);
    if (importedFolders) setFolders(importedFolders);
    if (newWorkspaceName) setWorkspaceName(newWorkspaceName);
    await storage.saveNotes(normalizedNotes);
    await storage.pruneOrphanedNotes(normalizedNotes.map(n => n.id));
    if (importedFolders) await storage.saveFolders(importedFolders);
    if (newWorkspaceName) await storage.saveWorkspaceName(newWorkspaceName);
  }, []);

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
      const { notes: normalized, report } = normalizeAndValidateNotes(parsed.notes);
      if (!report.ok) {
        throw new Error(report.issues.find((issue) => issue.level === 'error')?.message || 'Invalid backup payload.');
      }
      await handleImportData(normalized, parsed.folders || [], parsed.workspaceName || 'Recovered Workspace');
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
    handleRenameNote,
    handleCreateNote,
    handleImportNote,
    handleNavigateToNote,
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
