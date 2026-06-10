import { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import { AppErrorCode, Attachment, Folder, Note, RecoveryAction } from '../types';
import { storage } from '../lib/storage';
import { mdToHtml, buildBackupPayload } from '../lib/export';
import { normalizeAndValidateNotes, validateExportData } from '../lib/dataIntegrity';
import { markExported } from '../lib/exportTimestamp';
import { fromImportError, fromStorageError, fromSyncError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';
import { extractLinks, extractTags } from '../lib/noteUtils';
import { extractObsidianCreatedAt, extractObsidianTags } from '../lib/frontmatter';

/** For Obsidian imports: use frontmatter tags if present, fall back to body #hashtags. */
function resolveImportTags(content: string): string[] {
  const fm = extractObsidianTags(content);
  return fm.length > 0 ? fm : extractTags(content);
}
import {
  inferAttachmentMimeType,
  mergeAttachmentPayloads,
  type ImportedNote,
} from '../lib/attachmentUtils';
import {
  analyzeConflicts,
  applyImportStrategy,
  classifyFolderImportFile,
  countImportedNotes,
  getFolderImportPath,
  mergeImportedWorkspaceData,
  parseZipAttachmentPath,
  prepareImportedNotes,
  resolveImportedFolders,
  resolveImportedWorkspaceName,
  sanitizeFilename,
  sanitizeFolderPath,
  uniqueExportFilename,
  validateAttachmentPayloads,
  zipAttachmentPath,
  type ConflictSummary,
} from '../lib/importUtils';

export type { ConflictSummary };
export { analyzeConflicts, applyImportStrategy, buildVaultImportPayload, classifyFolderImportFile, countImportedNotes, getFolderImportPath, parseZipAttachmentPath, prepareImportedNotes, resolveImportedFolders, resolveImportedWorkspaceName, uniqueExportFilename, validateAttachmentPayloads, zipAttachmentPath };

type BackupAttachment = Attachment & { dataBase64: string };

interface BackupPayload {
  version: 2;
  notes: ImportedNote[];
  folders: Folder[];
  workspaceName: string;
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

function ensureZipFolder(zip: JSZip, folderPath: string): JSZip {
  return folderPath.split('/').filter(Boolean).reduce<JSZip>((current, segment) => current.folder(sanitizeFilename(segment)) ?? current, zip);
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface VaultScanFile {
  pathSegments: string[];
  file: File;
}

interface VaultNoteDraft {
  note: ImportedNote;
  vaultFolderPath: string;
}

interface VaultAttachmentCandidate {
  file: Blob;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  folderId: string;
  vaultRelativePath: string;
  vaultFolderPath: string;
}

interface StagedAttachment {
  attachmentId: string;
  blob: Blob;
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

const MAX_VAULT_SCAN_DEPTH = 50;

async function collectVaultDirectoryEntries(
  dirHandle: FileSystemDirectoryHandle,
  relativeSegments: string[] = [],
  folderPaths = new Set<string>(),
  files: VaultScanFile[] = [],
  depth = 0,
): Promise<{ folderPaths: Set<string>; files: VaultScanFile[] }> {
  if (depth > MAX_VAULT_SCAN_DEPTH) {
    console.warn(`[Noa] Vault folder nesting exceeded ${MAX_VAULT_SCAN_DEPTH} levels at "${relativeSegments.join('/')}", skipping subtree.`);
    return { folderPaths, files };
  }

  const folderPath = sanitizeFolderPath(relativeSegments.join('/'));
  if (folderPath) {
    folderPaths.add(folderPath);
  }

  for await (const [entryName, handle] of dirHandle.entries()) {
    const isVaultRootArtifact = relativeSegments.length <= 1 && (entryName === 'manifest.json' || entryName === 'README.md');
    if (entryName === '.obsidian' || entryName === '.DS_Store' || isVaultRootArtifact) continue;
    if (handle.kind === 'directory') {
      await collectVaultDirectoryEntries(
        handle as FileSystemDirectoryHandle,
        [...relativeSegments, entryName],
        folderPaths,
        files,
        depth + 1,
      );
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    if (file.name === '.DS_Store') continue;
    files.push({ pathSegments: [...relativeSegments, file.name], file });
  }

  return { folderPaths, files };
}

function cloneNotesForBackup(notes: Note[]): ImportedNote[] {
  return notes.map((note) => ({
    ...note,
    attachments: note.attachments?.map((attachment) => ({ ...attachment })),
  }));
}

function normalizeVaultRelativePath(pathSegments: string[]): string {
  return sanitizeFolderPath(pathSegments.join('/'));
}

function relativePathFromFolder(folderPath: string, filePath: string): string {
  const from = folderPath.split('/').filter(Boolean);
  const target = filePath.split('/').filter(Boolean);
  let commonIdx = 0;
  while (commonIdx < from.length && commonIdx < target.length - 1 && from[commonIdx] === target[commonIdx]) {
    commonIdx += 1;
  }
  const up = Array.from({ length: from.length - commonIdx }, () => '..');
  const down = target.slice(commonIdx);
  return [...up, ...down].join('/');
}

function attachmentReferenceCandidates(vaultFilePath: string, vaultFolderPath: string): string[] {
  const relativeFromFolder = relativePathFromFolder(vaultFolderPath, vaultFilePath);
  return Array.from(new Set([
    vaultFilePath,
    relativeFromFolder,
    relativeFromFolder && !relativeFromFolder.startsWith('../') ? `./${relativeFromFolder}` : '',
  ].filter(Boolean)));
}

function matchingAttachmentReference(
  note: Pick<ImportedNote, 'links'>,
  vaultFolderPath: string,
  vaultFilePath: string,
  allowBasenameMatch: boolean,
): string | null {
  const links = new Set(note.links ?? []);
  const pathMatch = attachmentReferenceCandidates(vaultFilePath, vaultFolderPath).find((candidate) => links.has(candidate));
  if (pathMatch) return pathMatch;
  if (!allowBasenameMatch) return null;
  const basename = vaultFilePath.split('/').pop() ?? vaultFilePath;
  return links.has(basename) ? basename : null;
}

function createImportedAttachment(
  noteId: string,
  attachmentId: string,
  filename: string,
  mimeType: string,
  size: number,
  createdAt: string,
  vaultPath: string,
): Attachment {
  return {
    id: attachmentId,
    noteId,
    filename,
    mimeType,
    size,
    createdAt,
    vaultPath,
  };
}

async function buildVaultImportPayload(
  files: VaultScanFile[],
  folderIdByPath: Map<string, string>,
): Promise<{ notes: ImportedNote[]; stagedAttachments: StagedAttachment[] }> {
  const noteDrafts: VaultNoteDraft[] = [];
  const attachmentCandidates: VaultAttachmentCandidate[] = [];
  const stagedAttachments: StagedAttachment[] = [];

  for (const entry of files) {
    if (entry.pathSegments.some((segment) => segment === '.obsidian')) continue;
    const file = entry.file;
    const fullFolderPath = sanitizeFolderPath(entry.pathSegments.slice(0, -1).join('/'));
    const folderId = fullFolderPath ? folderIdByPath.get(fullFolderPath) ?? '' : '';
    const relativeSegments = entry.pathSegments.slice(1);
    const vaultRelativePath = normalizeVaultRelativePath(relativeSegments);
    const vaultFolderPath = normalizeVaultRelativePath(relativeSegments.slice(0, -1));
    const classification = classifyFolderImportFile(file);
    if (classification.kind === 'unsupported') continue;

    if (classification.kind === 'text') {
      let content = '';
      try {
        content = await file.text();
      } catch {
        continue;
      }
      const fallbackTs = new Date(file.lastModified || Date.now()).toISOString();
      noteDrafts.push({
        vaultFolderPath,
        note: {
          id: crypto.randomUUID(),
          title: file.name.replace(/\.[^/.]+$/, ''),
          content,
          createdAt: extractObsidianCreatedAt(content) ?? fallbackTs,
          updatedAt: fallbackTs,
          folder: folderId,
          tags: resolveImportTags(content),
          links: extractLinks(content),
          linkRefs: [],
          source: 'obsidian-import',
        },
      });
      continue;
    }

    attachmentCandidates.push({
      file,
      filename: file.name,
      mimeType: inferAttachmentMimeType(file),
      size: file.size,
      createdAt: new Date(file.lastModified || Date.now()).toISOString(),
      folderId,
      vaultRelativePath,
      vaultFolderPath,
    });
  }

  const basenameCounts = attachmentCandidates.reduce((counts, candidate) => {
    counts.set(candidate.filename, (counts.get(candidate.filename) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  for (const candidate of attachmentCandidates) {
    const matches = noteDrafts
      .map((draft) => ({
        draft,
        matchedRef: matchingAttachmentReference(
          draft.note,
          draft.vaultFolderPath,
          candidate.vaultRelativePath,
          (basenameCounts.get(candidate.filename) ?? 0) === 1,
        ),
      }))
      .filter((item): item is { draft: VaultNoteDraft; matchedRef: string } => Boolean(item.matchedRef));

    if (matches.length === 0) {
      const noteId = crypto.randomUUID();
      const attachmentId = crypto.randomUUID();
      const attachment = createImportedAttachment(
        noteId,
        attachmentId,
        candidate.filename,
        candidate.mimeType,
        candidate.size,
        candidate.createdAt,
        candidate.vaultRelativePath,
      );
      noteDrafts.push({
        vaultFolderPath: candidate.vaultFolderPath,
        note: {
          id: noteId,
          title: candidate.filename.replace(/\.[^/.]+$/, ''),
          content: isInlinePreviewableMimeType(candidate.mimeType)
            ? `![[${candidate.vaultRelativePath}]]`
            : `Attached file: ${candidate.filename}`,
          createdAt: candidate.createdAt,
          updatedAt: candidate.createdAt,
          folder: candidate.folderId,
          tags: [],
          links: [],
          linkRefs: [],
          source: 'obsidian-import',
          attachments: [attachment],
        },
      });
      stagedAttachments.push({ attachmentId, blob: candidate.file });
      continue;
    }

    for (const { draft, matchedRef } of matches) {
      const attachmentId = crypto.randomUUID();
      const attachment = createImportedAttachment(
        draft.note.id,
        attachmentId,
        candidate.filename,
        candidate.mimeType,
        candidate.size,
        candidate.createdAt,
        matchedRef,
      );
      draft.note.attachments = [...(draft.note.attachments ?? []), attachment];
      stagedAttachments.push({ attachmentId, blob: candidate.file });
    }
  }

  return { notes: noteDrafts.map((draft) => draft.note), stagedAttachments };
}

export async function exportJsonSnapshot(notes: Note[], folders: Folder[], workspaceName: string): Promise<boolean> {
  try {
    const report = validateExportData(notes, folders);
    if (!report.ok) return false;
    const payload = await buildBackupPayload(notes, folders, workspaceName);
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
  const [importingData, setImportingData] = useState(false);
  const [importStatusText, setImportStatusText] = useState<string | null>(null);
  const importStrategyRef = useRef<'overwrite' | 'merge' | 'skip'>('overwrite');

  // Wrap onImportData to track loading state
  const trackedImportData: typeof onImportData = useCallback(async (...args) => {
    setImportingData(true);
    setImportStatusText('Saving imported data...');
    try {
      await onImportData(...args);
    } finally {
      setImportingData(false);
      setImportStatusText(null);
    }
  }, [onImportData]);

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
      const manifest: BackupPayload = {
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

      // Used filenames per archive directory — duplicate titles must not
      // overwrite each other's entries (keyed by folder path so two folder
      // records sharing a name still land in one namespace).
      const usedNamesByDir = new Map<string, Set<string>>();
      const usedNamesFor = (dirKey: string): Set<string> => {
        let used = usedNamesByDir.get(dirKey);
        if (!used) {
          used = new Set();
          usedNamesByDir.set(dirKey, used);
        }
        return used;
      };

      folders.forEach((folder) => {
        const folderNotes = notes.filter((note) => note.folder === folder.id);
        if (folderNotes.length === 0) return;
        const folderZip = ensureZipFolder(zip, folder.name);
        if (!folderZip) return;
        const used = usedNamesFor(folder.name);
        folderNotes.forEach((note) => {
          folderZip.file(uniqueExportFilename(used, note.title, note.id, '.md'), note.content);
        });
      });

      const rootUsed = usedNamesFor('');
      notes
        .filter((note) => !note.folder)
        .forEach((note) => {
          zip.file(uniqueExportFilename(rootUsed, note.title, note.id, '.md'), note.content);
        });

      // Export attachments using the vault layout so importZip can recover
      // each blob's attachment id without guessing.
      await Promise.all(
        notes.flatMap((note) =>
          (note.attachments ?? []).map(async (att) => {
            const blob = await storage.getAttachmentBlob(att.id);
            if (blob) zip.file(zipAttachmentPath(note.id, att), blob);
          })
        )
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-vault.zip`);
      markExported();
    } catch (error) {
      const appError = fromImportError('unknown_error', 'Export failed. Please retry.');
      recordErrorSnapshot({
        at: new Date().toISOString(),
        operation: 'export_zip',
        code: appError.code,
        message: appError.userMessage,
        suggestedAction: appError.suggestedAction,
      });
      notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
    } finally {
      setExportingZip(false);
    }
  }, [ensureExportIntegrity, folders, notes, notify, workspaceName]);

  const exportHtmlZip = useCallback(async () => {
    if (!ensureExportIntegrity()) return;
    setExportingHtml(true);

    try {
      const zip = new JSZip();
      const htmlFolder = zip.folder('html-export');

      if (htmlFolder) {
        const usedNames = new Set<string>();
        notes.forEach((note) => {
          const safeTitle = escapeHtml(note.title || 'Untitled');
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p><small>Updated: ${new Date(note.updatedAt).toLocaleString()}</small></p>
  <hr />
  ${mdToHtml(note.content)}
</body>
</html>`;
          htmlFolder.file(uniqueExportFilename(usedNames, note.title, note.id, '.html'), html);
        });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-html-export.zip`);
    } catch (error) {
      const appError = fromImportError('unknown_error', 'HTML export failed. Please retry.');
      recordErrorSnapshot({
        at: new Date().toISOString(),
        operation: 'export_html_zip',
        code: appError.code,
        message: appError.userMessage,
        suggestedAction: appError.suggestedAction,
      });
      notify({ type: 'error', text: appError.userMessage, code: appError.code, suggestedAction: appError.suggestedAction });
    } finally {
      setExportingHtml(false);
    }
  }, [ensureExportIntegrity, notes, notify, workspaceName]);

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
              const strategy = importStrategyRef.current;
              const finalNotes = applyImportStrategy(normalizedWithPayloads, notes, strategy);
              const warningCount = report.issues.filter((issue) => issue.level === 'warning').length;
              const importedCount = countImportedNotes(finalNotes, notes, strategy);
              const incomingFolders = Array.isArray(parsed.folders) ? parsed.folders as Folder[] : [];
              try {
                await trackedImportData(
                  finalNotes as ImportedNote[],
                  resolveImportedFolders(strategy, folders, incomingFolders),
                  resolveImportedWorkspaceName(strategy, parsed.workspaceName),
                  strategy === 'overwrite',
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
    [notes, folders, notify, trackedImportData, requestConfirm],
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
      setImportStatusText('Scanning vault folder...');
      const rootHandle = await window.showDirectoryPicker({ mode: 'read' });
      const workspaceLabel = rootHandle.name || 'Imported Vault';
      const { folderPaths, files } = await collectVaultDirectoryEntries(rootHandle, rootHandle.name ? [rootHandle.name] : []);
      const sortedFolderPaths = expandFolderHierarchy(folderPaths).sort((a, b) => {
        const depthDiff = a.split('/').length - b.split('/').length;
        return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
      });
      const newFolders = sortedFolderPaths.map((name) => ({ id: crypto.randomUUID(), name, source: 'obsidian-import' as const }));
      const folderIdByPath = new Map(newFolders.map((folder) => [folder.name, folder.id]));
      setImportStatusText(`Importing ${files.length} vault file(s)...`);

      const { notes: newNotes, stagedAttachments } = await buildVaultImportPayload(files, folderIdByPath);

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

      const { notes: remappedNotes, folders: mergedFolders } = mergeImportedWorkspaceData(
        notes,
        folders,
        validatedNotes as ImportedNote[],
        newFolders,
      );

      requestConfirm({
        message: `Import "${workspaceLabel}" (${remappedNotes.length} note(s), ${newFolders.length} folder(s)) into current workspace?`,
        onConfirm: async () => {
          try {
            setImportStatusText('Saving imported attachments...');
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

            await trackedImportData([...notes, ...remappedNotes] as ImportedNote[], mergedFolders, undefined, false);
            notify({
              type: 'success',
              text: `Imported ${remappedNotes.length} note(s) from "${workspaceLabel}" into your workspace${stagedAttachments.length > 0 ? ` with ${stagedAttachments.length} attachment(s)` : ''}.`,
            });
          } catch (error) {
            await Promise.allSettled(
              stagedAttachments.map(async ({ attachmentId }) => {
                await storage.deleteAttachmentBlob(attachmentId);
              })
            );
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
    } finally {
      setImportStatusText(null);
    }
  }, [folders, notes, notify, trackedImportData, requestConfirm]);

  const importFolderFiles = useCallback(
    (files: FileList) => {
      const doImport = async () => {
        setImportStatusText('Scanning folder files...');
        const newFolders: Folder[] = [];
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
            currentFolder = { id: crypto.randomUUID(), name: currentPath, source: 'obsidian-import' };
            newFolders.push(currentFolder);
          }
          return currentFolder;
        };

        const scannedFiles: VaultScanFile[] = [];

        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if ((i + 1) % 25 === 0 || i + 1 === files.length) {
            setImportStatusText(`Scanning folder files (${i + 1}/${files.length})...`);
          }
          const classification = classifyFolderImportFile(file);
          if (classification.kind === 'unsupported') continue;

          const folderPath = getFolderImportPath(file);
          if (folderPath) getOrCreateFolder(folderPath);
          scannedFiles.push({
            pathSegments: (file.webkitRelativePath || file.name).split('/').filter(Boolean),
            file,
          });
        }

        const folderIdByPath = new Map(newFolders.map((folder) => [folder.name, folder.id]));
        const { notes: newNotes, stagedAttachments } = await buildVaultImportPayload(scannedFiles, folderIdByPath);

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

        setImportStatusText('Saving imported attachments...');
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

      const { notes: remappedNotes, folders: mergedFolders } = mergeImportedWorkspaceData(
        notes,
        folders,
        validatedNotes as ImportedNote[],
        newFolders,
      );

        try {
          await trackedImportData([...notes, ...remappedNotes] as ImportedNote[], mergedFolders, undefined, false);
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
          text: `Imported ${remappedNotes.length} item(s) from "${newWorkspaceName}" into your workspace.`,
        });
      };

      requestConfirm({
        message: `Import this folder into current workspace? Existing notes will be preserved.`,
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
          } finally {
            setImportStatusText(null);
          }
        },
      });
    },
    [notes, folders, notify, trackedImportData, requestConfirm],
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
            await trackedImportData([], [], value, true);
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
    }, [notes, folders, notify, trackedImportData, requestConfirm]);

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
            const manifest = JSON.parse(await manifestFile.async('string')) as Partial<BackupPayload>;
            const rawNotes = Array.isArray(manifest.notes) ? manifest.notes : [];
            const sourceById = new Map(
              rawNotes
                .map((note) => [note?.id, note?.source] as const)
                .filter((pair): pair is readonly [string, 'noa' | 'obsidian-import'] => typeof pair[0] === 'string' && (pair[1] === 'noa' || pair[1] === 'obsidian-import')),
            );
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
            validatedNotes = manifestWithPayloads.map((note) => ({
              ...note,
              source: sourceById.get(note.id) ?? 'obsidian-import',
            }));
            newFolders = Array.isArray(manifest.folders)
              ? manifest.folders.map((folder) => ({ ...folder, source: folder.source ?? 'obsidian-import' }))
              : [];
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
                folder = { id: crypto.randomUUID(), name: folderName, source: 'obsidian-import' };
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
            createdAt: extractObsidianCreatedAt(content) ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              folder: folderId,
              tags: resolveImportTags(content),
              links: extractLinks(content),
              linkRefs: [],
              source: 'obsidian-import',
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
            const parsedPath = parseZipAttachmentPath(path);
            if (!parsedPath) continue;
            const { attachmentId, filename } = parsedPath;
            try {
              const blob = await zipFile.async('blob');
              stagedAttachments.push({ attachmentId, blob });
              const mimeType = inferAttachmentMimeType({ name: filename, type: '' });
              const noteMatch = attachmentNoteLookup?.find((note) =>
                (note.attachments ?? []).some((attachment) => attachment.id === attachmentId)
              );
              if (noteMatch) {
                const noteIdx = validatedNotes.findIndex((candidate) => candidate.id === noteMatch.id);
                if (noteIdx !== -1) {
                  const note = validatedNotes[noteIdx];
                  const attachment = noteMatch.attachments?.find((candidate) => candidate.id === attachmentId);
                  if (attachment) {
                    validatedNotes[noteIdx] = {
                      ...note,
                      attachments: [...(note.attachments ?? []), {
                        id: attachmentId,
                        noteId: note.id,
                        filename: attachment.filename || filename,
                        mimeType: attachment.mimeType || mimeType,
                        size: blob.size,
                        createdAt: attachment.createdAt || new Date().toISOString(),
                        vaultPath: attachment.vaultPath || `attachments/${note.id}/${attachmentId}-${attachment.filename || filename}`,
                      }],
                    };
                  }
                }
              } else {
                validatedNotes = validatedNotes.map((note) => {
                  if (!note.content.includes(`![[${filename}]]`) && !note.content.includes(`[[${filename}]]`)) return note;
                  const attachment: Attachment = {
                    id: attachmentId,
                    noteId: note.id,
                    filename,
                    mimeType,
                    size: blob.size,
                    createdAt: new Date().toISOString(),
                    vaultPath: `attachments/${note.id}/${attachmentId}-${filename}`,
                  };
                  return { ...note, attachments: [...(note.attachments ?? []), attachment] };
                });
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
          await trackedImportData(validatedNotes as ImportedNote[], newFolders, workspaceLabel, true);
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
    [notes, folders, notify, trackedImportData, requestConfirm],
  );

  const connectFolder = useCallback(async () => {
    setConnectingFs(true);
    try {
      await onConnectFolder();
      notify({
        type: 'success',
        text: 'Connected to local folder. Imported vault notes will sync automatically.',
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
    importingData,
    importStatusText,
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
