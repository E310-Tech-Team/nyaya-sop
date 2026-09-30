import { describe, expect, it } from 'vitest';
import { sectionFromHash } from './landing';

describe('sectionFromHash', () => {
  it('reads the section a deep link names', () => {
    expect(sectionFromHash('#journey')).toBe('journey');
    expect(sectionFromHash('#what%20to%20expect')).toBe('what to expect');
    expect(sectionFromHash('')).toBeNull();
    expect(sectionFromHash('#')).toBeNull();
  });

  it('ignores a malformed fragment instead of crashing the page (security audit)', () => {
    for (const hash of ['#%', '#%E0%A4%A', '#abc%zz']) expect(sectionFromHash(hash)).toBeNull();
  });
});
