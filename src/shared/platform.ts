/**
 * Accounts, notifications, campaigns and analytics: rules shared by the browser and the server.
 * Keep this module free of DOM, React and Node imports.
 */
import type { StaffRole } from './permissions';

// ── Applicant-facing application status ─────────────────────────────────────

export const APPLICATION_STATUSES = ['submitted', 'under_review', 'shortlisted', 'invited', 'not_selected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** What an applicant sees once a status is published. Neutral wording, no internal detail. */
export const PUBLISHED_STATUS_LABELS: Record<ApplicationStatus, { label: string; description: string }> = {
  submitted: { label: 'Received', description: 'We have your application. The Programme team reviews every application.' },
  under_review: { label: 'Under review', description: 'The Programme team is reviewing your application.' },
  shortlisted: { label: 'Shortlisted', description: 'Your application has been shortlisted.' },
  invited: { label: 'Invited to the next stage', description: 'You have been invited to the next stage of the programme.' },
  not_selected: { label: 'Not selected', description: 'Your application was not selected this time.' },
  withdrawn: { label: 'Withdrawn', description: 'This application has been withdrawn.' },
};

/** Internal review states staff see. */
export const REVIEW_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: 'New',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  invited: 'Invited',
  not_selected: 'Not selected',
  withdrawn: 'Withdrawn',
};

/** Allowed review-status changes (the server rejects anything else). */
export const REVIEW_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  submitted: ['under_review', 'withdrawn'],
  under_review: ['shortlisted', 'not_selected', 'withdrawn'],
  shortlisted: ['invited', 'not_selected', 'under_review', 'withdrawn'],
  invited: ['withdrawn'],
  not_selected: ['under_review'],
  withdrawn: [],
};

export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
  APPLICATION_STATUSES.includes(value as ApplicationStatus);

// ── Notifications ────────────────────────────────────────────────────────────

export const NOTIFICATION_TOPICS = ['general', 'application', 'training'] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export const TOPIC_DETAILS: Record<NotificationTopic, { label: string; description: string; requiresAccount: boolean }> = {
  general: {
    label: 'Programme announcements',
    description: 'Important news about Purpose Boot Camp, for everyone.',
    requiresAccount: false,
  },
  application: {
    label: 'Application updates',
    description: 'A short alert when there is an update to your application. Needs a verified account.',
    requiresAccount: true,
  },
  training: {
    label: 'Training reminders',
    description: 'Reminders about virtual training, if you take part. Needs a verified account.',
    requiresAccount: true,
  },
};

export const isNotificationTopic = (value: unknown): value is NotificationTopic =>
  NOTIFICATION_TOPICS.includes(value as NotificationTopic);

/** Separate from the application's contact consent. Stored with every subscription change. */
export const NOTIFICATION_CONSENT_VERSION = 'push-2026-09-v1';
export const NOTIFICATION_CONSENT_STATEMENT =
  'Send notifications about the topics I choose to this device. I can change these or turn them off at any time.';

/** What a lock screen shows for an application update: never the decision itself. */
export const APPLICATION_UPDATE_NOTIFICATION = {
  title: 'School of Purpose',
  body: 'There is an update to your application. Open School of Purpose to view it.',
  linkPath: '/account/application',
} as const;

/**
 * Where a notification may take someone: same-origin paths only, from this list. Paths
 * under /account need a signed-in applicant (the account pages check).
 */
export const NOTIFICATION_LINK_PATHS = [
  '/',
  '/about',
  '/programme',
  '/journey',
  '/faq',
  '/updates',
  '/install',
  '/notifications',
  '/account',
  '/account/application',
  '/account/notifications',
] as const;

export const isAllowedNotificationPath = (path: unknown): path is string =>
  typeof path === 'string' && (NOTIFICATION_LINK_PATHS as readonly string[]).includes(path);

export const CAMPAIGN_LIMITS = { title: 65, body: 180, ttlMinSeconds: 300, ttlMaxSeconds: 2_419_200 } as const;

// ── Analytics (allowlisted, no identifiers) ──────────────────────────────────

export const ANALYTICS_EVENTS = [
  'application_submitted',
  'install_prompt_available',
  'install_prompt_accepted',
  'install_prompt_dismissed',
  'app_installed',
  'standalone_launch',
  'push_opt_in',
  'push_opt_out',
  'notification_click',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Coarse properties only. The server drops anything else. */
export type AnalyticsProperties = {
  platform?: 'android' | 'ios' | 'desktop' | 'other';
  displayMode?: 'browser' | 'standalone';
  messageId?: string;
};

// ── API shapes ───────────────────────────────────────────────────────────────

export type PublicConfig = {
  accounts: { enabled: boolean };
  push: { enabled: boolean; publicKey: string | null };
  supportEmail: string | null;
  buildId: string;
};

export type AccountSummary = { email: string; createdAt: string };

export type ApplicantApplication = {
  id: string;
  reference: string;
  cohortName: string;
  submittedAt: string;
  status: ApplicationStatus;
  statusLabel: string;
  statusDescription: string;
  message: string | null;
  publishedAt: string | null;
};

export type ClaimableApplication = { id: string; reference: string; cohortName: string; submittedAt: string };

export type InboxItem = {
  id: string;
  kind: 'application_update' | 'message' | 'notice';
  title: string;
  body: string;
  linkPath: string | null;
  createdAt: string;
  read: boolean;
};

export type DeviceSummary = {
  id: string;
  label: string;
  topics: NotificationTopic[];
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type SessionSummary = { id: string; deviceLabel: string; createdAt: string; lastSeenAt: string; current: boolean };

export type StaffSummary = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  mfaEnabled: boolean;
};

export type PushSubscriptionJson = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type PushDeviceState = {
  id: string;
  status: 'active' | 'expired' | 'revoked';
  topics: NotificationTopic[];
  linkedToAccount: boolean;
};

export type Announcement = { id: string; title: string; body: string; publishedAt: string };
