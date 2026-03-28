import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AppSettings, Folder, Note } from '../types';
import { applyTemplate, builtinTemplates, formatDate } from '../lib/templates';
import { storage } from '../lib/storage';

const DAILY_FOLDER_KEY = 'redaction-diary-daily-folder-id';

type UseDailyNotesOptions = {
  settings?: AppSettings;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setActiveNoteIdWithRecent: (id: string) => void;
};

export function useDailyNotes({
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
      const savedId = localStorage.getItem(DAILY_FOLDER_KEY);
      const existingFolder = savedId
        ? (prevFolders.find((folder) => folder.id === savedId) ?? prevFolders.find((folder) => folder.name === 'Daily Notes'))
        : prevFolders.find((folder) => folder.name === 'Daily Notes');
      const isNew = !existingFolder;
      const dailyFolder = existingFolder ?? { id: crypto.randomUUID(), name: 'Daily Notes' };
      if (isNew) localStorage.setItem(DAILY_FOLDER_KEY, dailyFolder.id);
      const nextFolders = existingFolder ? prevFolders : [...prevFolders, dailyFolder];

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
        };
        storage.saveNote(newNote);
        setActiveNoteIdWithRecent(newNote.id);
        return [...prevNotes, newNote];
      });

      return nextFolders;
    });
  }, [setActiveNoteIdWithRecent, setFolders, setNotes, settings?.dailyNotes?.dateFormat, settings?.dailyNotes?.template]);

  return { handleOpenDailyNote };
}
