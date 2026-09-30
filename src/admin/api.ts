/**
 * The admin API (server/admin/*, server/auth/staff-routes.ts). Changes carry the staff CSRF
 * token; a 401 means the session ended, so the admin area returns to sign-in.
 */
import { ApiError, apiRequest, type RequestOptions } from '../lib/api';
import type { StaffRole } from '../shared/permissions';
import type { ApplicationStatus, NotificationTopic, SessionSummary } from '../shared/platform';
import { staffSessionEnded, type StaffSession } from './session';

async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const unsafe = options.method && options.method !== 'GET';
  try {
    return await apiRequest<T>(`/admin${path}`, { ...options, csrf: unsafe ? 'staff' : undefined });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && !path.startsWith('/login') && !path.startsWith('/mfa/verify')) staffSessionEnded();
    throw error;
  }
}
const post = <T>(path: string, json?: unknown) => call<T>(path, { method: 'POST', json });
const patch = <T>(path: string, json: unknown) => call<T>(path, { method: 'PATCH', json });
const query = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};
const id = (value: string) => encodeURIComponent(value);

export type Paged<T> = { page: number; pageSize: number; total: number; items: T[] };

// ── Types (mirroring the server's JSON) ───────────────────────────────────────

export type ApplicantRow = {
  id: string;
  reference: string;
  fullName: string;
  email: string;
  location: string;
  cohortName: string;
  submittedAt: string;
  status: ApplicationStatus;
  publishedStatus: ApplicationStatus;
  reviewer: { id: string; name: string | null } | null;
  claimed: boolean;
  notes: number;
};

export type ApplicantDetail = {
  id: string;
  reference: string;
  cohort: { id: string; name: string; slug: string };
  submittedAt: string;
  personal: Record<'fullName' | 'email' | 'phone' | 'gender' | 'ageRange' | 'stateOfResidence' | 'city', string> & { parishName: string | null };
  education: { educationLevel: string; currentStatus: string };
  purposeClarity: string;
  consent: { version: string; at: string };
  attribution: Record<'utmSource' | 'utmMedium' | 'utmCampaign' | 'referrer', string | null>;
  status: ApplicationStatus;
  allowedTransitions: ApplicationStatus[];
  published: { status: ApplicationStatus; label: string; message: string | null; at: string | null };
  reviewer: { id: string; name: string | null } | null;
  account: { email: string; status: string; claimedAt: string } | null;
  notes: { id: string; body: string; createdAt: string; author: string }[];
  history: { kind: 'review' | 'publication'; from_status: ApplicationStatus | null; to_status: ApplicationStatus; created_at: string; actor: string | null }[];
};

export type AccountRow = { id: string; email: string; status: 'active' | 'suspended'; createdAt: string; lastLoginAt: string | null; applications: number; devices: number };
export type AccountDetail = {
  id: string;
  email: string;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt: string | null;
  suspendedAt: string | null;
  activeSessions: number;
  applications: { id: string; reference: string; cohort: string; publishedStatus: ApplicationStatus; claimedAt: string }[];
  devices: { id: string; label: string; topics: NotificationTopic[]; status: string; createdAt: string; lastSeenAt: string }[];
};

export type Cohort = {
  id: string;
  slug: string;
  name: string;
  edition: number;
  opensAt: string | null;
  closesAt: string | null;
  acceptingApplications: boolean;
  isOpenNow: boolean;
  createdAt: string;
  totals: Partial<Record<ApplicationStatus, number>>;
  total: number;
};

