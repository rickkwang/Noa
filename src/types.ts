export interface Attachment {
  id: string;
  noteId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  dataBase64?: string;
  vaultPath?: string;
}

export type NoteSource = 'noa' | 'obsidian-import';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  folder: string;
  tags: string[];
  links: string[];
  linkRefs: string[];
  attachments?: Attachment[];
  source?: NoteSource;
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
  source?: NoteSource;
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
  taskId?: string;
  completed: boolean;
  dueDate?: string;
  priority: Priority;
  lineIndex: number;
  occurrenceIndex: number;
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
