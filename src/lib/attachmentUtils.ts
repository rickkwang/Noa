import { Attachment, Note } from '../types';
import { decodeLinkPath } from './noteUtils';

type ImportedAttachment = Attachment & { dataBase64?: string };
export type ImportedNote = Note & { attachments?: ImportedAttachment[] };

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(''));
}

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

export function mapAttachmentReferences(content: string, resolve: (target: string, wiki: boolean) => string | undefined): string {
  return content.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|``[^`]*``|`[^`\n]*`)/g)
    .map((part, index) => index % 2 ? part : part
      .replace(/(!?\[\[)(.*?)(\]\])/g, (match, open, raw: string, close) => {
        const boundary = raw.search(/\\?\|/);
        const target = (boundary < 0 ? raw : raw.slice(0, boundary)).trim();
        const mapped = resolve(target, true);
        return mapped === undefined ? match : `${open}${mapped}${boundary < 0 ? '' : raw.slice(boundary)}${close}`;
      })
      .replace(/(!\[[^\]]*\]\()(<[^>]*>|[^\s)]+)([^)]*\))/g, (match, open, target: string, suffix) => {
        const mapped = resolve(decodeLinkPath(target.replace(/^<|>$/g, '')), false);
        return mapped === undefined ? match : `${open}<${mapped.replace(/>/g, '%3E')}>${suffix}`;
      }))
    .join('');
}

export function resolveAttachmentPath(target: string, notePath: string, paths: ReadonlySet<string>): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return undefined;
  const relative = decodeLinkPath(new URL(target, `https://vault.invalid/${notePath.split('/').map(encodeURIComponent).join('/')}`).pathname.slice(1));
  if (paths.has(relative)) return relative;
  if (paths.has(target)) return target;
  if (target.includes('/')) return undefined;
  const matches = [...paths].filter(path => path.split('/').pop() === target);
  return matches.length === 1 ? matches[0] : undefined;
}
