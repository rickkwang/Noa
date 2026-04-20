import { Attachment, Folder, Note } from '../types';
import { storage } from './storage';
import { blobToBase64, type ImportedNote } from './attachmentUtils';

type BackupAttachment = Attachment & { dataBase64: string };

export interface BackupPayload {
  version: 2;
  notes: ImportedNote[];
  folders: Folder[];
  workspaceName: string;
}

function cloneNotesForBackup(notes: Note[]): ImportedNote[] {
  return notes.map((note) => ({
    ...note,
    attachments: note.attachments?.map((attachment) => ({ ...attachment })),
  }));
}

async function hydrateAttachmentPayloads(notes: ImportedNote[]): Promise<ImportedNote[]> {
  return Promise.all(
    notes.map(async (note) => {
      if (!note.attachments?.length) return note;
      const attachments = await Promise.all(
        note.attachments.map(async (attachment) => {
          const blob = await storage.getAttachmentBlob(attachment.id);
          if (!blob) return null;
          const dataBase64 = await blobToBase64(blob);
          return { ...attachment, dataBase64 };
        }),
      );
      return {
        ...note,
        attachments: attachments.filter((att): att is BackupAttachment => att !== null),
      };
    }),
  );
}

/**
 * Build a complete backup payload with all attachment blobs hydrated as base64.
 * Shared between manual JSON export and automatic backup so the two paths
 * cannot diverge in format or content.
 */
export async function buildBackupPayload(
  notes: Note[],
  folders: Folder[],
  workspaceName: string,
): Promise<BackupPayload> {
  return {
    version: 2,
    notes: await hydrateAttachmentPayloads(cloneNotesForBackup(notes)),
    folders,
    workspaceName,
  };
}

/**
 * Write a snapshot JSON file into an already-authorized directory handle.
 * Caller is responsible for permission checks; this function only writes.
 */
export async function writeSnapshotToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  filename: string,
  payload: BackupPayload,
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(payload, null, 2));
  } finally {
    await writable.close();
  }
}


function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHref(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('#')
  ) {
    return escapeHtml(trimmed);
  }
  return '#';
}

// Safe-by-default markdown to HTML transformer.
// It intentionally supports a minimal subset and escapes all raw HTML.
export function mdToHtml(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const inline = (text: string) =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, (_m, label, href) => `<a href="${safeHref(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      return;
    }

    const taskChecked = line.match(/^- \[x\]\s+(.+)$/i);
    const taskUnchecked = line.match(/^- \[ \]\s+(.+)$/);
    const bullet = line.match(/^- (.+)$/);
    if (taskChecked || taskUnchecked || bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      const content = taskChecked?.[1] ?? taskUnchecked?.[1] ?? bullet?.[1] ?? '';
      const prefix = taskChecked ? '✅ ' : taskUnchecked ? '☐ ' : '';
      out.push(`<li>${prefix}${inline(content)}</li>`);
      return;
    }

    closeList();
    if (!line.trim()) {
      out.push('<p></p>');
      return;
    }
    out.push(`<p>${inline(line)}</p>`);
  });

  closeList();
  return out.join('\n');
}

export function exportNoteAsMd(note: Note): void {
  downloadFile(note.content, `${note.title || 'untitled'}.md`, 'text/markdown');
}

export function exportNoteAsHtml(note: Note): void {
  const safeTitle = escapeHtml(note.title || 'Untitled');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #2D2D2D; background: #EAE8E0; line-height: 1.7; }
    h1,h2,h3,h4,h5,h6 { font-weight: bold; margin-top: 1.5em; }
    pre { background: #DCD9CE; padding: 12px; border: 1px solid #2D2D2D; overflow-x: auto; }
    code { background: #DCD9CE; padding: 0 4px; font-family: monospace; color: #B89B5E; }
    a { color: #B89B5E; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p><small>Updated: ${new Date(note.updatedAt).toLocaleString()}</small></p>
  <hr />
  ${mdToHtml(note.content)}
</body>
</html>`;
  downloadFile(html, `${note.title || 'untitled'}.html`, 'text/html');
}
