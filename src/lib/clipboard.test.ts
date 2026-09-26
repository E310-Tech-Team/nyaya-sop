import { describe, expect, it } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  it('copies with the Clipboard API', async () => {
    let copied = '';
    await expect(copyText('SOP-7F3A9C2B', { writeText: async (text) => void (copied = text) })).resolves.toBe(true);
    expect(copied).toBe('SOP-7F3A9C2B');
  });

  it('reports failure instead of throwing when permission is denied', async () => {
    const denied = { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) };
    await expect(copyText('SOP-7F3A9C2B', denied)).resolves.toBe(false);
  });

  it('reports failure when there is no Clipboard API (e.g. a non-secure page)', async () => {
    await expect(copyText('SOP-7F3A9C2B', undefined)).resolves.toBe(false);
  });
});
