import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AppSettings, Folder, Note } from '../types';
import { applyTemplate, builtinTemplates, formatDate } from '../lib/templates';
import { storage } from '../lib/storage';
import { recomputeLinkRefsForNotes } from '../lib/noteUtils';
import { STORAGE_KEYS } from '../constants/storageKeys';

const DAILY_FOLDER_KEY = STORAGE_KEYS.DAILY_FOLDER_ID;

type UseDailyNotesOptions = {
  notes: Note[];
  settings?: AppSettings;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setActiveNoteIdWithRecent: (id: string) => void;
};

export function useDailyNotes({
  notes,
  settings,
  setFolders,
  setNotes,
  setActiveNoteIdWithRecent,
}: UseDailyNotesOptions) {
  const handleOpenDailyNote = useCallback((targetDate?: string) => {
    const dateFormat = settings?.dailyNotes?.dateFormat ?? 'YYYY-MM-DD';
    const today = targetDate ?? formatDate(dateFormat);
    const customTemplate = settings?.dailyNotes?.template?.trim();
    const dailyTemplate = customTemplate
      ? { id: 'custom', name: 'Custom', content: customTemplate }
      : builtinTemplates.find((template) => template.id === 'daily')!;

    setFolders((prevFolders) => {
      let savedId: string | null = null;
      try { savedId = localStorage.getItem(DAILY_FOLDER_KEY); } catch { /* quota exceeded */ }
      const existingFolder = savedId
        ? (prevFolders.find((folder) => folder.id === savedId) ?? prevFolders.find((folder) => folder.name === 'Daily Notes'))
        : prevFolders.find((folder) => folder.name === 'Daily Notes');
      const isNew = !existingFolder;
      const dailyFolder = existingFolder ?? { id: crypto.randomUUID(), name: 'Daily Notes' };
      if (isNew) {
        try { localStorage.setItem(DAILY_FOLDER_KEY, dailyFolder.id); } catch { /* quota exceeded */ }
      }
      const nextFolders = existingFolder ? prevFolders : [...prevFolders, dailyFolder];

      const earlyExisting = notes.find((note) => note.title === today && note.folder === dailyFolder.id);
      if (earlyExisting) {
        setActiveNoteIdWithRecent(earlyExisting.id);
        return nextFolders;
      }

      setNotes((prevNotes) => {
        const existingNote = prevNotes.find((note) => note.title === today && note.folder === dailyFolder.id);
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
          links: [],
          linkRefs: [],
        };
        void storage.saveNote(newNote).catch(() => {});
        setActiveNoteIdWithRecent(newNote.id);
        return recomputeLinkRefsForNotes([...prevNotes, newNote]);
      });

      return nextFolders;
    });
  }, [notes, setActiveNoteIdWithRecent, setFolders, setNotes, settings?.dailyNotes?.dateFormat, settings?.dailyNotes?.template]);

  return { handleOpenDailyNote };
}
