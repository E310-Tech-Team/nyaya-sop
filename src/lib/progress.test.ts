import { describe, expect, it } from 'vitest';
import { STEPS } from '../state/application';
import { progressLabel, stepForPath, stepIndex, stepState } from './progress';

describe('application progress', () => {
  it('labels the three question sections "Step N of 3"', () => {
    expect(progressLabel('personal')).toEqual({ eyebrow: 'Step 1 of 3', title: 'Personal Information' });
    expect(progressLabel('education')).toEqual({ eyebrow: 'Step 2 of 3', title: 'Education & Career' });
    expect(progressLabel('purpose')).toEqual({ eyebrow: 'Step 3 of 3', title: 'Purpose & Self-Discovery' });
  });

  it('describes review as its own stage, with every section complete', () => {
    expect(progressLabel('review')).toEqual({ eyebrow: 'All 3 sections complete', title: 'Review and submit' });
    const current = stepIndex('review');
    expect(STEPS.map((_, i) => stepState(i, current))).toEqual(['done', 'done', 'done']);
  });

  it('marks earlier sections done and later ones upcoming', () => {
    const current = stepIndex('education');
    expect(STEPS.map((_, i) => stepState(i, current))).toEqual(['done', 'active', 'upcoming']);
  });

  it('maps routes to steps', () => {
    expect(stepForPath('/apply/education')).toBe('education');
    expect(stepForPath('/apply/review')).toBe('review');
  });
});
