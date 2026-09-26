import { useSyncExternalStore } from 'react';
import type { AccountSummary } from '../shared/platform';
import { ApiError, apiRequest, setCsrfToken } from './api';

/**
 * The signed-in applicant, if any (optional accounts, docs/03 §Accounts). The session itself is
 * an HttpOnly cookie; this only mirrors who is signed in and keeps the CSRF token for changes.
 */
export type AccountState =
  | { status: 'unknown' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error' }
  | { status: 'signed-in'; account: AccountSummary };

let state: AccountState = { status: 'unknown' };
const listeners = new Set<() => void>();
const set = (next: AccountState) => {
  state = next;
  listeners.forEach((listener) => listener());
};

export async function loadAccount(): Promise<AccountState> {
  set({ status: 'loading' });
  try {
    const me = await apiRequest<{ account: AccountSummary; csrfToken: string }>('/account/me', { timeoutMs: 10_000 });
    setCsrfToken('applicant', me.csrfToken);
    set({ status: 'signed-in', account: me.account });
  } catch (error) {
    setCsrfToken('applicant', null);
    set(error instanceof ApiError && (error.status === 401 || error.status === 403) ? { status: 'signed-out' } : { status: 'error' });
  }
  return state;
}

export function markSignedIn(account: AccountSummary, csrfToken: string) {
  setCsrfToken('applicant', csrfToken);
  set({ status: 'signed-in', account });
}

export function markSignedOut() {
  setCsrfToken('applicant', null);
  set({ status: 'signed-out' });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (state.status === 'unknown') void loadAccount();
  return () => void listeners.delete(listener);
};

/** Subscribing starts the check, so pages that never ask never call the API. */
export const useAccount = () => useSyncExternalStore(subscribe, () => state, () => state);
