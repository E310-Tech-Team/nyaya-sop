import type { BadgeTone } from '../components/ui';
import type { ApplicationStatus } from '../shared/platform';

/** Calm colours for published statuses (a "Not selected" is never shown in alarm red). */
export const STATUS_TONE: Record<ApplicationStatus, BadgeTone> = {
  submitted: 'neutral',
  under_review: 'brand',
  shortlisted: 'success',
  invited: 'success',
  not_selected: 'neutral',
  withdrawn: 'neutral',
};
