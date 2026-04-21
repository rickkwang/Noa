import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, Note } from '../types';
import {
  clearBackupHandle,
  getBackupHandle,
  persistBackupHandle,
  queryBackupPermission,
  requestBackupDirectory,
  requestBackupPermission,
} from '../lib/backupDirectoryStorage';
import {
  getAutoBackupLastError,
  getLastAutoBackupAt,
  recordAutoBackupError,
  runAutoBackup,
  shouldRunAutoBackup,
} from '../services/autoBackupService';

export type AutoBackupStatus = 'idle' | 'running' | 'success' | 'error' | 'needs-reauth';

interface UseAutoBackupOptions {
  notes: Note[];
  folders: Folder[];
  workspaceName: string;
  isLoaded: boolean;
  autoBackupEnabled: boolean;
  onSettingsUpdate: (patch: { autoBackupEnabled: boolean }) => void;
  // Returns true while useNotes is running handleImportData; we must not
  // snapshot during an import, because notes/folders may be in a transitional
  // state (partially merged). A backup taken then would look internally
  // consistent but capture a moment that never existed in the user's timeline.
  getIsImporting: () => boolean;
}

export interface UseAutoBackupResult {
  backupStatus: AutoBackupStatus;
  backupError: string | null;
  lastAutoBackupAt: string | null;
  directoryName: string | null;
  hasBackupHandle: boolean;
  chooseDirectory: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  runNow: () => Promise<boolean>;
  reconnect: () => Promise<boolean>;
}

/**
 * Orchestrates automatic daily backups. On bootstrap (once isLoaded is true
 * and the setting is enabled), checks the last backup timestamp and runs a
 * snapshot if the 24h window has elapsed. Never prompts for permission during
 * bootstrap — only queries. Permission prompts happen on user interaction
 * (chooseDirectory / reconnect / runNow).
 */
