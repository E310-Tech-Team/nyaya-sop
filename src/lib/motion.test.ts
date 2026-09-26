import { describe, expect, it } from 'vitest';
import { MOTION, enterAfter, enterStep, staggerDelay } from './motion';

describe('motion tokens', () => {
  it('staggers in 50–80ms steps and caps each group at 240ms', () => {
    expect(MOTION.staggerStepMs).toBeGreaterThanOrEqual(50);
    expect(MOTION.staggerStepMs).toBeLessThanOrEqual(80);
    expect([0, 1, 2, 3, 4, 5, 10].map(staggerDelay)).toEqual([0, 60, 120, 180, 240, 240, 240]);
    expect(staggerDelay(-2)).toBe(0);
  });

  it('exposes delays as a CSS custom property for the entrance classes', () => {
    expect(enterStep(2)).toEqual({ '--enter-delay': '120ms' });
    expect(enterStep(9)).toEqual({ '--enter-delay': '240ms' });
    expect(enterAfter(360)).toEqual({ '--enter-delay': '360ms' });
  });
});
