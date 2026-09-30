/**
 * The admin API (server/admin/*, server/auth/staff-routes.ts). Changes carry the staff CSRF
 * token; a 401 means the session ended, so the admin area returns to sign-in.
 */
import { ApiError, apiRequest, type RequestOptions } from '../lib/api';
import type { ChainUnit, ChurchLevel, ParishChain, ParishDetailsResponse, ParishSuggestion } from '../shared/directory';
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
  parish: { status: ParishAnswerStatus; answer: string | null; linked: { id: string; name: string; place: string | null } | null };
};

/** How the applicant answered the parish question (applications.parish_status). */
export type ParishAnswerStatus = 'listed' | 'reported' | 'legacy_text' | 'not_provided';

export type ParishReport = {
  id: string;
  kind: 'not_listed' | 'details_wrong' | 'lookalike';
  status: 'pending' | 'linked' | 'added' | 'fixed' | 'rejected';
  reportedName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedParish: string | null;
};

export type ApplicantParish = {
  status: ParishAnswerStatus;
  answer: string | null;
  current: ParishDetailsResponse | null;
  /** `lookalikes`: the applicant chose one of this many same-named parishes (D-55), or null. */
  submitted: { parish: ChainUnit; chain: ParishChain; lookalikes: number | null } | null;
  linkedBy: { name: string; at: string } | null;
  textReviewedAt: string | null;
  reports: ParishReport[];
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
  parish: ApplicantParish;
};

// ── Parish directory (server/admin/directory.ts) ─────────────────────────────

export type DirectoryStatus = 'active' | 'inactive' | 'merged';
export type UnitBrief = { id: string; name: string; level: ChurchLevel };

export type DirectoryReadiness = {
  levels: Record<ChurchLevel, { active: number; total: number }>;
  parishes: { active: number; inactive: number; merged: number; staffAdded: number };
  latestImport: { id: string; source: string; label: string; structureAsAt: string | null; via: string; finishedAt: string | null } | null;
  corrections: number;
  lineageWaiting: number;
  pendingReviews: number;
  /** The RCCG directory API, when it is the source: its environment and how current the copy is (never the key). */
  api: DirectoryApiStatus | null;
};

export type DirectoryApiStatus = {
  env: 'production' | 'sandbox';
  release: string | null;
  releaseName: string | null;
  effectiveFrom: string | null;
  /** When the provider last confirmed the release in use is its latest. */
  checkedAt: string | null;
  /** When a release was last applied. */
  syncedAt: string | null;
  fresh: boolean;
  freshnessHours: number;
  syncIntervalMinutes: number;
  /** A short code (e.g. api_unauthorized), never a message from the provider. */
  lastError: string | null;
  lastErrorAt: string | null;
  failures: number;
  /** The handover from the spreadsheet: its parishes with applications, compared with the API's. */
  oldList: { matched: number; ambiguous: number; unmatched: number };
};

export type BrowseChild = UnitBrief & { status: DirectoryStatus; state: string | null; origin: string; corrected: boolean; units: number; parishes: number; changed2026: boolean };
export type BrowseParish = { id: string; name: string; status: DirectoryStatus; listedRows: number; origin: string; corrected: boolean; applications: number };
export type Browse = {
  /** Entries come from the RCCG directory API: they change there, not in this screen. */
  apiManaged: boolean;
  unit: (UnitBrief & { status: DirectoryStatus; state: string | null; origin: string; corrected: string[] }) | null;
  ancestors: UnitBrief[];
  children: BrowseChild[];
  parishes: Paged<BrowseParish>;
};

export type UnitMatch = UnitBrief & { parent: string | null };

export type HistoryItem = { id: string; at: string; via: 'import' | 'staff'; change: string; before: Record<string, unknown> | null; after: Record<string, unknown>; by: string };
export type History = { items: HistoryItem[]; names: Record<string, string> };

export type UnitDetail = {
  unit: UnitBrief & {
    officialName: string;
    state: string | null;
    status: DirectoryStatus;
    origin: string;
    corrected: string[];
    mergedInto: { id: string; name: string | null } | null;
    /** "<namespace>:<canonical code>" for an entry from the RCCG directory API. */
    externalId: string | null;
  };
  apiManaged: boolean;
  ancestors: UnitBrief[];
  counts: { units: number; activeParishes: number; parishesDirectly: number; applications: number };
  lineage: { createdFrom: { name: string; level: ChurchLevel; approvedOn: string | null }[]; sourceOf: { name: string; level: ChurchLevel; approvedOn: string | null }[] };
  history: History;
};

