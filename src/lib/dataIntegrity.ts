import { Attachment, Folder, Note } from '../types';

export const REQUIRED_NOTE_FIELDS = ['id', 'title', 'content', 'createdAt', 'updatedAt'] as const;

export interface IntegrityIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface IntegrityReport {
  ok: boolean;
  noteCount: number;
  uniqueIdCount: number;
  issues: IntegrityIssue[];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function normalizeAttachment(
  raw: unknown,
  noteId: string,
  idx: number,
  attachmentIdx: number,
  issues: IntegrityIssue[],
): Attachment | null {
  if (!raw || typeof raw !== 'object') {
    issues.push({
      level: 'warning',
      message: `Note #${idx + 1} (${noteId || 'unknown-id'}) attachment #${attachmentIdx + 1} is invalid and was skipped.`,
    });
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const id = isString(obj.id) ? obj.id : String(obj.id ?? '');
  const filename = isString(obj.filename) ? obj.filename : String(obj.filename ?? '');
  const mimeType = isString(obj.mimeType) ? obj.mimeType : 'application/octet-stream';
  const size = typeof obj.size === 'number' ? obj.size : Number(obj.size ?? 0);
  const createdAt = isString(obj.createdAt) ? obj.createdAt : new Date().toISOString();
  const attachmentNoteId = isString(obj.noteId) ? obj.noteId : noteId;

  if (!id.trim() || !filename.trim()) {
    issues.push({
      level: 'warning',
      message: `Note #${idx + 1} (${noteId || 'unknown-id'}) attachment #${attachmentIdx + 1} missing id or filename and was skipped.`,
    });
    return null;
  }

  return {
    id,
    noteId: attachmentNoteId,
    filename,
    mimeType,
    size: Number.isFinite(size) ? size : 0,
    createdAt,
  };
}

function normalizeNote(raw: unknown, idx: number): { note: Note | null; issues: IntegrityIssue[] } {
  const issues: IntegrityIssue[] = [];
  if (!raw || typeof raw !== 'object') {
    issues.push({ level: 'error', message: `Note #${idx + 1} is not an object.` });
    return { note: null, issues };
  }

  const obj = raw as Record<string, unknown>;
  for (const key of REQUIRED_NOTE_FIELDS) {
    if (!(key in obj)) {
      issues.push({ level: 'error', message: `Note #${idx + 1} missing required field: ${key}.` });
    }
  }

  if (issues.some(i => i.level === 'error')) return { note: null, issues };

  const id = isString(obj.id) ? obj.id : String(obj.id ?? '');
  const title = isString(obj.title) ? obj.title : String(obj.title ?? '');
  const content = isString(obj.content) ? obj.content : String(obj.content ?? '');
  const createdAt = isString(obj.createdAt) ? obj.createdAt : new Date().toISOString();
  const updatedAt = isString(obj.updatedAt) ? obj.updatedAt : new Date().toISOString();
  const folder = isString(obj.folder) ? obj.folder : '';
  const tags = Array.isArray(obj.tags) ? obj.tags.filter(isString) : [];
  const links = Array.isArray(obj.links) ? obj.links.filter(isString) : [];
  const linkRefs = Array.isArray(obj.linkRefs) ? obj.linkRefs.filter(isString) : [];
  const source = obj.source === 'obsidian-import' ? 'obsidian-import' : 'noa';
  const attachments = Array.isArray(obj.attachments)
    ? obj.attachments
        .map((attachment, attachmentIdx) => normalizeAttachment(attachment, id, idx, attachmentIdx, issues))
        .filter((attachment): attachment is Attachment => attachment !== null)
    : undefined;

  if (!id.trim()) issues.push({ level: 'error', message: `Note #${idx + 1} has empty id.` });
  if (!title.trim()) issues.push({ level: 'warning', message: `Note #${idx + 1} has empty title.` });

  return {
    note: {
      id,
      title: title || 'Untitled',
      content,
      createdAt,
      updatedAt,
      folder,
      tags,
      links,
      linkRefs,
      attachments,
      source,
    },
    issues,
  };
}

export function normalizeAndValidateNotes(input: unknown[]): { notes: Note[]; report: IntegrityReport } {
  const notes: Note[] = [];
  const issues: IntegrityIssue[] = [];

  input.forEach((item, idx) => {
    const normalized = normalizeNote(item, idx);
    issues.push(...normalized.issues);
    if (normalized.note) notes.push(normalized.note);
  });

  const uniqueIds = new Set(notes.map(n => n.id));
  if (uniqueIds.size !== notes.length) {
    issues.push({
      level: 'error',
      message: `Duplicate note ids detected (${notes.length - uniqueIds.size} duplicates).`,
    });
  }

  return {
    notes,
    report: {
      ok: !issues.some(i => i.level === 'error'),
      noteCount: notes.length,
      uniqueIdCount: uniqueIds.size,
      issues,
    },
  };
}

export function validateExportData(notes: Note[], folders: Folder[]): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  const ids = new Set<string>();

  notes.forEach((note, idx) => {
    for (const key of REQUIRED_NOTE_FIELDS) {
      if (!(key in note)) {
        issues.push({ level: 'error', message: `Export note #${idx + 1} missing ${key}.` });
      }
    }
    if (!note.id || ids.has(note.id)) {
      issues.push({ level: 'error', message: `Export note #${idx + 1} has invalid or duplicate id.` });
    }
    ids.add(note.id);
  });

  const folderIds = new Set(folders.map(f => f.id));
  notes.forEach((note, idx) => {
    if (note.folder && !folderIds.has(note.folder)) {
      issues.push({
        level: 'warning',
        message: `Export note #${idx + 1} references missing folder id "${note.folder}".`,
      });
    }
  });

  return {
    ok: !issues.some(i => i.level === 'error'),
    noteCount: notes.length,
    uniqueIdCount: ids.size,
    issues,
  };
}
