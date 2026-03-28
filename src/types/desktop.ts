export type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'ready'
  | 'error';

export interface UpdateStatus {
  state: UpdateStatusState;
  message?: string;
  version?: string;
  progress?: number;
  downloadUrl?: string;
}
