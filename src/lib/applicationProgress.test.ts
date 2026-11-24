import { describe, expect, it } from 'vitest';
import { PUBLISHED_STATUS_LABELS } from '../shared/platform';
import { progressSteps, PROGRESS_STATUSES } from './applicationProgress';

describe('application progress', () => {
  it('walks the published stages in order, with the applicant’s labels', () => {
    expect(PROGRESS_STATUSES).toEqual(['submitted', 'under_review', 'shortlisted', 'invited']);
    expect(progressSteps('submitted')!.map((step) => step.label)).toEqual(
      PROGRESS_STATUSES.map((status) => PUBLISHED_STATUS_LABELS[status].label),
    );
  });

  it('marks the stages before the current one done and the rest upcoming', () => {
    expect(progressSteps('shortlisted')!.map((step) => step.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(progressSteps('submitted')!.map((step) => step.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(progressSteps('invited')!.map((step) => step.state)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('shows no stepper for an application that has left the path', () => {
    // A published "Not selected" doesn't say how far it got, so no stage is drawn as reached.
    expect(progressSteps('not_selected')).toBeNull();
    expect(progressSteps('withdrawn')).toBeNull();
  });

  it('dates only what is known: when it was sent, and when the current stage was published', () => {
    const dates = { submittedAt: '2026-11-03T12:56:51.905Z', publishedAt: '2026-11-10T09:00:00.000Z' };
    expect(progressSteps('shortlisted', dates)!.map((step) => step.date ?? null)).toEqual([dates.submittedAt, null, dates.publishedAt, null]);
    // Stages passed on the way have no date of their own: none is invented.
    expect(progressSteps('submitted', dates)!.map((step) => step.date ?? null)).toEqual([dates.submittedAt, null, null, null]);
    expect(progressSteps('under_review', { submittedAt: dates.submittedAt, publishedAt: null })!.map((step) => step.date ?? null)).toEqual([
      dates.submittedAt,
      null,
      null,
      null,
    ]);
    expect(progressSteps('submitted')!.every((step) => step.date === undefined)).toBe(true);
  });
});
