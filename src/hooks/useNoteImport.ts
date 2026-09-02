import { useCallback } from 'react';
import type React from 'react';
import { fromImportError, fromStorageError } from '../lib/appErrors';
import {
  findInvalidAttachmentPayload,
  mergeAttachmentPayloads,
  type ImportedNote,
} from '../lib/attachmentUtils';
import { normalizeAndValidateNotes } from '../lib/dataIntegrity';
import { parkRescuedNotes, withTimeout } from '../lib/importRescue';
import { prepareImportedNotes } from '../lib/importUtils';
import { extractLinks, extractTags } from '../lib/noteUtils';
import { storage } from '../lib/storage';
import { reconcileConcurrentImportEdits } from '../lib/vaultImportReconciliation';
import { AppErrorCode, Folder, Note } from '../types';

export interface LoadErrorState {
  code: AppErrorCode;
  message: string;
}

interface UseNoteImportOptions {
  notesRef: React.RefObject<Note[]>;
  isImportingRef: React.RefObject<boolean>;
  deferredSavesRef: React.RefObject<Map<string, Note>>;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setWorkspaceName: React.Dispatch<React.SetStateAction<string>>;
  setSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  setLoadError: React.Dispatch<React.SetStateAction<LoadErrorState | null>>;
  syncLinkRefs: (nextNotes: Note[], previousNotes?: Note[], changedIds?: Set<string>, foldersOverride?: Folder[]) => Note[];
  flushAllPendingSaves: () => Promise<void>;
}

