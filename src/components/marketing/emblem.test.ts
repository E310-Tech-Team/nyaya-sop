import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RCCG_YAYA_EMBLEM } from './emblem';

/** A WebP with alpha is RIFF…WEBP with a VP8X header: flags, then the canvas size minus one (24-bit). */
function webpHeader(path: string) {
  const file = readFileSync(path);
  expect(file.toString('ascii', 0, 4)).toBe('RIFF');
  expect(file.toString('ascii', 8, 12)).toBe('WEBP');
  expect(file.toString('ascii', 12, 16)).toBe('VP8X');
  return { alpha: (file[20]! & 0x10) !== 0, width: file.readUIntLE(24, 3) + 1, height: file.readUIntLE(27, 3) + 1 };
}

describe('the footer emblem', () => {
  it('is transparent, three times its display size, in the same proportions', () => {
    const file = webpHeader('src/assets/brand/rccg-yaya-emblem.webp');
    expect(file.alpha).toBe(true);
    expect(file.height).toBe(RCCG_YAYA_EMBLEM.height * 3);
    expect(Math.abs(file.width - RCCG_YAYA_EMBLEM.width * 3)).toBeLessThanOrEqual(2);
  });

  it('comes from the logo as supplied, which stays in the repository', () => {
    expect(readFileSync('design/brand/partners/rccg-yaya-supplied.webp').length).toBeGreaterThan(0);
    expect(readFileSync('design/brand/partners/rccg-yaya-transparent.png').length).toBeGreaterThan(0);
  });
});
