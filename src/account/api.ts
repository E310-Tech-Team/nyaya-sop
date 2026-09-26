import { apiRequest } from '../lib/api';
import type { AccountSummary, ApplicantApplication, ClaimableApplication, DeviceSummary, InboxItem, SessionSummary } from '../shared/platform';

const change = { method: 'POST', csrf: 'applicant' } as const;

/** /api/account (server/account/routes.ts). Every change carries the applicant CSRF token. */
export const accountApi = {
  requestLink: (email: string) => apiRequest<{ message: string }>('/account/sign-in', { method: 'POST', json: { email } }),
  verify: (token: string) => apiRequest<{ account: Pick<AccountSummary, 'email'>; csrfToken: string }>('/account/verify', { method: 'POST', json: { token } }),
  logout: () => apiRequest<{ ok: true }>('/account/logout', change),

  applications: (signal?: AbortSignal) =>
    apiRequest<{ claimed: ApplicantApplication[]; claimable: ClaimableApplication[] }>('/account/applications', { signal }),
  claim: (id: string) => apiRequest<{ ok: true }>(`/account/applications/${encodeURIComponent(id)}/claim`, change),

  inbox: (signal?: AbortSignal) => apiRequest<{ items: InboxItem[]; unread: number }>('/account/inbox', { signal }),
  markRead: (id: string) => apiRequest<{ ok: true }>(`/account/inbox/${encodeURIComponent(id)}/read`, change),

  devices: (signal?: AbortSignal) => apiRequest<{ devices: DeviceSummary[] }>('/account/devices', { signal }),
  removeDevice: (id: string) => apiRequest<{ ok: true }>(`/account/devices/${encodeURIComponent(id)}/remove`, change),

  sessions: (signal?: AbortSignal) => apiRequest<{ sessions: SessionSummary[] }>('/account/sessions', { signal }),
  revokeSession: (id: string) => apiRequest<{ ok: true }>(`/account/sessions/${encodeURIComponent(id)}/revoke`, change),
  revokeOtherSessions: () => apiRequest<{ ok: true }>('/account/sessions/revoke-others', change),

  deleteAccount: (confirm: string) => apiRequest<{ ok: true }>('/account/delete', { ...change, json: { confirm } }),
};
