import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { useDailyNotes } from '../../src/hooks/useDailyNotes';
import { storage } from '../../src/lib/storage';
import { formatDate } from '../../src/lib/templates';
import type { Folder, Note } from '../../src/types';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([null, 'vault-daily'])('keeps a new daily note local when the saved folder is %s', savedId => {
  vi.stubGlobal('localStorage', { getItem: () => savedId, setItem: vi.fn() });
  vi.spyOn(storage, 'saveNote').mockResolvedValue(undefined);
  let notes: Note[] = [];
  let folders: Folder[] = [{ id: 'vault-daily', name: 'Daily Notes', origin: 'vault' }];
  let openDaily!: () => { noteId: string; created: boolean } | undefined;
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
  const opened = openDaily();
  expect(notes).toHaveLength(1);
  // App focuses whatever this returns; only a created note gets its template
  // slot filled, so `created` must be true here and false on a reopen.
  expect(opened).toEqual({ noteId: notes[0].id, created: true });
  expect(notes[0].folder).not.toBe('vault-daily');
  expect(folders.find(folder => folder.id === notes[0].folder)).toMatchObject({ name: 'Daily Notes' });
  expect(storage.saveNote).toHaveBeenCalledWith(notes[0]);
});

it("reports an existing daily note as not created, so opening it doesn't edit it", () => {
  vi.stubGlobal('localStorage', { getItem: () => 'daily', setItem: vi.fn() });
  const saveNote = vi.spyOn(storage, 'saveNote').mockResolvedValue(undefined);
  const today: Note = {
    id: 'today', title: formatDate('YYYY-MM-DD'), content: "## Today's Focus\n- [ ]\n", folder: 'daily',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: ['daily'], links: [], linkRefs: [],
  };
  const setNotes = vi.fn();
  let openDaily!: () => { noteId: string; created: boolean } | undefined;
  function Harness() {
    openDaily = useDailyNotes({
      notesRef: { current: [today] }, foldersRef: { current: [{ id: 'daily', name: 'Daily Notes' }] },
      setNotes, setFolders: vi.fn(), setActiveNoteIdWithRecent: vi.fn(),
    }).handleOpenDailyNote;
    return null;
  }
  renderToString(createElement(Harness));
  expect(openDaily()).toEqual({ noteId: 'today', created: false });
  expect(setNotes).not.toHaveBeenCalled();
  expect(saveNote).not.toHaveBeenCalled();
});
