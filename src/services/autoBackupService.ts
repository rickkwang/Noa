import { Folder, Note } from '../types';
import { buildBackupPayload, writeSnapshotToDirectory } from '../lib/export';
import { validateExportData } from '../lib/dataIntegrity';
import { markExported } from '../lib/exportTimestamp';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { lsGet, lsSet } from '../lib/safeLocalStorage';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_FILENAME_PREFIX = 'noa-backup-';
const BACKUP_FILENAME_SUFFIX = '.json';
export const DEFAULT_KEEP_BACKUPS = 7;

/** Whether enough time has passed since the last automatic backup to run another one. */
export function shouldRunAutoBackup(lastAutoBackupAt: string | null, nowMs = Date.now()): boolean {
  if (!lastAutoBackupAt) return true;
  const last = Date.parse(lastAutoBackupAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= ONE_DAY_MS;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Build a filename like `noa-backup-2026-04-20-1130.json`. The date fields are
 * laid out so lexicographic string compare matches chronological order, which
 * lets pruneOldBackups sort by filename without parsing.
 */
export function buildBackupFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `${BACKUP_FILENAME_PREFIX}${y}-${m}-${d}-${hh}${mm}${BACKUP_FILENAME_SUFFIX}`;
}

/**
 * Delete all but the N most recent backup files in the directory.
 * Uses Promise.allSettled so one failed removeItem doesn't strand the rest —
 * same pattern as storage.pruneOrphanedNotes.
 */
export async function pruneOldBackups(
  dirHandle: FileSystemDirectoryHandle,
  keepN = DEFAULT_KEEP_BACKUPS,
): Promise<{ deleted: number; failed: number }> {
  const filenames: string[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    if (!name.startsWith(BACKUP_FILENAME_PREFIX)) continue;
    if (!name.endsWith(BACKUP_FILENAME_SUFFIX)) continue;
    filenames.push(name);
  }
  // Lexicographic descending == chronologically newest first (see filename format).
  filenames.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const stale = filenames.slice(keepN);
  if (stale.length === 0) return { deleted: 0, failed: 0 };
  const results = await Promise.allSettled(stale.map((name) => dirHandle.removeEntry(name)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { deleted: stale.length - failed, failed };
}

export type AutoBackupResult =
  | { ok: true; filename: string; pruned: number }
  | { ok: false; reason: 'validation_failed' | 'write_failed' | 'permission_denied'; detail?: string };

/**
 * Run one complete backup cycle: validate → write file → prune → mark success.
 * Caller must ensure the directory handle is authorized (see queryBackupPermission).
 */
export async function runAutoBackup(
  dirHandle: FileSystemDirectoryHandle,
  notes: Note[],
  folders: Folder[],
  workspaceName: string,
  keepN = DEFAULT_KEEP_BACKUPS,
): Promise<AutoBackupResult> {
  const report = validateExportData(notes, folders);
  if (!report.ok) {
    return { ok: false, reason: 'validation_failed', detail: report.issues[0]?.message };
  }
  const filename = buildBackupFilename();
  let payload;
  try {
    payload = await buildBackupPayload(notes, folders, workspaceName);
  } catch (err) {
    return { ok: false, reason: 'write_failed', detail: err instanceof Error ? err.message : String(err) };
  }
  try {
    await writeSnapshotToDirectory(dirHandle, filename, payload);
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, reason: 'permission_denied', detail: err instanceof Error ? err.message : undefined };
    }
    return { ok: false, reason: 'write_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  let pruned = 0;
  try {
    const { deleted } = await pruneOldBackups(dirHandle, keepN);
    pruned = deleted;
  } catch {
    // Pruning failure is non-fatal; the write already succeeded.
  }

  // Update both the automatic-backup timestamp and the shared "last export"
  // marker so the existing BackupReminderBar and backupHealth helpers see
  // a successful write regardless of which path (manual or auto) produced it.
  lsSet(STORAGE_KEYS.LAST_AUTO_BACKUP_AT, new Date().toISOString());
  lsSet(STORAGE_KEYS.AUTO_BACKUP_LAST_ERROR, '');
  markExported();
  try {
    window.dispatchEvent(new Event('redaction-exported'));
  } catch {
    // dispatchEvent can throw in non-browser test environments; harmless.
  }

  return { ok: true, filename, pruned };
}

export function getLastAutoBackupAt(): string | null {
  const raw = lsGet(STORAGE_KEYS.LAST_AUTO_BACKUP_AT);
  return raw || null;
}

export function getAutoBackupLastError(): string | null {
  const raw = lsGet(STORAGE_KEYS.AUTO_BACKUP_LAST_ERROR);
  return raw || null;
}

export function recordAutoBackupError(message: string): void {
  lsSet(STORAGE_KEYS.AUTO_BACKUP_LAST_ERROR, message);
}
