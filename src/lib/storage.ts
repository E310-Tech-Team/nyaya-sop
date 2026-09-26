/**
 * sessionStorage helpers. Answers live only for the browser tab's lifetime, which
 * suits shared devices (church halls, cyber cafés). Storage can be unavailable
 * (private mode, blocked site data), so every call degrades to a no-op.
 */
export function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the form still works, it just won't survive a reload.
  }
}
