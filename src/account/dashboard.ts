import { PUBLISHED_STATUS_LABELS, type ApplicationStatus } from '../shared/platform';

/**
 * The applicant dashboard (/account): progress, what happens next and the to-do list, worked out
 * from what the account already receives (published statuses only, never the internal review).
 * Copy stays to confirmed facts (src/config/programme.ts): no dates, response times or criteria.
 */

/** The published stages an application moves through, in order. */
export const PROGRESS_STATUSES = ['submitted', 'under_review', 'shortlisted', 'invited'] as const satisfies readonly ApplicationStatus[];

export type StepState = 'done' | 'current' | 'upcoming';
export type ProgressStep = { status: ApplicationStatus; label: string; state: StepState };

/**
 * The stepper for an application, or null once it has left the path ("Not selected", "Withdrawn"):
 * a published decision doesn't say which stage it was reached at, so none is drawn as reached.
 */
export function progressSteps(status: ApplicationStatus): ProgressStep[] | null {
  const current = (PROGRESS_STATUSES as readonly ApplicationStatus[]).indexOf(status);
  if (current < 0) return null;
  return PROGRESS_STATUSES.map((step, index) => ({
    status: step,
    label: PUBLISHED_STATUS_LABELS[step].label,
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
  }));
}

const UPDATES_HERE = 'When there’s news, it appears on this page and in your messages.';
const WATCH_MESSAGES = 'Instructions from the Programme team appear in their message on this page and in your messages.';

// Each line adds to the status description shown above it, never repeats it.
const NEXT_STEPS: Record<ApplicationStatus, string | null> = {
  submitted: UPDATES_HERE,
  under_review: UPDATES_HERE,
  shortlisted: WATCH_MESSAGES,
  invited: WATCH_MESSAGES,
  not_selected: 'Thank you for applying. Programme news is posted on the Updates page.',
  withdrawn: null,
};

/** One line on what happens next for a published status (null when there's nothing to add). */
export const nextStep = (status: ApplicationStatus): string | null => NEXT_STEPS[status];

/** What this device can do for notifications, from usePushDevice. */
export type NotificationReadiness = 'on' | 'off' | 'install-required' | 'unavailable';

/** Each field is undefined while it loads: its item is left out rather than guessed. */
export type ChecklistInput = {
  claimed?: number;
  claimable?: number;
  unread?: number;
  notifications?: NotificationReadiness;
};

export type ChecklistItem = { id: 'application' | 'notifications' | 'messages'; label: string; done: boolean; to?: string };

function applicationItem(claimed: number, claimable: number): ChecklistItem {
  if (claimed > 0) return { id: 'application', label: 'Your application is linked to this account', done: true };
  if (claimable > 0) return { id: 'application', label: 'Link your application to this account', done: false, to: '/account/application' };
  return { id: 'application', label: 'Send your application', done: false, to: '/apply' };
}

function notificationsItem(readiness: NotificationReadiness): ChecklistItem | null {
  const to = '/account/notifications';
  if (readiness === 'on') return { id: 'notifications', label: 'Notifications are on for this device', done: true };
  if (readiness === 'off') return { id: 'notifications', label: 'Turn on notifications on this device', done: false, to };
  if (readiness === 'install-required') {
    return { id: 'notifications', label: 'Add School of Purpose to your Home Screen to get notifications', done: false, to };
  }
  return null;
}

function messagesItem(unread: number): ChecklistItem {
  const to = '/account/notifications';
  if (unread === 0) return { id: 'messages', label: 'You’ve read all your messages', done: true };
  return { id: 'messages', label: unread === 1 ? 'Read your new message' : `Read your ${unread} new messages`, done: false, to };
}

/** The dashboard's to-do list, in a fixed order. */
export function checklist(input: ChecklistInput): ChecklistItem[] {
  const items: (ChecklistItem | null)[] = [
    input.claimed !== undefined && input.claimable !== undefined ? applicationItem(input.claimed, input.claimable) : null,
    input.notifications !== undefined ? notificationsItem(input.notifications) : null,
    input.unread !== undefined ? messagesItem(input.unread) : null,
  ];
  return items.filter((item): item is ChecklistItem => item !== null);
}
