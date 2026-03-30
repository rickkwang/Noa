import { STORAGE_KEYS } from '../constants/storageKeys';

const KEY = STORAGE_KEYS.LAST_EXPORT_AT;

export function markExported(): void {
  localStorage.setItem(KEY, new Date().toISOString());
  window.dispatchEvent(new Event('redaction-exported'));
}

export function getLastExportAt(): string | null {
  return localStorage.getItem(KEY);
}

export function formatExportTimestamp(iso: string | null): string {
  if (!iso) return 'Never exported';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown export time';
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