export function useAutoBackup({
  notes,
  folders,
  workspaceName,
  isLoaded,
  autoBackupEnabled,
  onSettingsUpdate,
  getIsImporting,
}: UseAutoBackupOptions): UseAutoBackupResult {
  const [backupStatus, setBackupStatus] = useState<AutoBackupStatus>('idle');
  const [backupError, setBackupError] = useState<string | null>(() => getAutoBackupLastError());
  const [lastAutoBackupAt, setLastAutoBackupAt] = useState<string | null>(() => getLastAutoBackupAt());
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryName, setDirectoryName] = useState<string | null>(null);

  // Refs hold the latest notes/folders so the bootstrap effect can read them
  // without re-running on every keystroke.
  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  const workspaceNameRef = useRef(workspaceName);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { workspaceNameRef.current = workspaceName; }, [workspaceName]);

  // Guard against the bootstrap auto-run firing more than once per session,
  // e.g. if isLoaded briefly flips during a hot reload.
  const bootstrapDidRunRef = useRef(false);

  // Load persisted handle once at mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await getBackupHandle();
      if (cancelled) return;
      if (h) {
        setHandle(h);
        setDirectoryName(h.name);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const doRun = useCallback(async (
    dirHandle: FileSystemDirectoryHandle,
  ): Promise<boolean> => {
    // Refuse to snapshot while an import is in flight — see getIsImporting
    // comment on UseAutoBackupOptions.
    if (getIsImporting()) {
      setBackupError('Skipped: data import in progress. Try again after it finishes.');
      setBackupStatus('error');
      return false;
    }
    setBackupStatus('running');
    const result = await runAutoBackup(
      dirHandle,
      notesRef.current,
      foldersRef.current,
      workspaceNameRef.current,
    );
    if (result.ok === true) {
      setBackupStatus('success');
      setBackupError(null);
      setLastAutoBackupAt(getLastAutoBackupAt());
      return true;
    }
    const reason = result.reason;
    const detail = result.detail;
    let message: string;
    if (reason === 'permission_denied') {
      message = 'Backup folder permission was revoked. Click to reconnect.';
    } else if (reason === 'validation_failed') {
      message = `Backup aborted: ${detail ?? 'data integrity check failed'}`;
    } else {
      message = `Backup failed: ${detail ?? 'unknown error'}`;
    }
    recordAutoBackupError(message);
    setBackupError(message);
    setBackupStatus(reason === 'permission_denied' ? 'needs-reauth' : 'error');
    return false;
  }, [getIsImporting]);

  // Bootstrap scheduler: once per app start, if enabled + handle present +
  // permission granted + 24h elapsed, run a backup.
  //
  // If an import is in flight when we arrive (e.g. vault reconnect triggered
  // handleImportData on mount), we must not mark bootstrap as done — that
  // would strand the user without a backup for the rest of the session. Poll
  // briefly and retry; imports typically complete in under a second.
  useEffect(() => {
    if (!isLoaded) return;
    if (!autoBackupEnabled) return;
    if (!handle) return;
    if (bootstrapDidRunRef.current) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async () => {
      if (cancelled) return;
      if (getIsImporting()) {
        // Don't set bootstrapDidRunRef; try again shortly.
        retryTimer = setTimeout(() => { void attempt(); }, 1500);
        return;
      }
      bootstrapDidRunRef.current = true;
      const perm = await queryBackupPermission(handle);
      if (cancelled) return;
      if (perm !== 'granted' && perm !== 'unsupported') {
        setBackupStatus('needs-reauth');
        return;
      }
      if (!shouldRunAutoBackup(getLastAutoBackupAt())) return;
      await doRun(handle);
    };

    void attempt();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isLoaded, autoBackupEnabled, handle, doRun, getIsImporting]);

  const chooseDirectory = useCallback(async (): Promise<boolean> => {
    let picked: FileSystemDirectoryHandle;
    try {
      picked = await requestBackupDirectory();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled the picker — not an error.
        return false;
      }
      const message = err instanceof Error ? err.message : 'Failed to choose backup folder.';
      setBackupError(message);
      setBackupStatus('error');
      return false;
    }
    try {
      await persistBackupHandle(picked);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to persist backup folder.';
      setBackupError(message);
      setBackupStatus('error');
      return false;
    }
    setHandle(picked);
    setDirectoryName(picked.name);
    onSettingsUpdate({ autoBackupEnabled: true });
    // Run an immediate backup so the user sees confirmation the folder works.
    // If the confirmation write fails, roll the connection back so we don't
    // leave a persisted handle that the bootstrap will retry with on every
    // launch.
    const ok = await doRun(picked);
    if (!ok) {
      try { await clearBackupHandle(); } catch { /* best-effort */ }
      setHandle(null);
      setDirectoryName(null);
      onSettingsUpdate({ autoBackupEnabled: false });
      return false;
    }
    return true;
  }, [doRun, onSettingsUpdate]);

  const disconnect = useCallback(async (): Promise<void> => {
    await clearBackupHandle();
    setHandle(null);
    setDirectoryName(null);
    setBackupError(null);
    setBackupStatus('idle');
    onSettingsUpdate({ autoBackupEnabled: false });
  }, [onSettingsUpdate]);

  const reconnect = useCallback(async (): Promise<boolean> => {
    if (!handle) return false;
    const perm = await requestBackupPermission(handle);
    if (perm !== 'granted' && perm !== 'unsupported') {
      setBackupStatus('needs-reauth');
      return false;
    }
    return doRun(handle);
  }, [handle, doRun]);

  const runNow = useCallback(async (): Promise<boolean> => {
    if (!handle) return false;
    const perm = await queryBackupPermission(handle);
    if (perm !== 'granted' && perm !== 'unsupported') {
      return reconnect();
    }
    return doRun(handle);
  }, [handle, doRun, reconnect]);

  return {
    backupStatus,
    backupError,
    lastAutoBackupAt,
    directoryName,
    hasBackupHandle: handle !== null,
    chooseDirectory,
    disconnect,
    runNow,
    reconnect,
  };
}
