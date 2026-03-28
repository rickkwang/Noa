import { AppErrorCode, RecoveryAction } from '../types';

const KEY = 'redaction-error-snapshots';
const MAX = 20;

export interface ErrorSnapshot {
  at: string;
  operation: string;
  code: AppErrorCode;
  message: string;
  suggestedAction: RecoveryAction;
}

export function recordErrorSnapshot(snapshot: ErrorSnapshot): void {
  try {
    const raw = localStorage.getItem(KEY);
    const current: ErrorSnapshot[] = raw ? JSON.parse(raw) : [];
    const next = [snapshot, ...current].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort only; never block user flow.
  }
}
