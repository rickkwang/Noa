import { useCallback, useEffect, useRef, useState } from 'react';
import { Attachment, Note } from '../types';
import { storage } from '../lib/storage';

function isAllowedAttachmentMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export type AttachmentError = 'type_not_allowed' | 'size_exceeded' | 'storage_full' | 'upload_failed';

export function useAttachments(
  note: Note | null,
  onNoteUpdate: (note: Note) => void
) {
  // objectUrl cache: attachmentId -> blobURL
  const [objectUrls, setObjectUrls] = useState<Map<string, string>>(new Map());
  const [attachmentLoadError, setAttachmentLoadError] = useState<string | null>(null);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  const revokeUrls = useCallback((urls: string[]) => {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    objectUrlsRef.current = objectUrls;
  }, [objectUrls]);

  const attachmentSignature = note?.attachments
    ?.map((attachment) => `${attachment.id}:${attachment.filename}:${attachment.mimeType}:${attachment.size}`)
    .join('|') ?? '';

  // Load blob URLs for all attachments of the current note.
  // Incremental: only revoke URLs whose attachment id is gone (or whose size/
  // mimeType/filename changed — signature mismatch). URLs for unchanged ids
  // are kept across renders so <img> tags do not flicker when a sibling
  // attachment is added/removed, and so uploadFile's optimistic URL isn't
  // double-revoked by this effect.
  useEffect(() => {
    let cancelled = false;
    const previousMap = objectUrlsRef.current;
    const nextAttachments = note?.attachments ?? [];
    const nextIds = new Set(nextAttachments.map((a) => a.id));

    // Revoke URLs that are no longer needed (attachment removed or note cleared).
    const toRevoke: string[] = [];
    previousMap.forEach((url, id) => {
      if (!nextIds.has(id)) toRevoke.push(url);
    });
    if (toRevoke.length > 0) revokeUrls(toRevoke);

    if (nextAttachments.length === 0) {
      if (previousMap.size > 0) setObjectUrls(new Map());
      return;
    }

    // Only fetch blobs for ids we don't already have a URL for.
    const missing = nextAttachments.filter((a) => !previousMap.has(a.id));
    if (missing.length === 0) {
      // Prune the map in place if anything was revoked above.
      if (toRevoke.length > 0) {
        const next = new Map<string, string>();
        previousMap.forEach((url, id) => { if (nextIds.has(id)) next.set(id, url); });
        setObjectUrls(next);
      }
      setAttachmentLoadError(null);
      return;
    }

    const pendingUrls: string[] = [];
    Promise.allSettled(
      missing.map(async (att) => {
        const blob = await storage.getAttachmentBlob(att.id);
        if (!blob) throw new Error(`Attachment blob missing: ${att.filename}`);
        const url = URL.createObjectURL(blob);
        pendingUrls.push(url);
        return { id: att.id, url };
      })
    ).then((results) => {
      if (cancelled) {
        revokeUrls(pendingUrls);
        return;
      }
      setObjectUrls((prev) => {
        const next = new Map<string, string>();
        prev.forEach((url, id) => { if (nextIds.has(id)) next.set(id, url); });
        results.forEach((r) => {
          if (r.status === 'fulfilled') next.set(r.value.id, r.value.url);
        });
        return next;
      });
      const failures = results.filter((r) => r.status === 'rejected').length;
      setAttachmentLoadError(failures > 0 ? `${failures} attachment(s) could not be loaded.` : null);
    }).catch((err) => {
      console.error('[Noa] Failed to load attachment URLs:', err);
      revokeUrls(pendingUrls);
    });

    return () => { cancelled = true; };
  }, [note?.id, attachmentSignature, revokeUrls]);

  // Revoke all object URLs on unmount
  useEffect(() => {
    return () => {
      revokeUrls([...objectUrlsRef.current.values()]);
      objectUrlsRef.current = new Map();
    };
  }, [revokeUrls]);

  const uploadFile = useCallback(
    async (file: File): Promise<AttachmentError | null> => {
      if (!note) return null;

      if (!isAllowedAttachmentMimeType(file.type)) return 'type_not_allowed';
      if (file.size > MAX_SIZE_BYTES) return 'size_exceeded';

      // Check storage quota before saving
      try {
        const estimate = await storage.getStorageEstimate();
        if (estimate?.quota && estimate?.usage) {
          const remaining = estimate.quota - estimate.usage;
          if (file.size > remaining * 0.9) return 'storage_full';
        }
      } catch { /* quota API unavailable, proceed anyway */ }

      try {
        const id = crypto.randomUUID();
        const attachment: Attachment = {
          id,
          noteId: note.id,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          createdAt: new Date().toISOString(),
          vaultPath: `attachments/${note.id}/${id}-${file.name}`,
        };

        await storage.saveAttachmentBlob(id, file);

        const url = URL.createObjectURL(file);
        setObjectUrls((prev) => new Map(prev).set(id, url));

        const updatedNote: Note = {
          ...note,
          attachments: [...(note.attachments ?? []), attachment],
        };
        onNoteUpdate(updatedNote);
        return null;
      } catch {
        return 'upload_failed';
      }
    },
    [note, onNoteUpdate]
  );

  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (!note) return;

      try {
        await storage.deleteAttachmentBlob(attachmentId);
      } catch (err) {
        console.error('[Noa] Failed to delete attachment blob:', err);
      }

      const url = objectUrls.get(attachmentId);
      if (url) {
        URL.revokeObjectURL(url);
        setObjectUrls((prev) => {
          const next = new Map(prev);
          next.delete(attachmentId);
          return next;
        });
      }

      const updatedNote: Note = {
        ...note,
        attachments: (note.attachments ?? []).filter((a) => a.id !== attachmentId),
      };
      onNoteUpdate(updatedNote);
    },
    [note, objectUrls, onNoteUpdate]
  );

  return { objectUrls, uploadFile, deleteAttachment, attachmentLoadError };
}
