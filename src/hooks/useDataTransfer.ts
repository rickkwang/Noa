import { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import { AppErrorCode, Attachment, Folder, Note, RecoveryAction } from '../types';
import { storage } from '../lib/storage';
import { mdToHtml } from '../lib/export';
import { normalizeAndValidateNotes, validateExportData } from '../lib/dataIntegrity';
import { markExported } from '../lib/exportTimestamp';
import { fromImportError, fromStorageError, fromSyncError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';
import { extractLinks, extractTags } from '../lib/noteUtils';

type ImportedAttachment = Attachment & { dataBase64?: string };
type ImportedNote = Note & { attachments?: ImportedAttachment[] };
type BackupAttachment = Attachment & { dataBase64: string };

interface BackupPayload {
  version: 2;
  notes: ImportedNote[];
  folders: Folder[];
  workspaceName: string;
}

interface ZipManifest extends BackupPayload {}

const TEXT_IMPORT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdown',
  'txt',
  'text',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'ini',
  'toml',
  'log',
]);

const ATTACHMENT_IMPORT_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'ico',
  'tif',
  'tiff',
]);

export interface ConflictSummary {
  sameIdCount: number;
  dupeTitleCount: number;
  newCount: number;
}

export function analyzeConflicts(incoming: Note[], existing: Note[]): ConflictSummary {
  const existingIds = new Set(existing.map(n => n.id));
  const existingTitles = new Set(existing.map(n => n.title));
  let sameIdCount = 0;
  let dupeTitleCount = 0;
  let newCount = 0;
  for (const note of incoming) {
    if (existingIds.has(note.id)) {
      sameIdCount++;
    } else if (existingTitles.has(note.title)) {
      dupeTitleCount++;
    } else {
      newCount++;
    }
  }
  return { sameIdCount, dupeTitleCount, newCount };
}

export function prepareImportedNotes(notes: Note[]): Note[] {
  return notes.map((note) => ({
    ...note,
    tags: extractTags(note.content),
    links: extractLinks(note.content),
  }));
}

export function validateAttachmentPayloads(notes: ImportedNote[]): string | null {
  return findInvalidAttachmentPayload(notes);
}

export function applyImportStrategy(
  incoming: Note[],
  existing: Note[],
  strategy: 'overwrite' | 'merge' | 'skip'
): Note[] {
  if (strategy === 'overwrite') return incoming;
  const existingIds = new Set(existing.map(n => n.id));
  const existingTitles = new Set(existing.map(n => n.title));
  if (strategy === 'skip') {
    const newNotes = incoming.filter(n => !existingIds.has(n.id) && !existingTitles.has(n.title));
    return [...existing, ...newNotes];
  }
  // merge: conflicting notes (same ID) get " (imported)" suffix, new notes appended
  const merged = [...existing];
  const mergedIds = new Set(existing.map(n => n.id));
  const mergedTitles = new Set(existing.map(n => n.title));
  for (const note of incoming) {
    if (mergedIds.has(note.id) || mergedTitles.has(note.title)) {
      const renamed = { ...note, id: crypto.randomUUID(), title: note.title + ' (imported)' };
      merged.push(renamed);
      mergedIds.add(renamed.id);
      mergedTitles.add(renamed.title);
    } else {
      merged.push(note);
      mergedIds.add(note.id);
      mergedTitles.add(note.title);
    }
  }
  return merged;
}

export function countImportedNotes(
  finalNotes: Note[],
  existingNotes: Note[],
  strategy: 'overwrite' | 'merge' | 'skip'
): number {
  if (strategy === 'overwrite') return finalNotes.length;
  return Math.max(0, finalNotes.length - existingNotes.length);
}

export interface DataTransferMessage {
  type: 'success' | 'error';
  text: string;
  code?: AppErrorCode;
  suggestedAction?: RecoveryAction;
}

export interface ConfirmRequest {
  message: string;
  defaultInput?: string;
  inputLabel?: string;
  onConfirm: (inputValue?: string) => void;
  conflictSummary?: ConflictSummary;
  onStrategyChange?: (strategy: 'overwrite' | 'merge' | 'skip') => void;
}