export type Audience = { cohortIds: string[]; publishedStatuses: ApplicationStatus[] };
export type AudienceCount = { devices: number; linkedDevices: number; anonymousDevices: number; accountsWithDevices: number; inboxAccounts: number };
export type CampaignStats = {
  devices: number;
  queued: number;
  attempted: number;
  acceptedByPushService: number;
  failed: number;
  expired: number;
  skipped: number;
  inboxEntries: number;
  recordedClicks: number;
};
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
export type Campaign = {
  id: string;
  title: string;
  body: string;
  linkPath: string;
  topic: NotificationTopic;
  audience: Audience;
  alsoInbox: boolean;
  ttlHours: number;
  status: CampaignStatus;
  scheduledFor: string | null;
  timeZone: string;
  frozenAt: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
};
export type CampaignInput = { title: string; body: string; linkPath: string; topic: NotificationTopic; audience: Audience; alsoInbox: boolean; ttlHours: number };

export type AnnouncementRow = {
  id: string;
  audience: 'public' | 'applicants';
  cohort: { id: string; name: string | null } | null;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
  updatedAt: string;
};

export type StaffRow = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: 'invited' | 'active' | 'suspended';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  lockedUntil: string | null;
};

export type Health = {
  database: 'ok' | 'error';
  email: { transport: 'smtp' | 'outbox' | 'none'; canSend: boolean };
  push: { configured: boolean; publicKeyFingerprint: string | null };
  worker: { mode: 'inline' | 'off'; lastHeartbeat: string | null; healthy: boolean };
  queue: { pending: number; running: number; failedLast7Days: number; oldestPendingAt: string | null };
  siteOrigin: string | null;
  mfaRequired: boolean;
  buildId: string;
};
export type Settings = {
  support_email: string | null;
  applicant_accounts_enabled: boolean;
  public_notifications_enabled: boolean;
  parish_directory_enabled: boolean;
};

export type AuditRow = {
  id: string;
  at: string;
  actor: string;
  actorType: 'staff' | 'applicant' | 'system';
  action: string;
  target: { type: string; id: string | null } | null;
  details: Record<string, unknown>;
};

export type Dashboard = {
  applicationsByCohort: { cohort: string; status: ApplicationStatus; n: number }[];
  accounts: Partial<Record<'active' | 'suspended', number>>;
  subscriptions: { activeDevices: number; linkedToAccounts: number; anonymous: number; byTopic: { topic: NotificationTopic; linked: number; anonymous: number }[] };
  campaignsLast30Days: Partial<Record<CampaignStatus, number>>;
  deliveriesLast30Days: Partial<Record<'queued' | 'accepted' | 'failed' | 'expired' | 'skipped', number>>;
  productLast30Days: Record<
    | 'observedInstalls'
    | 'installPromptAccepted'
    | 'installPromptDismissed'
    | 'standaloneLaunches'
    | 'notificationOptIns'
    | 'notificationOptOuts'
    | 'recordedNotificationClicks'
    | 'applicationsSubmitted',
    number
  >;
  queue: Health['queue'] & { recentFailures: { kind: string; last_error: string | null; updated_at: string }[] };
  recentActions: { at: string; action: string; actor: string }[];
  health: Health;
};

// ── Calls ─────────────────────────────────────────────────────────────────────

export type LoginNext = 'mfa' | 'mfa_setup' | 'done';

