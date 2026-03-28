export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  folder: string;
  tags: string[];
  links: string[];
}

export interface Link {
  sourceId: string;
  targetId: string;
  text: string;
}

export interface Graph {
  nodes: Note[];
  edges: Link[];
}

export interface Folder {
  id: string;
  name: string;
}

export type BackupHealthStatus = 'healthy' | 'warning' | 'risk';
export type RecoveryAction = 'retry' | 'import_backup' | 'reset_workspace';
export type AppErrorCode =
  | 'storage_unavailable'
  | 'import_invalid_json'
  | 'import_integrity_failed'
  | 'import_replace_risky'
  | 'sync_permission_denied'
  | 'unknown_error';

export type Priority = 'high' | 'medium' | 'low' | 'none';

export interface GlobalTask {
  id: string;
  noteId: string;
  noteTitle: string;
  content: string;
  completed: boolean;
  dueDate?: string;
  priority: Priority;
  lineIndex: number;
  originalString: string;
}

export interface AppSettings {
  editor: {
    fontSize: number;
    lineHeight: number;
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
    accentColor: string;
    fontFamily: string;
    maxWidth: number;
    focusMode: boolean;
  };
  dailyNotes: {
    template: string;
    dateFormat: string;
  };
  search: {
    caseSensitive: boolean;
    fuzzySearch: boolean;
  };
  corePlugins: {
    graphView: boolean;
    dailyNotes: boolean;
  };
}

export type SyncStatus = 'idle' | 'syncing' | 'ready' | 'error';