interface UseDataTransferOptions {
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
  onImportData: (notes: ImportedNote[], folders?: Folder[], workspaceName?: string, shouldPrune?: boolean) => Promise<void>;
  onConnectFolder: () => Promise<void>;
  onDisconnectFolder: () => Promise<void>;
  notify: (message: DataTransferMessage) => void;
  requestConfirm: (request: ConfirmRequest) => void;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

function sanitizeFolderPath(path: string): string {
  return path.split('/').map((segment) => sanitizeFilename(segment)).filter(Boolean).join('/');
}

function ensureZipFolder(zip: JSZip, folderPath: string): JSZip {
  return folderPath.split('/').filter(Boolean).reduce<JSZip>((current, segment) => current.folder(sanitizeFilename(segment)) ?? current, zip);
}

function getFileExtension(name: string): string {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] ?? '';
}

export function getFolderImportPath(file: Pick<File, 'webkitRelativePath'>): string {
  const relativePath = (file.webkitRelativePath || '').trim();
  if (!relativePath) return '';
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  if (parts.length === 2) return parts[0];
  return parts.slice(0, -1).join('/');
}

export function classifyFolderImportFile(file: Pick<File, 'name' | 'type'>): { kind: 'text' | 'attachment' | 'unsupported' } {
  const extension = getFileExtension(file.name);
  const mimeType = file.type || '';
  if (
    mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'application/xhtml+xml'
    || TEXT_IMPORT_EXTENSIONS.has(extension)
  ) {
    return { kind: 'text' };
  }
  if (
    mimeType.startsWith('image/')
    || ATTACHMENT_IMPORT_EXTENSIONS.has(extension)
  ) {
    return { kind: 'attachment' };
  }
  return { kind: 'unsupported' };
}