export const adminApi = {
  // Signing in (server/auth/staff-routes.ts)
  session: () => call<StaffSession>('/session'),
  login: (email: string, password: string) => post<{ next: LoginNext; csrfToken: string }>('/login', { email, password }),
  verifyMfa: (input: { code?: string; recoveryCode?: string }) => post<{ ok: true; recoveryCodesRemaining?: number }>('/mfa/verify', input),
  startEnrolment: () => post<{ otpauthUri: string; secret: string; qrDataUrl: string }>('/mfa/enrol/start'),
  confirmEnrolment: (code: string) => post<{ recoveryCodes: string[] }>('/mfa/enrol/confirm', { code }),
  newRecoveryCodes: (code: string) => post<{ recoveryCodes: string[] }>('/mfa/recovery-codes', { code }),
  logout: () => post<{ ok: true }>('/logout'),
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: true }>('/me/password', { currentPassword, newPassword }),
  mySessions: () => call<{ sessions: SessionSummary[] }>('/me/sessions'),
  revokeMySession: (sessionId: string) => post<{ ok: true }>(`/me/sessions/${id(sessionId)}/revoke`),
  revokeMyOtherSessions: () => post<{ ok: true }>('/me/sessions/revoke-others'),
  checkInvite: (token: string) => post<{ email: string; displayName: string }>('/setup/check', { token }),
  completeInvite: (token: string, password: string) => post<{ next: LoginNext; csrfToken: string }>('/setup/complete', { token, password }),
  forgotPassword: (email: string) => post<{ message: string }>('/password/forgot', { email }),
  resetPassword: (input: { token: string; password: string; code?: string; recoveryCode?: string }) => post<{ ok: true }>('/password/reset', input),

  // Dashboard
  dashboard: (signal?: AbortSignal) => call<Dashboard>('/dashboard', { signal }),

  // Applicants
  applicants: (params: Record<string, string | number | undefined>, signal?: AbortSignal) => call<Paged<ApplicantRow>>(`/applicants${query(params)}`, { signal }),
  exportUrl: (params: Record<string, string | undefined>) => `/api/admin/applicants/export.csv${query(params)}`,
  applicant: (applicantId: string, signal?: AbortSignal) => call<ApplicantDetail>(`/applicants/${id(applicantId)}`, { signal }),
  addNote: (applicantId: string, body: string) => post<{ id: string }>(`/applicants/${id(applicantId)}/notes`, { body }),
  assign: (applicantId: string, reviewerId: string | null) => post<{ ok: true }>(`/applicants/${id(applicantId)}/assign`, { reviewerId }),
  setStatus: (applicantId: string, status: ApplicationStatus) => post<{ ok: true }>(`/applicants/${id(applicantId)}/status`, { status }),
  publish: (applicantId: string, expectedStatus: ApplicationStatus, message: string) =>
    post<{ ok: true; notified: boolean }>(`/applicants/${id(applicantId)}/publish`, { expectedStatus, message }),
  correct: (applicantId: string, changes: Record<string, string>) => post<{ ok: true; changed: string[] }>(`/applicants/${id(applicantId)}/correct`, changes),
  deleteApplicant: (applicantId: string, confirm: string) => post<{ ok: true }>(`/applicants/${id(applicantId)}/delete`, { confirm }),
  reviewers: (signal?: AbortSignal) => call<{ items: { id: string; name: string; role: StaffRole }[] }>('/reviewers', { signal }),

  // Accounts
  accounts: (params: Record<string, string | number | undefined>, signal?: AbortSignal) => call<Paged<AccountRow>>(`/accounts${query(params)}`, { signal }),
  account: (accountId: string, signal?: AbortSignal) => call<AccountDetail>(`/accounts/${id(accountId)}`, { signal }),
  suspendAccount: (accountId: string) => post<{ ok: true }>(`/accounts/${id(accountId)}/suspend`),
  reactivateAccount: (accountId: string) => post<{ ok: true }>(`/accounts/${id(accountId)}/reactivate`),
  revokeAccountSessions: (accountId: string) => post<{ ok: true }>(`/accounts/${id(accountId)}/revoke-sessions`),
  deleteAccount: (accountId: string, confirm: string) => post<{ ok: true }>(`/accounts/${id(accountId)}/delete`, { confirm }),

  // Cohorts
  cohorts: (signal?: AbortSignal) => call<{ items: Cohort[] }>('/cohorts', { signal }),
  createCohort: (input: Record<string, unknown>) => post<{ id: string }>('/cohorts', input),
  updateCohort: (cohortId: string, input: Record<string, unknown>) => patch<{ ok: true }>(`/cohorts/${id(cohortId)}`, input),

  // Campaigns
  campaigns: (signal?: AbortSignal) => call<{ items: (Campaign & { stats: CampaignStats })[] }>('/campaigns', { signal }),
  campaign: (campaignId: string, signal?: AbortSignal) =>
    call<{ campaign: Campaign; stats: CampaignStats; audience: AudienceCount | null }>(`/campaigns/${id(campaignId)}`, { signal }),
  createCampaign: (input: CampaignInput & { idempotencyKey: string }) => post<{ id: string; duplicate?: true }>('/campaigns', input),
  updateCampaign: (campaignId: string, input: CampaignInput) => patch<{ ok: true }>(`/campaigns/${id(campaignId)}`, input),
  previewAudience: (topic: NotificationTopic, audience: Audience, signal?: AbortSignal) =>
    call<AudienceCount>('/campaigns/audience-preview', { method: 'POST', json: { topic, audience }, signal }),
  testCampaign: (campaignId: string) => post<{ devices: number }>(`/campaigns/${id(campaignId)}/test`),
  scheduleCampaign: (campaignId: string, input: { when: 'now' | 'later'; localTime?: string; timeZone: string; confirmDevices: number; confirmInbox: number }) =>
    post<{ ok: true; scheduledFor: string }>(`/campaigns/${id(campaignId)}/schedule`, input),
  cancelCampaign: (campaignId: string) => post<{ ok: true }>(`/campaigns/${id(campaignId)}/cancel`),
  testDevices: (signal?: AbortSignal) => call<{ devices: { id: string; label: string; createdAt: string; lastSeenAt: string }[] }>('/test-devices', { signal }),
  addTestDevice: (subscription: PushSubscriptionJSON) => post<{ id: string }>('/test-devices', { subscription }),
  removeTestDevice: (deviceId: string) => post<{ ok: true }>(`/test-devices/${id(deviceId)}/remove`),

  // Announcements
  announcements: (signal?: AbortSignal) => call<{ items: AnnouncementRow[] }>('/announcements', { signal }),
  createAnnouncement: (input: { audience: string; cohortId: string | null; title: string; body: string }) => post<{ id: string }>('/announcements', input),
  updateAnnouncement: (announcementId: string, input: { audience: string; cohortId: string | null; title: string; body: string }) =>
    patch<{ ok: true }>(`/announcements/${id(announcementId)}`, input),
  publishAnnouncement: (announcementId: string) => post<{ ok: true }>(`/announcements/${id(announcementId)}/publish`),
  archiveAnnouncement: (announcementId: string) => post<{ ok: true }>(`/announcements/${id(announcementId)}/archive`),

  // Staff
  staff: (signal?: AbortSignal) => call<{ items: StaffRow[] }>('/staff', { signal }),
  inviteStaff: (input: { email: string; displayName: string; role: StaffRole }) => post<{ id: string; emailed: boolean; inviteUrl: string | null }>('/staff', input),
  setStaffRole: (staffId: string, role: StaffRole) => post<{ ok: true }>(`/staff/${id(staffId)}/role`, { role }),
  suspendStaff: (staffId: string) => post<{ ok: true }>(`/staff/${id(staffId)}/suspend`),
  reactivateStaff: (staffId: string) => post<{ ok: true }>(`/staff/${id(staffId)}/reactivate`),
  resetStaffMfa: (staffId: string) => post<{ ok: true }>(`/staff/${id(staffId)}/reset-mfa`),
  resendInvite: (staffId: string) => post<{ emailed: boolean; inviteUrl: string | null }>(`/staff/${id(staffId)}/resend-invite`),
  revokeStaffSessions: (staffId: string) => post<{ ok: true }>(`/staff/${id(staffId)}/revoke-sessions`),

  // Settings and audit
  settings: (signal?: AbortSignal) => call<{ settings: Settings; health: Health }>('/settings', { signal }),
  saveSettings: (changes: Partial<Settings>) => patch<{ ok: true; settings: Settings }>('/settings', changes),
  audit: (params: Record<string, string | number | undefined>, signal?: AbortSignal) => call<Paged<AuditRow>>(`/audit${query(params)}`, { signal }),
};
