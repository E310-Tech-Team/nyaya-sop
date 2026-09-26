type ClipboardLike = { writeText: (text: string) => Promise<void> };

const browserClipboard = (): ClipboardLike | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.clipboard;

/**
 * Copies text with the async Clipboard API. Resolves to false instead of throwing when
 * copying isn't possible (no Clipboard API, a non-secure page, or permission denied), so the
 * caller can fall back to selecting the text for a manual copy.
 */
export async function copyText(text: string, clipboard: ClipboardLike | undefined = browserClipboard()): Promise<boolean> {
  if (typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
