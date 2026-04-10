import { AppErrorCode, RecoveryAction } from '../types';
import { lsGetJson, lsSetJson } from './safeLocalStorage';

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
  const current = lsGetJson<ErrorSnapshot[]>(KEY) ?? [];
  const next = [snapshot, ...current].slice(0, MAX);
  lsSetJson(KEY, next);
}
