import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AppSettings, Folder, Note } from '../types';
import { applyTemplate, builtinTemplates, formatDate } from '../lib/templates';
import { storage } from '../lib/storage';
import { recomputeLinkRefsForNotes } from '../lib/noteUtils';
import { STORAGE_KEYS } from '../constants/storageKeys';

const DAILY_FOLDER_KEY = STORAGE_KEYS.DAILY_FOLDER_ID;

type UseDailyNotesOptions = {
  notesRef: React.MutableRefObject<Note[]>;
  settings?: AppSettings;
  foldersRef: React.MutableRefObject<Folder[]>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setActiveNoteIdWithRecent: (id: string) => void;
};

export function useDailyNotes({
  notesRef,
  settings,
  foldersRef,
  setFolders,
  setNotes,
  setActiveNoteIdWithRecent,
}: UseDailyNotesOptions) {
  // Synchronous mutex: rapid double-invocations (e.g. double-click or Strict
  // Mode) would otherwise each mint a fresh folder UUID before setFolders runs,
  // creating duplicate "Daily Notes" folders.
  const creatingRef = useRef(false);
  const handleOpenDailyNote = useCallback((targetDate?: string) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
    const dateFormat = settings?.dailyNotes?.dateFormat ?? 'YYYY-MM-DD';
    const today = targetDate ?? formatDate(dateFormat);
    const customTemplate = settings?.dailyNotes?.template?.trim();
    const dailyTemplate = customTemplate
      ? { id: 'custom', name: 'Custom', content: customTemplate }
      : builtinTemplates.find((template) => template.id === 'daily')!;

    // Read latest folders synchronously — no updater needed.
    const currentFolders = foldersRef.current;
    let savedId: string | null = null;
    try { savedId = localStorage.getItem(DAILY_FOLDER_KEY); } catch { /* quota exceeded */ }
    const existingFolder = savedId
      ? (currentFolders.find((folder) => folder.id === savedId) ?? currentFolders.find((folder) => folder.name === 'Daily Notes'))
      : currentFolders.find((folder) => folder.name === 'Daily Notes');
    const isNewFolder = !existingFolder;
    const dailyFolder = existingFolder ?? { id: crypto.randomUUID(), name: 'Daily Notes' };
    if (isNewFolder) {
      try { localStorage.setItem(DAILY_FOLDER_KEY, dailyFolder.id); } catch { /* quota exceeded */ }
    }

    // Check if daily note already exists — use ref for latest state.
    const earlyExisting = notesRef.current.find((note) => note.title === today && note.folder === dailyFolder.id);
    if (earlyExisting) {
      setActiveNoteIdWithRecent(earlyExisting.id);
      setFolders((prev) => {
        if (prev.find((f) => f.id === dailyFolder.id)) return prev;
        return [...prev, dailyFolder];
      });
      return;
    }

    // Build the new note — IO happens outside any state updater.
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: today,
      content: applyTemplate(dailyTemplate, today, dateFormat),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folder: dailyFolder.id,
      tags: ['daily'],
      links: [],
      linkRefs: [],
    };

    setActiveNoteIdWithRecent(newNote.id);
    setFolders((prev) => {
      if (prev.find((f) => f.id === dailyFolder.id)) return prev;
      return [...prev, dailyFolder];
    });
    setNotes((prev) => {
      // The updater is the authoritative duplicate guard — if the note already
      // exists (e.g. Strict Mode double-invoke), we skip both state and IO.
      if (prev.some((n) => n.title === today && n.folder === dailyFolder.id)) return prev;
      void storage.saveNote(newNote).catch((err) => {
        console.error('[Noa] Failed to save daily note:', err);
      });
      return recomputeLinkRefsForNotes([...prev, newNote]);
    });
    } finally {
      // Release after current microtask so nested synchronous re-entry is
      // blocked, but future user actions are not.
      queueMicrotask(() => { creatingRef.current = false; });
    }
  }, [notesRef, setActiveNoteIdWithRecent, setFolders, setNotes, settings?.dailyNotes?.dateFormat, settings?.dailyNotes?.template, foldersRef]);

  return { handleOpenDailyNote };
}
