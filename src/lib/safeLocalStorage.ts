/**
 * Safe wrappers around localStorage that handle:
 *  - Private/incognito browsing (SecurityError)
 *  - Storage quota exceeded (QuotaExceededError)
 *  - Any other unexpected errors
 *
 * All functions are synchronous and never throw.
 */

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function lsGetBoolean(key: string): boolean {
  return lsGet(key) === 'true';
}

export function lsSetBoolean(key: string, value: boolean): boolean {
  return lsSet(key, String(value));
}

/** Read a JSON value, returning `null` on any error. */
export function lsGetJson<T>(key: string): T | null {
  const raw = lsGet(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function lsSetJson(key: string, value: unknown): boolean {
  try {
    return lsSet(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
