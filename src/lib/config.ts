import { useSyncExternalStore } from 'react';
import type { PublicConfig } from '../shared/platform';
import { apiRequest } from './api';

/**
 * What the server has switched on (accounts need working email; push needs VAPID keys), the
 * public VAPID key and the support contact. Loaded once per page and shared.
 */
let config: PublicConfig | null = null;
let pending: Promise<PublicConfig | null> | null = null;
/** The last attempt failed (offline, or the server couldn't be reached). */
let failed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function loadPublicConfig(): Promise<PublicConfig | null> {
  pending ??= apiRequest<PublicConfig>('/config', { timeoutMs: 8_000 })
    .then((value) => {
      config = value;
      failed = false;
      notify();
      return value;
    })
    .catch(() => {
      pending = null; // try again next time someone asks
      failed = true;
      notify();
      return null;
    });
  return pending;
}

/** Asks again after a failure (a "Try again" button). */
export function retryPublicConfig(): void {
  if (config || pending) return;
  failed = false;
  notify();
  void loadPublicConfig();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!config) void loadPublicConfig();
  return () => void listeners.delete(listener);
};

/** null until loaded (or if the server can't be reached). */
export const usePublicConfig = () => useSyncExternalStore(subscribe, () => config, () => null);

export type PublicConfigStatus = 'loading' | 'ready' | 'failed';

/** Whether the settings have arrived, are still on their way, or couldn't be loaded. */
export const usePublicConfigStatus = (): PublicConfigStatus =>
  useSyncExternalStore(
    subscribe,
    () => (config ? 'ready' : failed ? 'failed' : 'loading'),
    () => 'loading',
  );
