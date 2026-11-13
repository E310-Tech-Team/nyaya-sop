import { describe, expect, it } from 'vitest';
import { validPayload } from '../shared/test-fixtures';
import { emptyDraft, STEPS, type Draft } from '../state/application';
import { answeredCount, progressLabel, stepForPath, stepIndex, stepState } from './progress';

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

describe('answered questions in a step', () => {
  const filled = (): Draft => {
    const { fullName, email, phone, gender, ageRange, stateOfResidence, city, parishName } = validPayload();
    return { ...emptyDraft(), personal: { fullName, email, phone, gender, ageRange, stateOfResidence, city, parishName } };
  };

  it('counts the Personal step’s questions that have a valid answer', () => {
    expect(answeredCount('personal', emptyDraft())).toEqual({ answered: 0, total: 8 });
    expect(answeredCount('personal', filled())).toEqual({ answered: 8, total: 8 });
  });

  it('agrees with the step’s own checks: an answer with an error isn’t counted', () => {
    const draft = filled();
    expect(answeredCount('personal', { ...draft, personal: { ...draft.personal, email: 'not an email' } })).toEqual({ answered: 7, total: 8 });
    // In directory mode, typed parish text is never an answer.
    expect(answeredCount('personal', { ...draft, parishMode: 'directory' })).toEqual({ answered: 7, total: 8 });
  });

  it('shows no count on short steps or on review', () => {
    expect(answeredCount('education', emptyDraft())).toBeNull();
    expect(answeredCount('purpose', emptyDraft())).toBeNull();
    expect(answeredCount('review', filled())).toBeNull();
  });
});
