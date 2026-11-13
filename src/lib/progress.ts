import { validateEducation, validatePurpose } from '../shared/validation';
import { personalErrors, STEPS, type Draft, type StepKey } from '../state/application';

export type StepState = 'done' | 'active' | 'upcoming';

export const stepForPath = (pathname: string): StepKey =>
  pathname === '/apply/review' ? 'review' : (STEPS.find((s) => s.path === pathname)?.key ?? 'personal');

/** Index of the current screen among the question sections; review comes after all of them. */
export const stepIndex = (step: StepKey): number =>
  step === 'review' ? STEPS.length : STEPS.findIndex((s) => s.key === step);

export const stepState = (index: number, current: number): StepState =>
  index < current ? 'done' : index === current ? 'active' : 'upcoming';

/**
 * Wording for the compact progress indicator. Review is not one of the question sections,
 * so it is described as its own stage rather than "Step 4 of 3".
 */
export function progressLabel(step: StepKey): { eyebrow: string; title: string } {
  if (step === 'review') return { eyebrow: `All ${STEPS.length} sections complete`, title: 'Review and submit' };
  const index = stepIndex(step);
  return { eyebrow: `Step ${index + 1} of ${STEPS.length}`, title: STEPS[index].label };
}

/** Steps with fewer questions than this show no "answered" count: it would add nothing. */
export const ANSWERED_COUNT_MIN = 3;

/** A question step's errors, from the same checks that guard its Continue button. */
const STEP_ERRORS: Record<Exclude<StepKey, 'review'>, (draft: Draft) => Record<string, unknown>> = {
  personal: personalErrors,
  education: (draft) => validateEducation(draft.education),
  purpose: (draft) => validatePurpose(draft.purpose),
};

/**
 * How many of a step's questions have a valid answer ("5 of 8 answered"), or null for review and
 * for short steps. A question with an error isn't counted, so the count agrees with the step's checks.
 */
export function answeredCount(step: StepKey, draft: Draft): { answered: number; total: number } | null {
  if (step === 'review') return null;
  const questions = Object.keys(draft[step]);
  if (questions.length < ANSWERED_COUNT_MIN) return null;
  const errors = STEP_ERRORS[step](draft);
  return { answered: questions.filter((question) => !Object.hasOwn(errors, question)).length, total: questions.length };
}
