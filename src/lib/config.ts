import { useSyncExternalStore } from 'react';
import type { PublicConfig } from '../shared/platform';
import { apiRequest } from './api';

/**
 * What the server has switched on (accounts need working email; push needs VAPID keys), the
 * public VAPID key and the support contact. Loaded once per page and shared.
 */
let config: PublicConfig | null = null;
let pending: Promise<PublicConfig | null> | null = null;
const listeners = new Set<() => void>();

export function loadPublicConfig(): Promise<PublicConfig | null> {
  pending ??= apiRequest<PublicConfig>('/config', { timeoutMs: 8_000 })
    .then((value) => {
      config = value;
      listeners.forEach((listener) => listener());
      return value;
    })
    .catch(() => {
      pending = null; // try again next time someone asks
      return null;
    });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!config) void loadPublicConfig();
  return () => void listeners.delete(listener);
};

/** null until loaded (or if the server can't be reached). */
export const usePublicConfig = () => useSyncExternalStore(subscribe, () => config, () => null);
