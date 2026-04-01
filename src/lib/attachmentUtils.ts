import { Attachment, Note } from '../types';

export type ImportedAttachment = Attachment & { dataBase64?: string };
export type ImportedNote = Note & { attachments?: ImportedAttachment[] };

export function inferAttachmentMimeType(file: Pick<File, 'name' | 'type'>): string {
  if (file.type) return file.type;
  const match = file.name.toLowerCase().match(/\.([^.]+)$/);
  const extension = match?.[1] ?? '';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'ico') return 'image/x-icon';
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff';
  return 'application/octet-stream';
}

export function canDecodeBase64(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    if (typeof atob === 'function') {
      atob(trimmed);
      return true;
    }
    if (typeof Buffer !== 'undefined') {
      Buffer.from(trimmed, 'base64');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function findInvalidAttachmentPayload(notes: ImportedNote[]): string | null {
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    const attachments = note.attachments ?? [];
    for (let j = 0; j < attachments.length; j += 1) {
      const attachment = attachments[j];
      if (!attachment.dataBase64) continue;
      if (!canDecodeBase64(attachment.dataBase64)) {
        return `Attachment payload is invalid for note "${note.title || note.id}".`;
      }
    }
  }
  return null;
}

export function mergeAttachmentPayloads(
  normalizedNote: Note,
  rawNote?: ImportedNote,
): ImportedNote {
  if (!normalizedNote.attachments?.length) {
    return normalizedNote as ImportedNote;
  }
  const rawAttachments = rawNote?.attachments ?? [];
  const rawById = new Map(rawAttachments.map((attachment) => [attachment.id, attachment]));
  const attachments = normalizedNote.attachments.map((attachment) => ({
    ...attachment,
    dataBase64: rawById.get(attachment.id)?.dataBase64,
  }));
  return { ...normalizedNote, attachments };
}