export type ParishEntry = {
  parish: ParishDetailsResponse & {
    officialName: string;
    origin: string;
    listedRows: number;
    corrected: string[];
    unit: UnitBrief;
    listedUnder: { id: string; name: string | null } | null;
    externalId: string | null;
  };
  aliases: string[];
  applications: number;
  history: History;
  apiManaged: boolean;
};

export type ImportRow = {
  id: string;
  source: string;
  label: string;
  structureAsAt: string | null;
  status: string;
  via: string;
  by: string | null;
  startedAt: string;
  finishedAt: string | null;
  revertedAt: string | null;
  counts: Record<string, unknown>;
  error: string | null;
  issues: { error: number; warning: number; info: number };
};
export type ImportIssue = { line: number | null; severity: 'info' | 'warning' | 'error'; code: string; message: string; details: Record<string, unknown> };
export type ImportDetail = {
  import: { id: string; label: string; structureAsAt: string | null; status: string; startedAt: string; counts: Record<string, unknown> };
  codes: { code: string; severity: string; n: number }[];
  issues: Paged<ImportIssue>;
};
export type LineageGroup = { level: ChurchLevel; name: string; approvedOn: string | null; unit: { id: string; name: string } | null; sources: { name: string; unit: { id: string; name: string; status: string } | null }[] };

// ── Parish review (server/admin/parish-review.ts) ────────────────────────────

export type ReviewKind = 'not_listed' | 'details_wrong' | 'lookalike' | 'earlier_text';
/** A parish a look-alike choice could mean (server/admin/parish-review.ts `candidatesOf`). */
export type LookalikeCandidate = { id: string; name: string; code: string | null; applications: number; linked: boolean };
export type ReviewItem = {
  id: string;
  kind: ReviewKind;
  createdAt: string;
  application: { id: string; reference: string; fullName: string; state: string; cohort: string };
  name: string | null;
  parish: ParishDetailsResponse | null;
  submitted: ParishChain | null;
  suggestions: ParishSuggestion[];
  exactMatch: string | null;
  /** "Which parish?" items only: the look-alike group, first parish first. */
  candidates: LookalikeCandidate[] | null;
};
export type ReviewQueue = Paged<ReviewItem> & { counts: Record<ReviewKind, number>; kind: ReviewKind };
export type EarlierMatch = { application: ReviewItem['application']; name: string; parish: { id: string; name: string; place: string | null } };
export type ResolveAction = { action: 'link'; parishId: string } | { action: 'add'; unitId: string; name: string } | { action: 'fixed' } | { action: 'reject' };

// ── Reports (server/admin/reports.ts) ─────────────────────────────────────────

/** Null: between 1 and 4, hidden from roles that can't see applicants' details. */
export type Count = number | null;
export type StatusCounts = Record<ApplicationStatus, Count>;
type Split = { linked: Count; unlinked: Count };

/** A parish as it stands in today's directory, with its units from the continent down (the drill-down's parish view). */
export type ReportParish = {
  id: string;
  name: string;
  status: string;
  mergedInto: { id: string; name: string } | null;
  unit: UnitBrief;
  chain: UnitBrief[];
};

export type ReportSummary = {
  period: { from: string | null; to: string | null };
  unit: UnitBrief | null;
  parish: ReportParish | null;
  masked: boolean;
  applications: Count;
  uniqueApplicants: Count;
  byStatus: StatusCounts;
  byPublished: StatusCounts;
  withParish: Count;
  linkedByStaff: Count;
  withoutParish: Count;
  answers: { listed: Count; reported: Split; legacyText: Split; notProvided: Split };
  noRegion: Count;
  noProvince: Count;
  parishesRepresented: Count;
  activeParishes: number;
  waiting: { notListed: Count; detailsWrong: Count; lookalike: Count; earlierText: Count };
  comparison: { from: string; to: string; days: number; applications: Count; uniqueApplicants: Count } | null;
  directory: { importId: string; label: string; structureAsAt: string | null } | null;
};

/** Active units directly under a unit at one level, and how many of them have any of these applications. */
export type ReportChildCount = { level: ChurchLevel; count: number; withApplications: Count };

