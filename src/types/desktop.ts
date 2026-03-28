export type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateStatusState;
  message?: string;
  version?: string;
  progress?: number;
}
