import { describe, expect, it } from 'vitest';
import { pickInitialActiveNoteId } from '../../src/lib/workspaceOwnership';
import type { Folder, Note } from '../../src/types';

const note = (id: string, origin?: 'vault'): Note => ({
  id,
  title: id,
  content: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
  linkRefs: [],
  ...(origin ? { origin } : {}),
});

const noaNotes = [note('a'), note('b')];
const mixedNotes = [note('noa'), note('v1', 'vault'), note('v2', 'vault')];
const noFolders: Folder[] = [];

describe('pickInitialActiveNoteId', () => {
  it('reopens the last active note when its tab was left open', () => {
    expect(pickInitialActiveNoteId(noaNotes, noFolders, 'b', ['a', 'b'])).toBe('b');
  });

  it('opens nothing when every tab was closed', () => {
    expect(pickInitialActiveNoteId(noaNotes, noFolders, 'b', [])).toBe('');
  });

  it('falls back to the rightmost open tab when the last active note was closed', () => {
    expect(pickInitialActiveNoteId(noaNotes, noFolders, 'b', ['a'])).toBe('a');
  });

  it('keeps the pre-tabs fallback when no strip was ever saved', () => {
    expect(pickInitialActiveNoteId(noaNotes, noFolders, 'b', null)).toBe('b');
    expect(pickInitialActiveNoteId(noaNotes, noFolders, 'gone', null)).toBe('a');
  });

  it('never opens a Noa note hidden behind a vault', () => {
    expect(pickInitialActiveNoteId(mixedNotes, noFolders, 'noa', ['noa'])).toBe('');
    expect(pickInitialActiveNoteId(mixedNotes, noFolders, 'noa', ['noa', 'v2'])).toBe('v2');
    expect(pickInitialActiveNoteId(mixedNotes, noFolders, 'noa', null)).toBe('v1');
  });

  it('treats a vault folder alone as a vault workspace', () => {
    const vaultFolder: Folder = { id: 'vf', name: 'docs', origin: 'vault' };
    expect(pickInitialActiveNoteId(noaNotes, [vaultFolder], 'a', null)).toBe('');
  });
});