export type ReportCard = {
  key: string;
  /** A unit, a parish, the parishes directly under the unit, those missing a level, or the applications with no directory parish. */
  kind: 'unit' | 'parish' | 'direct' | 'without' | 'unassigned';
  id: string | null;
  name: string;
  level: ChurchLevel | null;
  status: string | null;
  changed2026: boolean;
  parent: UnitBrief | null;
  chain: { province: string | null; region: string | null; continent: string | null } | null;
  applications: Count;
  byStatus: StatusCounts;
  byPublished: StatusCounts;
  parishesWithApplications: Count;
  activeParishes: number | null;
  children: ReportChildCount[];
  filter: Record<string, string>;
  drill: Record<string, string> | null;
};

export type ReportListLevel = ChurchLevel | 'parish';
/** How a listing is ordered (server/admin/reports.ts LISTING_SORTS); status and parish orders only for roles that see exact counts. */
export type ReportSort = 'applications' | 'name' | 'parishes' | ApplicationStatus;
export type ReportListing = {
  mode: 'level' | 'children' | 'parishes';
  level: ReportListLevel | null;
  within: (UnitBrief & { status: string; childLevel: ChurchLevel | null }) | null;
  ancestors: UnitBrief[];
  direct: boolean;
  without: 'region' | 'province' | null;
  search: string | null;
  sort: ReportSort;
  dir: 'asc' | 'desc';
  includeAll: boolean;
  masked: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: ReportCard[];
  extras: ReportCard[];
  totals: { applications: Count; parishesWithApplications: Count };
};

export type ReportCohort = {
  id: string;
  name: string;
  edition: number;
  opensAt: string | null;
  closesAt: string | null;
  openNow: boolean;
  applications: Count;
  byStatus: StatusCounts;
  withParish: Count;
};

