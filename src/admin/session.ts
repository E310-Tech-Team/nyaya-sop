import { useSyncExternalStore } from 'react';
import { ApiError, apiRequest, setCsrfToken } from '../lib/api';
import { can, type Permission, type StaffRole } from '../shared/permissions';

export type StaffSession = {
  staff: { id: string; email: string; displayName: string; role: StaffRole; mfaEnabled: boolean };
  permissions: Permission[];
  mfa: { enabled: boolean; verified: boolean; required: boolean };
  csrfToken: string;
};

/**
 * Where the staff member is in signing in. The session is an HttpOnly cookie; this mirrors it.
 * - `mfa`: password accepted, second factor still needed.
 * - `mfa-setup`: two-step verification is required but not set up yet.
 */
export type StaffState =
  | { step: 'unknown' }
  | { step: 'loading' }
  | { step: 'signed-out'; reason?: 'expired' }
  | { step: 'error' }
  | { step: 'mfa' | 'mfa-setup' | 'signed-in'; session: StaffSession };

let state: StaffState = { step: 'unknown' };
const listeners = new Set<() => void>();
const set = (next: StaffState) => {
  state = next;
  listeners.forEach((listener) => listener());
};

const stepFor = (session: StaffSession): 'mfa' | 'mfa-setup' | 'signed-in' =>
  session.mfa.enabled && !session.mfa.verified ? 'mfa' : !session.mfa.enabled && session.mfa.required ? 'mfa-setup' : 'signed-in';

export async function loadStaffSession(): Promise<StaffState> {
  if (state.step === 'unknown') set({ step: 'loading' });
  try {
    const session = await apiRequest<StaffSession>('/admin/session', { timeoutMs: 10_000 });
    setCsrfToken('staff', session.csrfToken);
    set({ step: stepFor(session), session });
  } catch (error) {
    setCsrfToken('staff', null);
    set(error instanceof ApiError && error.status === 401 ? { step: 'signed-out' } : { step: 'error' });
  }
  return state;
}

/** Any 401 from the admin API: the session ended (timed out, revoked, or the role changed). */
export function staffSessionEnded() {
  if (state.step === 'signed-in' || state.step === 'mfa' || state.step === 'mfa-setup') {
    setCsrfToken('staff', null);
    set({ step: 'signed-out', reason: 'expired' });
  }
}

export function staffSignedOut() {
  setCsrfToken('staff', null);
  set({ step: 'signed-out' });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (state.step === 'unknown') void loadStaffSession();
  return () => void listeners.delete(listener);
};

export const useStaff = () => useSyncExternalStore(subscribe, () => state, () => state);

/** Whether the signed-in staff member has any of these permissions (for hiding controls only). */
export function useCan(...permissions: Permission[]): boolean {
  const current = useStaff();
  return current.step === 'signed-in' && permissions.some((permission) => can(current.session.staff.role, permission));
}

/** Whether they have every one of these permissions (Parish review needs three). */
export function useCanAll(...permissions: Permission[]): boolean {
  const current = useStaff();
  return current.step === 'signed-in' && permissions.every((permission) => can(current.session.staff.role, permission));
}
