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

  // Load blob URLs for all attachments of the current note
  useEffect(() => {
    let cancelled = false;
    const newUrls = new Map<string, string>();
    const pendingUrls: string[] = [];
    const previousUrls = [...objectUrlsRef.current.values()];

    if (!note?.attachments?.length) {
      revokeUrls(previousUrls);
      setObjectUrls(new Map());
      return;
    }

    Promise.allSettled(
      (note.attachments ?? []).map(async (att) => {
        const blob = await storage.getAttachmentBlob(att.id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          pendingUrls.push(url);
          if (!cancelled) {
            newUrls.set(att.id, url);
          }
        }
      })
    ).then(() => {
      if (!cancelled) {
        revokeUrls(previousUrls);
        setObjectUrls(new Map(newUrls));
      } else {
        revokeUrls(pendingUrls);
      }
    });

    return () => {
      cancelled = true;
    };
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

      await storage.deleteAttachmentBlob(attachmentId);

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

  return { objectUrls, uploadFile, deleteAttachment };
}
