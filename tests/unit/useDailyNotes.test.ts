import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { useDailyNotes } from '../../src/hooks/useDailyNotes';
import { storage } from '../../src/lib/storage';
import type { Folder, Note } from '../../src/types';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([null, 'vault-daily'])('keeps a new daily note local when the saved folder is %s', savedId => {
  vi.stubGlobal('localStorage', { getItem: () => savedId, setItem: vi.fn() });
  vi.spyOn(storage, 'saveNote').mockResolvedValue(undefined);
  let notes: Note[] = [];
  let folders: Folder[] = [{ id: 'vault-daily', name: 'Daily Notes', origin: 'vault' }];
  let openDaily!: () => void;
  function Harness() {
    openDaily = useDailyNotes({
      notesRef: { current: notes }, foldersRef: { current: folders },
      setNotes: value => { notes = typeof value === 'function' ? value(notes) : value; },
      setFolders: value => { folders = typeof value === 'function' ? value(folders) : value; },
      setActiveNoteIdWithRecent: vi.fn(),
    }).handleOpenDailyNote;
    return null;
  }
  renderToString(createElement(Harness));
  openDaily();
  expect(notes).toHaveLength(1);
  expect(notes[0].folder).not.toBe('vault-daily');
  expect(folders.find(folder => folder.id === notes[0].folder)).toMatchObject({ name: 'Daily Notes' });
  expect(storage.saveNote).toHaveBeenCalledWith(notes[0]);
});