function inferAttachmentMimeType(file: Pick<File, 'name' | 'type'>): string {
  if (file.type) return file.type;
  const extension = getFileExtension(file.name);
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

function isInlinePreviewableMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read attachment blob.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.split(',')[1] ?? '');
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function canDecodeBase64(value: string): boolean {
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

interface VaultScanFile {
  pathSegments: string[];
  file: File;
}

function expandFolderHierarchy(paths: Iterable<string>): string[] {
  const allPaths = new Set<string>();
  for (const path of paths) {
    const segments = sanitizeFolderPath(path).split('/').filter(Boolean);
    if (segments.length === 0) continue;
    const accum: string[] = [];
    for (const segment of segments) {
      accum.push(segment);
      allPaths.add(accum.join('/'));
    }
  }
  return Array.from(allPaths);
}

async function collectVaultDirectoryEntries(
  dirHandle: FileSystemDirectoryHandle,
  relativeSegments: string[] = [],
  folderPaths = new Set<string>(),
  files: VaultScanFile[] = [],
): Promise<{ folderPaths: Set<string>; files: VaultScanFile[] }> {
  const folderPath = sanitizeFolderPath(relativeSegments.join('/'));
  if (folderPath) {
    folderPaths.add(folderPath);
  }

  for await (const [entryName, handle] of dirHandle.entries()) {
    if (entryName === '.obsidian' || entryName === '.DS_Store') continue;
    if (handle.kind === 'directory') {
      await collectVaultDirectoryEntries(
        handle as FileSystemDirectoryHandle,
        [...relativeSegments, entryName],
        folderPaths,
        files,
      );
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    if (file.name === '.DS_Store') continue;
    files.push({ pathSegments: [...relativeSegments, file.name], file });
  }

  return { folderPaths, files };
}

function findInvalidAttachmentPayload(notes: ImportedNote[]): string | null {
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

function mergeAttachmentPayloads(
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

function cloneNotesForBackup(notes: Note[]): ImportedNote[] {
  return notes.map((note) => ({
    ...note,
    attachments: note.attachments?.map((attachment) => ({ ...attachment })),
  }));
}

async function hydrateAttachmentPayloads(notes: ImportedNote[]): Promise<ImportedNote[]> {
  const hydrated = await Promise.all(
    notes.map(async (note) => {
      if (!note.attachments?.length) return note;
      const attachments = await Promise.all(
        note.attachments.map(async (attachment) => {
          const blob = await storage.getAttachmentBlob(attachment.id);
          if (!blob) return null;
          const dataBase64 = await blobToBase64(blob);
          return { ...attachment, dataBase64 };
        })
      );
      return {
        ...note,
        attachments: attachments.filter((att): att is BackupAttachment => att !== null),
      };
    })
  );
  return hydrated;
}

export async function exportJsonSnapshot(notes: Note[], folders: Folder[], workspaceName: string): Promise<boolean> {
  try {
    const report = validateExportData(notes, folders);
    if (!report.ok) return false;
    const payload: BackupPayload = {
      version: 2,
      notes: await hydrateAttachmentPayloads(cloneNotesForBackup(notes)),
      folders,
      workspaceName,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const filename = `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-backup-${new Date().toISOString().split('T')[0]}.json`;
    downloadBlob(blob, filename);
    markExported();
    return true;
  } catch {
    return false;
  }
}

export function useDataTransfer({
  notes,
  folders,
  workspaceName,
  onImportData,
  onConnectFolder,
  onDisconnectFolder,
  notify,
  requestConfirm,
}: UseDataTransferOptions) {
  const [exportingZip, setExportingZip] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);
  const [connectingFs, setConnectingFs] = useState(false);
  const importStrategyRef = useRef<'overwrite' | 'merge' | 'skip'>('overwrite');

  const ensureExportIntegrity = useCallback(() => {
    const report = validateExportData(notes, folders);
    if (!report.ok) {
      const appError = fromImportError('import_integrity_failed', 'Export integrity check failed.');
      recordErrorSnapshot({
        at: new Date().toISOString(),
        operation: 'export_integrity_check',
        code: appError.code,
        message: appError.userMessage,
        suggestedAction: appError.suggestedAction,
      });
      notify({
        type: 'error',
        text: `Export blocked: ${report.issues[0]?.message ?? appError.userMessage}`,
        code: appError.code,
        suggestedAction: appError.suggestedAction,
      });
      return false;
    }
    return true;
  }, [folders, notes, notify]);

  const exportJson = useCallback(() => {
    if (!ensureExportIntegrity()) return;
    void (async () => {
      const ok = await exportJsonSnapshot(notes, folders, workspaceName);
      if (!ok) {
        const appError = fromImportError('unknown_error', 'Export failed. Please retry.');
        recordErrorSnapshot({
          at: new Date().toISOString(),
          operation: 'export_json',
          code: appError.code,
          message: appError.userMessage,
          suggestedAction: appError.suggestedAction,
        });
        notify({
          type: 'error',
          text: appError.userMessage,
          code: appError.code,
          suggestedAction: appError.suggestedAction,
        });
      }
    })();
  }, [ensureExportIntegrity, folders, notes, notify, workspaceName]);

  const exportZip = useCallback(async () => {
    if (!ensureExportIntegrity()) return;
    setExportingZip(true);

    try {
      const zip = new JSZip();
      const manifest: ZipManifest = {
        version: 2,
        notes: cloneNotesForBackup(notes),
        folders,
        workspaceName,
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      zip.file(
        'README.md',
        `# ${workspaceName} Vault\n\nThis archive uses a vault-style folder layout.\n\n- Markdown notes live in the archive root or in folder directories.\n- Attachments live in \`attachments/\`.\n- \`manifest.json\` lets Noa restore note and attachment metadata.\n\nUnzip this archive into a local folder to use it as an Obsidian-style vault.`
      );

      folders.forEach((folder) => {
        const folderNotes = notes.filter((note) => note.folder === folder.id);
        if (folderNotes.length === 0) return;
        const folderZip = ensureZipFolder(zip, folder.name);
        if (!folderZip) return;
        folderNotes.forEach((note) => {
          folderZip.file(`${sanitizeFilename(note.title || 'Untitled')}.md`, note.content);
        });
      });

      notes
        .filter((note) => !note.folder)
        .forEach((note) => {
          zip.file(`${sanitizeFilename(note.title || 'Untitled')}.md`, note.content);
        });

      // Export attachments
      const attachmentsZip = zip.folder('attachments');
      if (attachmentsZip) {
        const allAttachments = notes.flatMap((n) => n.attachments ?? []);
        await Promise.all(
          allAttachments.map(async (att) => {
            const blob = await storage.getAttachmentBlob(att.id);
            if (blob) {
              const attFolder = attachmentsZip.folder(att.id);
              attFolder?.file(att.filename, blob);
            }
          })
        );
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-vault.zip`);
      markExported();
    } finally {
      setExportingZip(false);
    }
  }, [ensureExportIntegrity, folders, notes, workspaceName]);

  const exportHtmlZip = useCallback(async () => {
    if (!ensureExportIntegrity()) return;
    setExportingHtml(true);

    try {
      const zip = new JSZip();
      const htmlFolder = zip.folder('html-export');

      if (htmlFolder) {
        notes.forEach((note) => {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${note.title}</title>
</head>
<body>
  <h1>${note.title}</h1>
  <p><small>Updated: ${new Date(note.updatedAt).toLocaleString()}</small></p>
  <hr />
  ${mdToHtml(note.content)}
</body>
</html>`;
          htmlFolder.file(`${sanitizeFilename(note.title || 'Untitled')}.html`, html);
        });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-html-export.zip`);
    } finally {
      setExportingHtml(false);
    }
  }, [ensureExportIntegrity, notes, workspaceName]);

  const importJsonFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (!parsed.notes || !Array.isArray(parsed.notes)) {
            const appError = fromImportError('import_invalid_json', 'Invalid backup file.');
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'import_json',
              code: appError.code,
              message: appError.userMessage,
              suggestedAction: appError.suggestedAction,
            });
            notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
            return;
          }

          const rawNotes = parsed.notes as ImportedNote[];
          const { notes: normalizedNotes, report } = normalizeAndValidateNotes(rawNotes);
          if (!report.ok) {
            const appError = fromImportError('import_integrity_failed', 'Import integrity check failed.');
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'import_json',
              code: appError.code,
              message: appError.userMessage,
              suggestedAction: appError.suggestedAction,
            });
            notify({
              type: 'error',
              text:
                report.issues.find((issue) => issue.level === 'error')?.message ||
                appError.userMessage,
              code: appError.code,
              suggestedAction: appError.suggestedAction,
            });
            return;
          }

          const rawById = new Map(rawNotes.map((note) => [note.id, note]));
          const normalizedWithPayloads: ImportedNote[] = prepareImportedNotes(normalizedNotes.map((note) => {
            const merged = mergeAttachmentPayloads(note, rawById.get(note.id));
            return merged;
          }));
          const attachmentError = validateAttachmentPayloads(normalizedWithPayloads);
          if (attachmentError) {
            const appError: { code: AppErrorCode; userMessage: string; suggestedAction: RecoveryAction } = {
              code: 'import_integrity_failed',
              userMessage: attachmentError,
              suggestedAction: 'import_backup',
            };
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'import_json',
              code: appError.code,
              message: attachmentError,
              suggestedAction: appError.suggestedAction,
            });
            notify({ type: 'error', text: attachmentError, code: appError.code, suggestedAction: appError.suggestedAction });
            return;
          }

          const conflictSummary = analyzeConflicts(normalizedWithPayloads, notes);
          importStrategyRef.current = 'overwrite';

          requestConfirm({
            message: `This may replace existing data (${notes.length} note(s), ${folders.length} folder(s)). Continue?`,
            conflictSummary,
            onStrategyChange: (s) => { importStrategyRef.current = s; },
            onConfirm: async () => {
              const finalNotes = applyImportStrategy(normalizedWithPayloads, notes, importStrategyRef.current);
              const warningCount = report.issues.filter((issue) => issue.level === 'warning').length;
              const importedCount = countImportedNotes(finalNotes, notes, importStrategyRef.current);
              try {
                await onImportData(
                  finalNotes as ImportedNote[],
                  parsed.folders || [],
                  parsed.workspaceName || 'Imported Workspace',
                  importStrategyRef.current === 'overwrite',
                );
                notify({
                  type: 'success',
                  text: `Imported ${importedCount} notes${
                    warningCount ? ` with ${warningCount} warning(s)` : ''
                  }.`,
                });
              } catch (error) {
                const appError = fromStorageError(error);
                recordErrorSnapshot({
                  at: new Date().toISOString(),
                  operation: 'import_json',
                  code: appError.code,
                  message: error instanceof Error ? error.message : appError.userMessage,
                  suggestedAction: appError.suggestedAction,
                });
                notify({
                  type: 'error',
                  text: appError.userMessage,
                  code: appError.code,
                  suggestedAction: appError.suggestedAction,
                });
              }
            },
          });
        } catch (error) {
          const appError = fromImportError('import_invalid_json', 'Error parsing backup file.');
          recordErrorSnapshot({
            at: new Date().toISOString(),
            operation: 'import_json',
            code: appError.code,
            message: error instanceof Error ? error.message : appError.userMessage,
            suggestedAction: appError.suggestedAction,
          });
          notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
        }
      };
      reader.readAsText(file);
    },
    [notes, folders, notify, onImportData, requestConfirm],
  );

  const importVaultFolder = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      notify({
        type: 'error',
        text: 'Vault migration requires directory picker support in this environment.',
      });
      return;
    }

    try {
      const rootHandle = await window.showDirectoryPicker({ mode: 'read' });
      const workspaceLabel = rootHandle.name || 'Imported Vault';
      const { folderPaths, files } = await collectVaultDirectoryEntries(rootHandle, rootHandle.name ? [rootHandle.name] : []);
      const sortedFolderPaths = expandFolderHierarchy(folderPaths).sort((a, b) => {
        const depthDiff = a.split('/').length - b.split('/').length;
        return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
      });
      const newFolders = sortedFolderPaths.map((name) => ({ id: crypto.randomUUID(), name }));
      const folderIdByPath = new Map(newFolders.map((folder) => [folder.name, folder.id]));
      const newNotes: ImportedNote[] = [];

      for (const entry of files) {
        if (entry.pathSegments.some((segment) => segment === '.obsidian')) continue;
        const file = entry.file;
        const folderPath = sanitizeFolderPath(entry.pathSegments.slice(0, -1).join('/'));
        const folderId = folderPath ? folderIdByPath.get(folderPath) ?? '' : '';
        const classification = classifyFolderImportFile(file);
        if (classification.kind === 'unsupported') continue;

        if (classification.kind === 'text') {
          const content = await file.text();
          newNotes.push({
            id: crypto.randomUUID(),
            title: file.name.replace(/\.[^/.]+$/, ''),
            content,
            createdAt: new Date(file.lastModified || Date.now()).toISOString(),
            updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
            folder: folderId,
            tags: extractTags(content),
            links: extractLinks(content),
          });
        } else {
          const noteId = crypto.randomUUID();
          const attachmentId = crypto.randomUUID();
          const mimeType = inferAttachmentMimeType(file);
          const attachment: Attachment = {
            id: attachmentId,
            noteId,
            filename: file.name,
            mimeType,
            size: file.size,
            createdAt: new Date(file.lastModified || Date.now()).toISOString(),
            vaultPath: `attachments/${noteId}/${attachmentId}-${file.name}`,
          };
          newNotes.push({
            id: noteId,
            title: file.name.replace(/\.[^/.]+$/, ''),
            content: isInlinePreviewableMimeType(mimeType)
              ? `![[attachments/${noteId}/${attachmentId}-${file.name}]]`
              : `Attached file: ${file.name}`,
            createdAt: new Date(file.lastModified || Date.now()).toISOString(),
            updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
            folder: folderId,
            tags: [],
            links: [],
            attachments: [attachment],
          });
        }
      }

      const { notes: validatedNotes, report } = normalizeAndValidateNotes(newNotes);
      if (!report.ok) {
        const appError = fromImportError('import_integrity_failed', 'Vault migration integrity check failed.');
        notify({
          type: 'error',
          text: report.issues.find((issue) => issue.level === 'error')?.message ?? appError.userMessage,
          code: appError.code,
          suggestedAction: appError.suggestedAction,
        });
        return;
      }

      requestConfirm({
        message: `Importing "${workspaceLabel}" will replace current data (${notes.length} note(s), ${folders.length} folder(s)). Continue?`,
        onConfirm: async () => {
          try {
            await onImportData(validatedNotes as ImportedNote[], newFolders, workspaceLabel, true);
            notify({
              type: 'success',
              text: `Migrated ${validatedNotes.length} note(s) and ${newFolders.length} folder(s) from "${workspaceLabel}".`,
            });
          } catch (error) {
            const appError = fromStorageError(error);
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'import_vault',
              code: appError.code,
              message: error instanceof Error ? error.message : appError.userMessage,
              suggestedAction: appError.suggestedAction,
            });
            notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
          }
        },
      });
    } catch (error) {
      const appError = fromStorageError(error);
      recordErrorSnapshot({
        at: new Date().toISOString(),
        operation: 'import_vault',
        code: appError.code,
        message: error instanceof Error ? error.message : appError.userMessage,
        suggestedAction: appError.suggestedAction,
      });
      notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
    }
  }, [folders, notes, notify, onImportData, requestConfirm]);

  const importFolderFiles = useCallback(
    (files: FileList) => {
      const doImport = async () => {
        const newNotes: Note[] = [];
        const newFolders: Folder[] = [];
        const stagedAttachments: Array<{ attachmentId: string; blob: Blob }> = [];
        let newWorkspaceName = 'Imported Folder';

        if (files[0]?.webkitRelativePath) {
          newWorkspaceName = files[0].webkitRelativePath.split('/')[0];
        }

        const getOrCreateFolder = (folderName: string) => {
          const normalized = sanitizeFolderPath(folderName);
          const segments = normalized.split('/').filter(Boolean);
          if (segments.length === 0) {
            return null;
          }

          let currentPath = '';
          let currentFolder = null as Folder | null;
          for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = newFolders.find((f) => f.name === currentPath);
            if (existing) {
              currentFolder = existing;
              continue;
            }
            currentFolder = { id: crypto.randomUUID(), name: currentPath };
            newFolders.push(currentFolder);
          }
          return currentFolder;
        };

        const addTextNote = async (file: File, folderId: string) => {
          const content = await file.text();
          newNotes.push({
            id: crypto.randomUUID(),
            title: file.name.replace(/\.[^/.]+$/, ''),
            content,
            createdAt: new Date().toISOString(),
            updatedAt: new Date(file.lastModified).toISOString(),
            folder: folderId,
            tags: extractTags(content),
            links: extractLinks(content),
          });
        };

        const addAttachmentNote = (file: File, folderId: string) => {
          const noteId = crypto.randomUUID();
          const attachmentId = crypto.randomUUID();
          const mimeType = inferAttachmentMimeType(file);
          const attachment: Attachment = {
            id: attachmentId,
            noteId,
            filename: file.name,
            mimeType,
            size: file.size,
            createdAt: new Date().toISOString(),
            vaultPath: `attachments/${noteId}/${attachmentId}-${file.name}`,
          };
          newNotes.push({
            id: noteId,
            title: file.name.replace(/\.[^/.]+$/, ''),
            content: isInlinePreviewableMimeType(mimeType) ? `![[attachments/${noteId}/${attachmentId}-${file.name}]]` : `Attached file: ${file.name}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date(file.lastModified).toISOString(),
            folder: folderId,
            tags: [],
            links: [],
            attachments: [attachment],
          });
          stagedAttachments.push({ attachmentId, blob: file });
        };

        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const classification = classifyFolderImportFile(file);
          if (classification.kind === 'unsupported') continue;

          const folderPath = getFolderImportPath(file);
          const folderId = folderPath ? (getOrCreateFolder(folderPath)?.id ?? '') : '';
          if (classification.kind === 'text') {
            await addTextNote(file, folderId);
          } else {
            addAttachmentNote(file, folderId);
          }
        }

        if (newNotes.length === 0) {
          const appError = fromImportError('import_integrity_failed', 'No supported files found.');
          notify({ type: 'error', text: 'No supported files found in the selected folder.', code: appError.code, suggestedAction: appError.suggestedAction });
          return;
        }

        const { notes: validatedNotes, report } = normalizeAndValidateNotes(newNotes);
        if (!report.ok) {
          const appError = fromImportError('import_integrity_failed', 'Folder import integrity check failed.');
          notify({ type: 'error', text: report.issues.find(i => i.level === 'error')?.message ?? appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
          return;
        }

        const attachmentResults = await Promise.allSettled(
          stagedAttachments.map(async ({ attachmentId, blob }) => {
            await storage.saveAttachmentBlob(attachmentId, blob);
          })
        );
        if (attachmentResults.some((result) => result.status === 'rejected')) {
          await Promise.allSettled(
            stagedAttachments.map(async ({ attachmentId }) => {
              await storage.deleteAttachmentBlob(attachmentId);
            })
          );
          notify({ type: 'error', text: 'Failed to save one or more imported attachments.' });
          return;
        }

        try {
          await onImportData(validatedNotes, newFolders, newWorkspaceName, true);
        } catch (error) {
          await Promise.allSettled(
            stagedAttachments.map(async ({ attachmentId }) => {
              await storage.deleteAttachmentBlob(attachmentId);
            })
          );
          throw error;
        }
        notify({
          type: 'success',
          text: `Imported ${validatedNotes.length} item(s) from "${newWorkspaceName}".`,
        });
      };

      requestConfirm({
        message: `Importing a folder will replace current data (${notes.length} note(s), ${folders.length} folder(s)). Continue?`,
        onConfirm: async () => {
          try {
            await doImport();
          } catch (error) {
            const appError = fromStorageError(error);
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'import_folder',
              code: appError.code,
              message: error instanceof Error ? error.message : appError.userMessage,
              suggestedAction: appError.suggestedAction,
            });
            notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
          }
        },
      });
    },
    [notes, folders, notify, onImportData, requestConfirm],
  );

  const createNewWorkspace = useCallback(() => {
      requestConfirm({
        message:
          `Create a new workspace? This will clear current data (${notes.length} note(s), ${folders.length} folder(s)). Export backup first.`,
        defaultInput: 'New Workspace',
        inputLabel: 'Workspace name:',
        onConfirm: async (nameValue) => {
          const value = (nameValue || '').trim() || 'New Workspace';
          try {
            await onImportData([], [], value, true);
            notify({ type: 'success', text: `Workspace switched to "${value}".` });
          } catch (error) {
            const appError = fromStorageError(error);
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'create_workspace',
              code: appError.code,
              message: error instanceof Error ? error.message : appError.userMessage,
              suggestedAction: appError.suggestedAction,
            });
            notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
          }
        },
      });
    }, [notes, folders, notify, onImportData, requestConfirm]);

  const importZip = useCallback(
    (file: File) => {
      const doImport = async () => {
        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(file);
        } catch {
          const appError = fromImportError('import_invalid_json', 'Invalid or corrupt ZIP file.');
          notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
          return;
        }

        const manifestFile = zip.file('manifest.json');
        let validatedNotes: Note[] = [];
        let newFolders: Folder[] = [];
        let workspaceLabel = file.name.replace(/\.zip$/i, '');
        let attachmentNoteLookup: ImportedNote[] | null = null;

        if (manifestFile) {
          try {
            const manifest = JSON.parse(await manifestFile.async('string')) as Partial<ZipManifest>;
            const rawNotes = Array.isArray(manifest.notes) ? manifest.notes : [];
            const { notes: normalizedNotes, report } = normalizeAndValidateNotes(rawNotes);
            if (!report.ok) {
              const appError = fromImportError('import_integrity_failed', 'ZIP manifest integrity check failed.');
              notify({ type: 'error', text: report.issues.find(i => i.level === 'error')?.message ?? appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
              return;
            }
            const manifestWithPayloads = prepareImportedNotes(normalizedNotes);
            const attachmentError = validateAttachmentPayloads(rawNotes as ImportedNote[]);
            if (attachmentError) {
              const appError = fromImportError('import_integrity_failed', attachmentError);
              notify({ type: 'error', text: attachmentError, code: appError.code, suggestedAction: appError.suggestedAction });
              return;
            }
            validatedNotes = manifestWithPayloads;
            newFolders = Array.isArray(manifest.folders) ? manifest.folders : [];
            workspaceLabel = manifest.workspaceName || workspaceLabel;
            attachmentNoteLookup = rawNotes as ImportedNote[];
          } catch {
            // Fall back to legacy ZIP parsing below.
          }
        }

        if (validatedNotes.length === 0) {
          const newNotes: Note[] = [];
          newFolders = [];
        const noteFiles = Object.entries(zip.files).filter(
          ([path, f]) => !f.dir && path.endsWith('.md') && path !== 'README.md'
        );

        for (const [path, zipFile] of noteFiles) {
          const parts = path.split('/');
          let folderId = '';
          if (parts.length >= 2) {
            const folderName = parts.slice(0, -1).join('/');
            if (folderName && folderName !== 'attachments') {
              let folder = newFolders.find((f) => f.name === folderName);
              if (!folder) {
                folder = { id: crypto.randomUUID(), name: folderName };
                newFolders.push(folder);
              }
              folderId = folder.id;
            }
          }
          const content = await zipFile.async('string');
          const filename = parts[parts.length - 1];
          newNotes.push({
            id: crypto.randomUUID(),
              title: filename.replace(/\.md$/, ''),
              content,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              folder: folderId,
              tags: extractTags(content),
              links: extractLinks(content),
            });
          }

          if (newNotes.length === 0) {
            const appError = fromImportError('import_integrity_failed', 'No Markdown files found in ZIP.');
            notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
            return;
          }

          const legacyReport = normalizeAndValidateNotes(newNotes);
          if (!legacyReport.report.ok) {
            const appError = fromImportError('import_integrity_failed', 'ZIP import integrity check failed.');
            notify({ type: 'error', text: legacyReport.report.issues.find(i => i.level === 'error')?.message ?? appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
            return;
          }
          validatedNotes = legacyReport.notes;
          attachmentNoteLookup = newNotes as ImportedNote[];
        }

        // 恢复附件
        const attachmentFiles = Object.entries(zip.files).filter(
          ([path]) => path.startsWith('attachments/') && !path.endsWith('/')
        );
        const stagedAttachments: Array<{ attachmentId: string; blob: Blob }> = [];
        if (attachmentFiles.length > 0) {
          for (const [path, zipFile] of attachmentFiles) {
            const parts = path.split('/');
            if (parts.length < 3) continue;
            const attachmentId = parts[2].split('-')[0] || parts[1];
            const filename = parts.slice(2).join('-').replace(`${attachmentId}-`, '') || parts[parts.length - 1];
            try {
              const blob = await zipFile.async('blob');
              stagedAttachments.push({ attachmentId, blob });
              const mimeType = inferAttachmentMimeType({ name: filename, type: '' });
              const noteMatch = attachmentNoteLookup?.find((note) =>
                (note.attachments ?? []).some((attachment) => attachment.id === attachmentId)
              );
              if (noteMatch) {
                const note = validatedNotes.find((candidate) => candidate.id === noteMatch.id);
                if (note) {
                  const attachment = noteMatch.attachments?.find((candidate) => candidate.id === attachmentId);
                  if (attachment) {
                    note.attachments = [...(note.attachments ?? []), {
                      id: attachmentId,
                      noteId: note.id,
                      filename: attachment.filename || filename,
                      mimeType: attachment.mimeType || mimeType,
                      size: blob.size,
                      createdAt: attachment.createdAt || new Date().toISOString(),
                      vaultPath: attachment.vaultPath || `attachments/${note.id}/${attachmentId}-${attachment.filename || filename}`,
                    }];
                  }
                }
              } else {
                for (const note of validatedNotes) {
                  if (note.content.includes(`![[${filename}]]`) || note.content.includes(`[[${filename}]]`)) {
                    const attachment: Attachment = {
                      id: attachmentId,
                      noteId: note.id,
                      filename,
                      mimeType,
                      size: blob.size,
                      createdAt: new Date().toISOString(),
                      vaultPath: `attachments/${note.id}/${attachmentId}-${filename}`,
                    };
                    note.attachments = [...(note.attachments ?? []), attachment];
                  }
                }
              }
            } catch {
              // 单个附件失败不阻塞整体导入
            }
          }
        }

        const attachmentResults = await Promise.allSettled(
          stagedAttachments.map(async ({ attachmentId, blob }) => {
            await storage.saveAttachmentBlob(attachmentId, blob);
          })
        );
        if (attachmentResults.some((result) => result.status === 'rejected')) {
          await Promise.allSettled(
            stagedAttachments.map(async ({ attachmentId }) => {
              await storage.deleteAttachmentBlob(attachmentId);
            })
          );
          notify({ type: 'error', text: 'Failed to save one or more imported ZIP attachments.' });
          return;
        }

        try {
          await onImportData(validatedNotes as ImportedNote[], newFolders, workspaceLabel, true);
        } catch (error) {
          await Promise.allSettled(
            stagedAttachments.map(async ({ attachmentId }) => {
              await storage.deleteAttachmentBlob(attachmentId);
            })
          );
          throw error;
        }
        notify({
          type: 'success',
          text: `Imported ${validatedNotes.length} note(s) from ZIP${attachmentFiles.length > 0 ? ` and ${attachmentFiles.length} attachment(s)` : ''}.`,
        });
      };

      requestConfirm({
        message: `Importing this ZIP will replace current data (${notes.length} note(s), ${folders.length} folder(s)). Continue?`,
        onConfirm: async () => {
          try {
            await doImport();
          } catch (error) {
            const appError = fromStorageError(error);
            recordErrorSnapshot({
              at: new Date().toISOString(),
              operation: 'import_zip',
              code: appError.code,
              message: error instanceof Error ? error.message : appError.userMessage,
              suggestedAction: appError.suggestedAction,
            });
            notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
          }
        },
      });
    },
    [notes, folders, notify, onImportData, requestConfirm],
  );

  const connectFolder = useCallback(async () => {
    setConnectingFs(true);
    try {
      await onConnectFolder();
      notify({
        type: 'success',
        text: 'Connected to local folder. Notes will sync automatically.',
      });
    } catch (error) {
      const appError = fromSyncError(error);
      recordErrorSnapshot({
        at: new Date().toISOString(),
        operation: 'connect_folder',
        code: appError.code,
        message: appError.rawMessage || appError.userMessage,
        suggestedAction: appError.suggestedAction,
      });
      notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
    } finally {
      setConnectingFs(false);
    }
  }, [notify, onConnectFolder]);

  const disconnectFolder = useCallback(async () => {
    try {
      await onDisconnectFolder();
      notify({ type: 'success', text: 'Disconnected from local folder. Using IndexedDB.' });
    } catch (error) {
      const appError = fromStorageError(error);
      recordErrorSnapshot({
        at: new Date().toISOString(),
        operation: 'disconnect_folder',
        code: appError.code,
        message: appError.rawMessage || appError.userMessage,
        suggestedAction: appError.suggestedAction,
      });
      notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
    }
  }, [notify, onDisconnectFolder]);

  return {
    exportingZip,
    exportingHtml,
    connectingFs,
    exportJson,
    exportZip,
    exportHtmlZip,
    importJsonFile,
    importVaultFolder,
    importFolderFiles,
    createNewWorkspace,
    connectFolder,
    disconnectFolder,
  };
}
