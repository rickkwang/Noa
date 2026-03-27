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
