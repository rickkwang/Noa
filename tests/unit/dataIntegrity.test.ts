import { describe, it, expect } from 'vitest';
import { normalizeAndValidateNotes, validateExportData } from '../../src/lib/dataIntegrity';

const validNote = {
  id: 'abc',
  title: 'Test Note',
  content: '# Hello',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: 'f1',
  tags: ['tag1'],
  links: [],
};

describe('normalizeAndValidateNotes', () => {
  it('accepts valid notes', () => {
    const { notes, report } = normalizeAndValidateNotes([validNote]);
    expect(report.ok).toBe(true);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Test Note');
  });

  it('returns error for non-object note', () => {
    const { report } = normalizeAndValidateNotes(['not an object']);
    expect(report.ok).toBe(false);
    expect(report.issues.some(i => i.level === 'error')).toBe(true);
  });

  it('returns error for missing required field', () => {
    const { id: _id, ...noId } = validNote;
    const { report } = normalizeAndValidateNotes([noId]);
    expect(report.ok).toBe(false);
  });

  it('returns error for empty id', () => {
    const { report } = normalizeAndValidateNotes([{ ...validNote, id: '' }]);
    expect(report.ok).toBe(false);
  });

  it('returns warning for empty title but still normalizes', () => {
    const { notes, report } = normalizeAndValidateNotes([{ ...validNote, title: '' }]);
    expect(report.ok).toBe(true); // warnings don't fail
    expect(notes[0].title).toBe('Untitled');
  });

  it('returns error for duplicate ids', () => {
    const { report } = normalizeAndValidateNotes([validNote, { ...validNote }]);
    expect(report.ok).toBe(false);
    expect(report.issues.some(i => i.message.includes('Duplicate'))).toBe(true);
  });

  it('coerces non-string fields gracefully', () => {
    const { notes, report } = normalizeAndValidateNotes([
      { ...validNote, tags: null, links: undefined, linkRefs: [1, 'id-2'] as any },
    ]);
    expect(report.ok).toBe(true);
    expect(notes[0].tags).toEqual([]);
    expect(notes[0].links).toEqual([]);
    expect(notes[0].linkRefs).toEqual(['id-2']);
  });
});

describe('validateExportData', () => {
  const folder = { id: 'f1', name: 'My Folder' };

  it('passes with valid data', () => {
    const report = validateExportData([validNote], [folder]);
    expect(report.ok).toBe(true);
  });

  it('returns error for duplicate note id in export', () => {
    const note2 = { ...validNote };
    const report = validateExportData([validNote, note2], [folder]);
    expect(report.ok).toBe(false);
  });

  it('returns warning for note referencing missing folder', () => {
    const report = validateExportData([{ ...validNote, folder: 'nonexistent' }], []);
    expect(report.ok).toBe(true); // warning only
    expect(report.issues.some(i => i.level === 'warning')).toBe(true);
  });

  it('returns error for missing required field in export note', () => {
    const { content: _c, ...noContent } = validNote;
    const report = validateExportData([noContent as any], [folder]);
    expect(report.ok).toBe(false);
  });
});
