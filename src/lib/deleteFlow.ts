import { recordErrorSnapshot } from './errorSnapshots';

export interface DeleteFlowHandlers {
  id: string;
  deleteLocal: (id: string) => Promise<boolean>;
  closeTab: (id: string) => void;
  syncDelete: (id: string) => void;
}

export async function deleteNoteWithLocalFirst({
  id,
  deleteLocal,
  closeTab,
  syncDelete,
}: DeleteFlowHandlers): Promise<boolean> {
  const deleted = await deleteLocal(id);
  if (!deleted) return false;
  closeTab(id);
  try {
    syncDelete(id);
  } catch (err) {
    // Vault delete failed — local delete already succeeded.
    // Record the failure so diagnostics can surface orphaned vault files.
    recordErrorSnapshot({
      at: new Date().toISOString(),
      operation: `deleteNoteFile:${id}`,
      code: 'unknown_error',
      message: err instanceof Error ? err.message : String(err),
      suggestedAction: 'retry',
    });
  }
  return true;
}
