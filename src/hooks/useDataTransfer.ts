import { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import { AppErrorCode, Folder, Note, RecoveryAction } from '../types';
import { mdToHtml } from '../lib/export';
import { normalizeAndValidateNotes, validateExportData } from '../lib/dataIntegrity';
import { markExported } from '../lib/exportTimestamp';
import { fromImportError, fromStorageError, fromSyncError } from '../lib/appErrors';
import { recordErrorSnapshot } from '../lib/errorSnapshots';

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

export function applyImportStrategy(
  incoming: Note[],
  existing: Note[],
  strategy: 'overwrite' | 'merge' | 'skip'
): Note[] {
  if (strategy === 'overwrite') return incoming;
  const existingIds = new Set(existing.map(n => n.id));
  if (strategy === 'skip') {
    const newNotes = incoming.filter(n => !existingIds.has(n.id));
    return [...existing, ...newNotes];
  }
  // merge: conflicting notes (same ID) get " (imported)" suffix, new notes appended
  const merged = [...existing];
  const mergedIds = new Set(existing.map(n => n.id));
  for (const note of incoming) {
    if (mergedIds.has(note.id)) {
      merged.push({ ...note, id: crypto.randomUUID(), title: note.title + ' (imported)' });
    } else {
      merged.push(note);
    }
  }
  return merged;
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
  onImportData: (notes: Note[], folders?: Folder[], workspaceName?: string) => void;
  onConnectFolder: () => Promise<void>;
  onDisconnectFolder: () => Promise<void>;
  notify: (message: DataTransferMessage) => void;
  requestConfirm: (request: ConfirmRequest) => void;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_');
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

export function exportJsonSnapshot(notes: Note[], folders: Folder[], workspaceName: string): boolean {
  const report = validateExportData(notes, folders);
  if (!report.ok) return false;
  const blob = new Blob([JSON.stringify({ notes, folders, workspaceName }, null, 2)], {
    type: 'application/json',
  });
  const filename = `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-backup-${new Date().toISOString().split('T')[0]}.json`;
  downloadBlob(blob, filename);
  markExported();
  return true;
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
    exportJsonSnapshot(notes, folders, workspaceName);
  }, [folders, notes, workspaceName]);

  const exportZip = useCallback(async () => {
    if (!ensureExportIntegrity()) return;
    setExportingZip(true);

    try {
      const zip = new JSZip();
      folders.forEach((folder) => {
        const folderNotes = notes.filter((note) => note.folder === folder.id);
        if (folderNotes.length === 0) return;
        const folderZip = zip.folder(sanitizeFilename(folder.name));
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

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${workspaceName.replace(/\s+/g, '-').toLowerCase()}-export.zip`);
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
      markExported();
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

          const { notes: normalizedNotes, report } = normalizeAndValidateNotes(parsed.notes);
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

          const conflictSummary = analyzeConflicts(normalizedNotes, notes);
          importStrategyRef.current = 'overwrite';

          requestConfirm({
            message: `This may replace existing data (${notes.length} note(s), ${folders.length} folder(s)). Continue?`,
            conflictSummary,
            onStrategyChange: (s) => { importStrategyRef.current = s; },
            onConfirm: () => {
              const finalNotes = applyImportStrategy(normalizedNotes, notes, importStrategyRef.current);
              const warningCount = report.issues.filter((issue) => issue.level === 'warning').length;
              const importedCount = importStrategyRef.current === 'overwrite'
                ? normalizedNotes.length
                : finalNotes.length - notes.length;
              onImportData(
                finalNotes,
                parsed.folders || [],
                parsed.workspaceName || 'Imported Workspace',
              );
              notify({
                type: 'success',
                text: `Imported ${importedCount} notes${
                  warningCount ? ` with ${warningCount} warning(s)` : ''
                }.`,
              });
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
    [notes, notify, onImportData, requestConfirm],
  );

  const importFolderFiles = useCallback(
    (files: FileList) => {
      const doImport = async () => {
        const newNotes: Note[] = [];
        const newFolders: Folder[] = [];
        let newWorkspaceName = 'Imported Folder';

        if (files[0]?.webkitRelativePath) {
          newWorkspaceName = files[0].webkitRelativePath.split('/')[0];
        }

        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if (!file.name.endsWith('.md')) continue;

          const pathParts = file.webkitRelativePath.split('/');
          let folderId = '';
          if (pathParts.length > 2) {
            const folderName = pathParts[pathParts.length - 2];
            let folder = newFolders.find((f) => f.name === folderName);
            if (!folder) {
              folder = { id: crypto.randomUUID(), name: folderName };
              newFolders.push(folder);
            }
            folderId = folder.id;
          }

          const content = await file.text();
          newNotes.push({
            id: crypto.randomUUID(),
            title: file.name.replace('.md', ''),
            content,
            createdAt: new Date().toISOString(),
            updatedAt: new Date(file.lastModified).toISOString(),
            folder: folderId,
            tags: [],
            links: [],
          });
        }

        if (newNotes.length === 0) {
          const appError = fromImportError('import_integrity_failed', 'No Markdown files found.');
          notify({ type: 'error', text: 'No Markdown files found in the selected folder.', code: appError.code, suggestedAction: appError.suggestedAction });
          return;
        }

        onImportData(newNotes, newFolders, newWorkspaceName);
        notify({
          type: 'success',
          text: `Imported ${newNotes.length} notes from "${newWorkspaceName}".`,
        });
      };

      requestConfirm({
        message: `Importing a folder will replace current data (${notes.length} note(s), ${folders.length} folder(s)). Continue?`,
        onConfirm: () => {
          void doImport();
        },
      });
    },
    [notify, onImportData, requestConfirm],
  );

  const createNewWorkspace = useCallback(() => {
    requestConfirm({
      message:
        `Create a new workspace? This will clear current data (${notes.length} note(s), ${folders.length} folder(s)). Export backup first.`,
      defaultInput: 'New Workspace',
      inputLabel: 'Workspace name:',
      onConfirm: (nameValue) => {
        const value = (nameValue || '').trim() || 'New Workspace';
        onImportData([], [], value);
        notify({ type: 'success', text: `Workspace switched to "${value}".` });
      },
    });
  }, [notify, onImportData, requestConfirm]);

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
    importFolderFiles,
    createNewWorkspace,
    connectFolder,
    disconnectFolder,
  };
}
