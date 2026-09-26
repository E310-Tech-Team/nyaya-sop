import { STEPS, type StepKey } from '../state/application';

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
