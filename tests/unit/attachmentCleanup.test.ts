import { expect, it, vi } from 'vitest';

it('cleans only removed-note candidates, preserving shared and in-flight attachments', async () => {
  const blobs = new Map<string, Blob>();
  let release!: () => void;
  const pendingKeys = new Promise<void>(resolve => { release = resolve; });
  vi.doMock('localforage', () => ({ default: { createInstance: () => ({
    keys: async () => { await pendingKeys; return [...blobs.keys()]; },
    setItem: async (key: string, value: Blob) => { blobs.set(key, value); },
    removeItem: async (key: string) => { blobs.delete(key); },
  }) } }));
  const { storage } = await import('../../src/lib/storage');
  await storage.saveAttachmentBlob('removed', new Blob(['old']));
  await storage.saveAttachmentBlob('shared', new Blob(['shared']));
  const cleanup = storage.pruneOrphanedAttachments(new Set(['shared']), new Set(['removed', 'shared']));
  await storage.saveAttachmentBlob('uploading', new Blob(['new']));
  release();
  await cleanup;
  expect([...blobs.keys()].sort()).toEqual(['blob:shared', 'blob:uploading']);
});
