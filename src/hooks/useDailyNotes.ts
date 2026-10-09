import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { recomputeLinkRefsForNotes } from '../lib/noteUtils';
import { storage } from '../lib/storage';
import { applyTemplate, builtinTemplates, formatDate } from '../lib/templates';
import { AppSettings, Folder, Note } from '../types';

const DAILY_FOLDER_KEY = STORAGE_KEYS.DAILY_FOLDER_ID;

export function dateFromCalendarKey(targetDate?: string): Date {
  if (!targetDate) return new Date();
  const [year, month, day] = targetDate.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    && parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : new Date();
}

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
  // Synchronous mutex: double-invocations would each mint a folder UUID before setFolders, duplicating "Daily Notes".
  const creatingRef = useRef(false);
  // Returns the note it opened and whether this call created it, or undefined
  // when a concurrent call already holds the mutex.
  const handleOpenDailyNote = useCallback((targetDate?: string): { noteId: string; created: boolean } | undefined => {
    if (creatingRef.current) return undefined;
    creatingRef.current = true;
    try {
    const dateFormat = settings?.dailyNotes?.dateFormat ?? 'YYYY-MM-DD';
    // Calendar passes a YYYY-MM-DD key; convert once so title, dedupe, and template placeholders share the user's date format.
    const noteDate = dateFromCalendarKey(targetDate);
    const today = formatDate(dateFormat, noteDate);
    const customTemplate = settings?.dailyNotes?.template?.trim();
    const dailyTemplate = customTemplate
      ? { id: 'custom', name: 'Custom', content: customTemplate }
      : builtinTemplates.find((template) => template.id === 'daily')!;

    // Read latest folders synchronously — no updater needed.
    const currentFolders = foldersRef.current.filter(folder => folder.origin !== 'vault');
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
      return { noteId: earlyExisting.id, created: false };
    }

    // Build the new note — IO happens outside any state updater.
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: today,
      content: applyTemplate(dailyTemplate, today, dateFormat, noteDate),
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
      // The updater is the authoritative duplicate guard (StrictMode double-invoke skips state and IO).
      if (prev.some((n) => n.title === today && n.folder === dailyFolder.id)) return prev;
      void storage.saveNote(newNote).catch((err) => {
        console.error('[Noa] Failed to save daily note:', err);
      });
      return recomputeLinkRefsForNotes([...prev, newNote], foldersRef.current);
    });
    return { noteId: newNote.id, created: true };
    } finally {
      // Release after current microtask so nested synchronous re-entry is
      // blocked, but future user actions are not.
      queueMicrotask(() => { creatingRef.current = false; });
    }
  }, [notesRef, setActiveNoteIdWithRecent, setFolders, setNotes, settings?.dailyNotes?.dateFormat, settings?.dailyNotes?.template, foldersRef]);

  return { handleOpenDailyNote };
}
