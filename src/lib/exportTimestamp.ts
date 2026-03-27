const KEY = 'redaction-last-export-at';

export function markExported(): void {
  localStorage.setItem(KEY, new Date().toISOString());
  window.dispatchEvent(new Event('redaction-exported'));
}

export function getLastExportAt(): string | null {
  return localStorage.getItem(KEY);
}
