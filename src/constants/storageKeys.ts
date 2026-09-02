export const STORAGE_KEYS = {
  OPEN_TABS: 'redaction-diary-open-tabs',
  SIDEBAR_OPEN: 'app-sidebar-open',
  RIGHT_TAB: 'app-right-tab',
  EDITOR_VIEW_MODE: 'app-editor-view-mode',
  SETTINGS_ACTIVE_TAB: 'app-settings-active-tab',
  SETTINGS: 'app-settings',
  STORAGE_NOTICE_SEEN: 'redaction-storage-notice-seen',
  RECENT_NOTES: 'redaction-diary-recent-notes',
  DAILY_FOLDER_ID: 'redaction-diary-daily-folder-id',
  RIGHT_PANEL_OPEN: 'app-right-panel-open',
  GRAPH_GUIDE_SEEN: 'app-graph-guide-seen',
  VAULT_ONBOARDING_SEEN: 'app-vault-onboarding-seen',
  LAST_EXPORT_AT:   'redaction-last-export-at',
  ERROR_SNAPSHOTS:  'redaction-error-snapshots',
  LAST_ACTIVE_NOTE: 'redaction-last-active-note-id',
  NOTE_SORT_ORDER: 'app-note-sort-order',
  TASKS_COMPLETED_EXPANDED: 'app-tasks-completed-expanded',
  LAST_AUTO_BACKUP_AT: 'noa:last-auto-backup-at',
  AUTO_BACKUP_LAST_ERROR: 'noa:auto-backup-last-error',
  // Edits that could not be written to IndexedDB during an import. Parked in
  // localStorage — a separate, synchronous store — precisely because the
  // failure mode being covered is IndexedDB itself being unavailable.
  RESCUED_IMPORT_EDITS: 'noa:rescued-import-edits',
} as const;