export function useNoteImport({
  notesRef,
  isImportingRef,
  deferredSavesRef,
  setNotes,
  setFolders,
  setWorkspaceName,
  setSaveError,
  setLoadError,
  syncLinkRefs,
  flushAllPendingSaves,
}: UseNoteImportOptions) {
  const handleImportData = useCallback(async (importedNotes: ImportedNote[], importedFolders?: Folder[], newWorkspaceName?: string, shouldPrune = false, deletedNoteIds?: string[]) => {
    const savedAttachmentIds: string[] = [];
    // Blob ids that existed before this import. A failed import must only clean
    // up blobs it created itself — pre-existing ids were merely overwritten with
    // the same immutable content, and deleting them would destroy the user's
    // attachments. null = listing failed → delete nothing (the orphan pruner
    // reclaims leaked blobs on the next successful import).
    let preexistingBlobIds: ReadonlySet<string> | null = null;
    try {
      preexistingBlobIds = new Set(await storage.listAttachmentBlobIds());
    } catch {
      preexistingBlobIds = null;
    }
    // Everything from the lock onward lives inside this try: the finally is the
    // only thing that releases it and drains deferredSavesRef, so an await that
    // sits outside would leak the lock on throw. A leaked lock is silent data
    // loss — debounceSave keeps queueing into deferredSavesRef and nothing ever
    // reaches storage again.
    try {
      // Acquire import lock BEFORE flushing pending saves so any concurrent
      // debounceSave calls that arrive mid-flush get queued instead of racing.
      isImportingRef.current = true;
      // Persist whatever the user has edited up to this moment. These writes
      // are what the "rescue" logic below preserves.
      try { await withTimeout(flushAllPendingSaves(), 'flushPendingSaves'); } catch { /* best-effort */ }

      const attachmentError = findInvalidAttachmentPayload(importedNotes);
      if (attachmentError) {
        throw new Error(attachmentError);
      }

      const importAttachments = importedNotes.flatMap((note) =>
        (note.attachments ?? [])
          .filter((attachment) => Boolean(attachment.dataBase64))
          .map((attachment) => ({
            id: attachment.id,
            mimeType: attachment.mimeType,
            dataBase64: attachment.dataBase64 as string,
          }))
      );

      // Pre-flight total-size check. base64 adds ~33% overhead, decode into
      // Blob briefly doubles footprint, so the practical peak memory is
      // roughly 2× the raw byte size. We reject imports whose decoded size
      // would exceed this threshold to prevent OOM on low-RAM devices.
      const IMPORT_TOTAL_RAW_LIMIT = 500 * 1024 * 1024; // 500 MB decoded
      const approxRawBytes = importAttachments.reduce(
        (sum, a) => sum + Math.floor(a.dataBase64.length * 0.75),
        0,
      );
      if (approxRawBytes > IMPORT_TOTAL_RAW_LIMIT) {
        throw new Error(
          `Import rejected: attachments total ~${Math.round(approxRawBytes / 1024 / 1024)}MB exceed the ${IMPORT_TOTAL_RAW_LIMIT / 1024 / 1024}MB safety limit. Split the backup into smaller parts.`,
        );
      }

      // Smaller batch size reduces peak memory usage for large attachments.
      const ATTACHMENT_BATCH_SIZE = 5;
      for (let i = 0; i < importAttachments.length; i += ATTACHMENT_BATCH_SIZE) {
        const batch = importAttachments.slice(i, i + ATTACHMENT_BATCH_SIZE);
        const batchResults = await withTimeout(
          Promise.allSettled(batch.map(async (attachment) => {
            // Decode base64 via fetch/blob to avoid holding a giant Uint8Array.
            const blob = await fetch(`data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.dataBase64}`)
              .then(r => r.blob());
            await storage.saveAttachmentBlob(attachment.id, blob);
            return attachment.id;
          })),
          'saveAttachmentBlobs',
        );
        for (const r of batchResults) {
          if (r.status === 'fulfilled') savedAttachmentIds.push(r.value);
        }
      }

      // Preserve the vault origin marker: vault-sync merge results reach here
      // already marked, and untrusted external imports (JSON/zip/folder) have
      // stripped origin upstream before calling in — so trusting it here is safe.
      const { notes: normalizedNotes } = normalizeAndValidateNotes(importedNotes, { preserveVaultMetadata: true });
      // When vault-sync prunes, rescue any local Noa-native notes that were
      // created between mergeScannedNotes() capturing its snapshot and this
      // import landing. Without this, a note created during bootstrap
      // (Cmd+N while the vault is still scanning) would be prune-deleted.
      // A scan can finish after a new local edit. Dirty vault rows are the
      // explicit conflict boundary and must be rebased over that stale scan;
      // clean rows still take the authoritative disk version.
      const mergedBase = reconcileConcurrentImportEdits(
        normalizedNotes,
        notesRef.current,
        deferredSavesRef.current,
        shouldPrune,
        deletedNoteIds,
      );
      const withRefs = syncLinkRefs(mergedBase.map((note) => {
        // Obsidian-imported notes carry their own tags/links from frontmatter;
        // re-extracting from body content would overwrite them with wrong data.
        if ((note.source ?? 'noa') === 'obsidian-import') return note;
        return {
          ...note,
          tags: extractTags(note.content),
          links: extractLinks(note.content),
        };
      // setFolders(importedFolders) only lands after this runs — resolve
      // path links against the incoming folder list, not foldersRef.
      }), undefined, undefined, importedFolders ?? undefined);
      // Every await under the lock is timeout-guarded: a wedged IndexedDB that
      // never settles would skip both catch and finally, stranding the lock.
      await withTimeout(storage.saveNotes(withRefs), 'saveNotes');
      if (shouldPrune) {
        await withTimeout(storage.pruneOrphanedNotes(withRefs.map(n => n.id)), 'pruneOrphanedNotes');
      }
      if (importedFolders) await withTimeout(storage.saveFolders(importedFolders), 'saveFolders');
      if (newWorkspaceName) await withTimeout(storage.saveWorkspaceName(newWorkspaceName), 'saveWorkspaceName');
      // 清理孤立附件 Blob（best-effort，非关键路径）.
      // Use withRefs (the final merged state including rescued noa-native notes),
      // not importedNotes — otherwise attachments belonging to rescued local notes
      // would be flagged as orphans and deleted.
      const validIds = new Set(
        withRefs.flatMap((n) => (n.attachments ?? []).map((a) => a.id))
      );
      storage.pruneOrphanedAttachments(validIds).catch((err) => {
        console.error('[Noa] Failed to prune orphaned attachments:', err);
      });
      // 所有 storage 写入成功后，更新 React state
      setNotes(withRefs);
      if (importedFolders) setFolders(importedFolders);
      if (newWorkspaceName) setWorkspaceName(newWorkspaceName);
    } catch (error) {
      const createdByThisImport = preexistingBlobIds === null
        ? []
        : savedAttachmentIds.filter((attachmentId) => !preexistingBlobIds.has(attachmentId));
      // Timeout-guarded like every other await under the lock, and swallowed:
      // on a wedged store this cleanup is exactly what hangs, and reaching the
      // rethrow plus the finally drain matters more. Leaked blobs are reclaimed
      // by the next successful import's orphan prune (see preexistingBlobIds).
      try {
        await withTimeout(
          Promise.allSettled(createdByThisImport.map((attachmentId) => storage.deleteAttachmentBlob(attachmentId))),
          'deleteAttachmentBlobs',
        );
      } catch { /* wedged store — see above */ }
      throw error;
    } finally {
      // Flush queued edits BEFORE releasing the lock. If we released first,
      // a concurrent debounceSave between release and flush would schedule
      // a fresh timer reading stale state and overwrite newer queued content.
      // Writing directly to storage bypasses the 500ms debounce because these
      // edits are already several seconds old and at risk on quit.
      const queued = Array.from(deferredSavesRef.current.values());
      deferredSavesRef.current.clear();
      const unsaved: Note[] = [];
      for (const note of queued) {
        try {
          // Timeout-guarded for the same reason as above: if IndexedDB is the
          // thing that failed, this drain is exactly where it will hang, and a
          // hang here strands the lock just as surely as one in the try body.
          await withTimeout(storage.saveNote(note), 'saveNote');
        } catch (err) {
          // On the failed-import path this flush is the only persistence these
          // edits get — swallowing the error silently would lose them on quit.
          unsaved.push(note);
          console.error('[Noa] Failed to flush deferred edit for note:', note.id, err);
        }
      }
      if (unsaved.length > 0) {
        const plural = unsaved.length > 1 ? 's' : '';
        // localStorage is a different store from IndexedDB, so it is still
        // reachable in the case that brought us here.
        setSaveError(
          parkRescuedNotes(unsaved)
            ? `Could not save ${unsaved.length} edit${plural} made during import. They have been set aside and will be restored the next time Noa starts.`
            : `Could not save ${unsaved.length} edit${plural} made during import, and they could not be set aside either. Copy your text out of the editor before closing Noa.`,
        );
      }
      // The batch's setNotes(withRefs) ran before these edits were queued, so
      // state currently shows the import-delivered body while storage holds
      // the newer edit. Re-apply the queue or the two diverge until reload.
      if (queued.length > 0) {
        const queuedById = new Map(queued.map((note) => [note.id, note]));
        setNotes((prev) => prev.map((note) => queuedById.get(note.id) ?? note));
      }
      isImportingRef.current = false;
    }
  }, [deferredSavesRef, flushAllPendingSaves, isImportingRef, notesRef, setFolders, setNotes, setSaveError, setWorkspaceName, syncLinkRefs]);

  const importBackupFromRecovery = useCallback(async (file: File) => {
    try {
      const content = await file.text();
      let parsed: { notes?: ImportedNote[]; folders?: Folder[]; workspaceName?: string };
      try {
        parsed = JSON.parse(content) as { notes?: ImportedNote[]; folders?: Folder[]; workspaceName?: string };
      } catch {
        const appError = fromImportError('import_invalid_json', 'Error parsing backup file.');
        setLoadError({ code: appError.code, message: appError.userMessage });
        return;
      }
      if (!parsed.notes || !Array.isArray(parsed.notes)) {
        const appError = fromImportError('import_invalid_json', 'Invalid backup file.');
        setLoadError({ code: appError.code, message: appError.userMessage });
        return;
      }
      const rawNotes = parsed.notes as ImportedNote[];
      const { notes: normalizedNotes, report } = normalizeAndValidateNotes(rawNotes);
      if (!report.ok) {
        const appError = fromImportError('import_integrity_failed', 'Invalid backup payload.');
        setLoadError({ code: appError.code, message: appError.userMessage });
        return;
      }

      const rawById = new Map(rawNotes.map((note) => [note.id, note]));
      // prepareImportedNotes re-derives tags/links for noa-native notes only;
      // obsidian-import notes keep their frontmatter-derived values.
      const normalizedWithPayloads: ImportedNote[] = prepareImportedNotes(
        normalizedNotes.map((note) => mergeAttachmentPayloads(note, rawById.get(note.id))),
      );
      const attachmentError = findInvalidAttachmentPayload(normalizedWithPayloads);
      if (attachmentError) {
        setLoadError({ code: 'import_integrity_failed', message: attachmentError });
        return;
      }

      await handleImportData(normalizedWithPayloads, parsed.folders || [], parsed.workspaceName || 'Recovered Workspace', true);
      storage.clearLegacyLocalStorage();
      setLoadError(null);
    } catch (error) {
      const importErrorCode = error instanceof Error && error.message.startsWith('Attachment payload is invalid')
        ? 'import_integrity_failed'
        : error instanceof Error && error.message === 'Invalid backup payload.'
          ? 'import_integrity_failed'
          : error instanceof Error && error.message === 'Invalid backup file.'
            ? 'import_invalid_json'
            : null;
      const appError = importErrorCode
        ? fromImportError(importErrorCode, importErrorCode === 'import_invalid_json' ? 'Error parsing backup file.' : 'Import integrity check failed.')
        : fromStorageError(error);
      setLoadError({ code: appError.code, message: appError.userMessage });
    }
  }, [handleImportData, setLoadError]);

  return { handleImportData, importBackupFromRecovery };
}