export type Trend = { interval: 'day' | 'week'; from: string; to: string; explicit: boolean; masked: boolean; points: { period: string; applications: Count }[] };
export type ReportsOverview = {
  masked: boolean;
  total: Count;
  unmatched: Count;
  continents: { id: string; name: string; applications: Count }[];
  topRegions: { id: string; name: string; applications: Count }[];
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
  verifyMfa: (input: { code?: string; recoveryCode?: string }) => post<{ ok: true; recoveryCodesRemaining?: number; csrfToken?: string }>('/mfa/verify', input),
  startEnrolment: () => post<{ otpauthUri: string; secret: string; qrDataUrl: string }>('/mfa/enrol/start'),
  confirmEnrolment: (code: string) => post<{ recoveryCodes: string[]; csrfToken?: string }>('/mfa/enrol/confirm', { code }),
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
  changeApplicantParish: (applicantId: string, parishId: string | null) =>
    post<{ ok: true; from: string | null; to: string | null; reportsResolved: number }>(`/applicants/${id(applicantId)}/parish`, { parishId }),
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
  unlockStaff: (staffId: string) => post<{ ok: true }>(`/staff/${id(staffId)}/unlock`),
  resendInvite: (staffId: string) => post<{ emailed: boolean; inviteUrl: string | null }>(`/staff/${id(staffId)}/resend-invite`),
  revokeStaffSessions: (staffId: string) => post<{ ok: true }>(`/staff/${id(staffId)}/revoke-sessions`),

  // Settings and audit
  settings: (signal?: AbortSignal) => call<{ settings: Settings; health: Health; directory: DirectoryReadiness }>('/settings', { signal }),
  saveSettings: (changes: Partial<Settings>) => patch<{ ok: true; settings: Settings }>('/settings', changes),
  audit: (params: Record<string, string | number | undefined>, signal?: AbortSignal) => call<Paged<AuditRow>>(`/audit${query(params)}`, { signal }),

  // Parish directory
  directoryOverview: (signal?: AbortSignal) => call<DirectoryReadiness>('/directory/overview', { signal }),
  /** Queues a check of the RCCG directory API for the worker (202). */
  syncDirectoryNow: () => post<{ queued: true }>('/directory/sync'),
  browseDirectory: (params: { unit?: string; q?: string; page?: number; show?: string }, signal?: AbortSignal) => call<Browse>(`/directory/browse${query(params)}`, { signal }),
  searchUnits: (q: string, level?: ChurchLevel, signal?: AbortSignal) => call<{ units: UnitMatch[] }>(`/directory/search${query({ q, kind: 'unit', level })}`, { signal }),
  searchDirectoryParishes: (q: string, signal?: AbortSignal) => call<{ parishes: ParishSuggestion[] }>(`/directory/search${query({ q, kind: 'parish' })}`, { signal }),
  unitDetail: (unitId: string, signal?: AbortSignal) => call<UnitDetail>(`/directory/units/${id(unitId)}`, { signal }),
  parishEntry: (parishId: string, signal?: AbortSignal) => call<ParishEntry>(`/directory/parishes/${id(parishId)}`, { signal }),
  createUnit: (input: { level: 'continent' | 'region' | 'province'; name: string; parentId: string | null }) => post<{ id: string }>('/directory/units', input),
  updateUnit: (unitId: string, changes: { displayName?: string; parentId?: string; state?: string | null }) => patch<{ ok: true; changed: string[] }>(`/directory/units/${id(unitId)}`, changes),
  mergeUnit: (unitId: string, intoId: string) =>
    post<{ ok: true; unitsMoved: number; parishesMoved: number; parishesMerged: number; applicationsMoved: number }>(`/directory/units/${id(unitId)}/merge`, { intoId }),
  createParish: (input: { unitId: string; name: string }) => post<{ id: string }>('/directory/parishes', input),
  updateParish: (parishId: string, changes: { displayName?: string; unitId?: string; status?: 'active' | 'inactive' }) =>
    patch<{ ok: true; changed: string[] }>(`/directory/parishes/${id(parishId)}`, changes),
  mergeParish: (parishId: string, intoId: string) => post<{ ok: true; applicationsMoved: number }>(`/directory/parishes/${id(parishId)}/merge`, { intoId }),
  splitParish: (parishId: string, name: string) => post<{ id: string }>(`/directory/parishes/${id(parishId)}/split`, { name }),
  directoryImports: (page: number, signal?: AbortSignal) => call<Paged<ImportRow>>(`/directory/imports${query({ page })}`, { signal }),
  directoryImport: (importId: string, params: { code?: string; page?: number }, signal?: AbortSignal) => call<ImportDetail>(`/directory/imports/${id(importId)}${query(params)}`, { signal }),
  directoryLineage: (signal?: AbortSignal) => call<{ items: LineageGroup[] }>('/directory/lineage', { signal }),

  // Parish review
  parishReview: (kind: ReviewKind, page: number, signal?: AbortSignal) => call<ReviewQueue>(`/parish-review${query({ kind, page, pageSize: 20 })}`, { signal }),
  resolveReport: (reportId: string, action: ResolveAction) => post<{ ok: true; parishId: string | null }>(`/parish-review/reports/${id(reportId)}/resolve`, action),
  linkEarlierAnswer: (applicantId: string, parishId: string) => post<{ ok: true }>(`/parish-review/earlier/${id(applicantId)}/link`, { parishId }),
  dismissEarlierAnswer: (applicantId: string) => post<{ ok: true }>(`/parish-review/earlier/${id(applicantId)}/dismiss`),
  earlierMatches: (signal?: AbortSignal) => call<{ total: number; items: EarlierMatch[] }>('/parish-review/earlier/matches', { signal }),
  confirmEarlierMatches: (items: { applicationId: string; parishId: string }[]) => post<{ ok: true; linked: number; skipped: number }>('/parish-review/earlier/confirm', { items }),

  // Reports and analytics
  reportSummary: (params: Record<string, string | undefined>, signal?: AbortSignal) => call<ReportSummary>(`/reports/summary${query(params)}`, { signal }),
  reportUnits: (params: Record<string, string | undefined>, signal?: AbortSignal) => call<ReportListing>(`/reports/units${query(params)}`, { signal }),
  reportUnitsCsvUrl: (params: Record<string, string | undefined>) => `/api/admin/reports/units.csv${query(params)}`,
  reportTrend: (params: Record<string, string | undefined>, signal?: AbortSignal) => call<Trend>(`/reports/trend${query(params)}`, { signal }),
  reportCohorts: (params: Record<string, string | undefined>, signal?: AbortSignal) => call<{ masked: boolean; items: ReportCohort[] }>(`/reports/cohorts${query(params)}`, { signal }),
  reportsOverview: (signal?: AbortSignal) => call<ReportsOverview>('/reports/overview', { signal }),
};
