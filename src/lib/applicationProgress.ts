import { PUBLISHED_STATUS_LABELS, type ApplicationStatus } from '../shared/platform';

/**
 * Where an application is on its published path, for the success screen and the applicant
 * dashboard. Published statuses only, never the internal review. (The form's own steps are
 * src/lib/progress.ts.)
 */

/** The published stages an application moves through, in order. */
export const PROGRESS_STATUSES = ['submitted', 'under_review', 'shortlisted', 'invited'] as const satisfies readonly ApplicationStatus[];

export type StepState = 'done' | 'current' | 'upcoming';
export type ProgressStep = { status: ApplicationStatus; label: string; state: StepState; date?: string };

/** What the account knows about timing: when the application was sent and when its status was published. */
export type ProgressDates = { submittedAt?: string; publishedAt?: string | null };

function dateFor(index: number, current: number, dates: ProgressDates | undefined): string | undefined {
  if (index === 0) return dates?.submittedAt;
  // Only the current stage has a known date (its publication); stages passed on the way have none.
  if (index === current) return dates?.publishedAt ?? undefined;
  return undefined;
}

/**
 * The stepper for an application, or null once it has left the path ("Not selected", "Withdrawn"):
 * a published decision doesn't say which stage it was reached at, so none is drawn as reached.
 */
export function progressSteps(status: ApplicationStatus, dates?: ProgressDates): ProgressStep[] | null {
  const current = (PROGRESS_STATUSES as readonly ApplicationStatus[]).indexOf(status);
  if (current < 0) return null;
  return PROGRESS_STATUSES.map((step, index) => {
    const date = dateFor(index, current, dates);
    return {
      status: step,
      label: PUBLISHED_STATUS_LABELS[step].label,
      state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
      ...(date ? { date } : {}),
    };
  });
}
