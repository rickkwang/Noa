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
  syncDelete(id);
  return true;
}
