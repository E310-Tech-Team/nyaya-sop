/**
 * Service worker registration and app updates (production builds only; see src/sw/).
 *
 * A new version never takes over by itself. When one has downloaded, the page offers "Update"
 * and reloads only after the person chooses it, so nobody loses a half-filled form or an admin
 * edit. Other signs that this page is out of date lead to the same offer:
 * - an API response from a different release (the x-app-build header), and
 * - a lazily loaded part of the site that no longer exists on the server (after a deploy).
 */
import { useSyncExternalStore } from 'react';

export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

export type UpdateState =
  /** Nothing to do. */
  | { status: 'idle' }
  /** A new version is downloaded and waiting: "Update" activates it and reloads. */
  | { status: 'ready' }
  /** This page is older than the site (or a file it needs is gone): only a reload helps. */
  | { status: 'reload'; reason: 'new-release' | 'missing-files' | 'updated-elsewhere' };

let state: UpdateState = { status: 'idle' };
let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
let userAskedToUpdate = false;
let snoozedUntil = 0;
let serverBuild: string | null = null;
const RELOADED_FOR = 'sop.update.reloadedFor';
/** The server release we already reloaded for in this tab (so a server stuck on a mismatch can't cause a reload loop). */
const alreadyReloadedFor = (build: string) => {
  try {
    return window.sessionStorage.getItem(RELOADED_FOR) === build;
  } catch {
    return false;
  }
};
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  if (next.status !== 'idle' && Date.now() < snoozedUntil) return;
  state = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useUpdateState = () => useSyncExternalStore(subscribe, () => state, () => state);

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!__SW_ENABLED__) {
    // Emergency rollback build: take down any service worker this site installed earlier.
    void navigator.serviceWorker
      .getRegistrations()
      .then((list) => Promise.all(list.map((item) => item.unregister())))
      .catch(() => undefined);
    return;
  }
  if (!import.meta.env.PROD || !window.isSecureContext) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload only because the person pressed Update here; another tab's update just asks.
    if (userAskedToUpdate) window.location.reload();
    else set({ status: 'reload', reason: 'updated-elsewhere' });
  });

  const start = async () => {
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    } catch {
      return; // the site works fine without it
    }
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        // "installed" with a controller present = an update (not the very first install).
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          waiting = worker;
          set({ status: 'ready' });
        }
      };
      check();
      worker.addEventListener('statechange', check);
    };
    watch(registration.waiting);
    watch(registration.installing);
    registration.addEventListener('updatefound', () => watch(registration?.installing ?? null));

    // Look for a new version when the app returns to the foreground (at most every 30 minutes)
    // and hourly while it stays open.
    let lastCheck = Date.now();
    const check = () => {
      if (Date.now() - lastCheck < 30 * 60_000) return;
      lastCheck = Date.now();
      void registration?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    window.setInterval(check, 60 * 60_000);
  };
  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => void start(), { once: true });

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault(); // handled here instead of an uncaught error
    noteMissingFiles();
  });
}

/** The person chose "Update" (or "Reload"). */
export function applyUpdate(): void {
  if (state.status === 'ready' && waiting) {
    userAskedToUpdate = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // If the switch doesn't happen promptly, reload anyway: they asked for it.
    window.setTimeout(() => window.location.reload(), 4000);
    return;
  }
  if (serverBuild) {
    try {
      window.sessionStorage.setItem(RELOADED_FOR, serverBuild);
    } catch {
      // storage blocked: at worst the offer comes back after the reload
    }
  }
  window.location.reload();
}

/** "Later": ask again in half an hour at the earliest. */
export function snoozeUpdate(): void {
  snoozedUntil = Date.now() + 30 * 60_000;
  state = { status: 'idle' };
  listeners.forEach((listener) => listener());
}

/** Called with each API response's release id. */
export function noteServerBuild(build: string | null): void {
  if (!build || build === 'dev' || APP_BUILD === 'dev' || APP_BUILD === 'test' || build === APP_BUILD) return;
  if (state.status !== 'idle' || alreadyReloadedFor(build)) return;
  serverBuild = build;
  // With a service worker, fetch the new version; the "ready" offer follows once it's downloaded.
  if (registration) void registration.update().catch(() => undefined);
  else set({ status: 'reload', reason: 'new-release' });
}

export function noteMissingFiles(): void {
  set({ status: 'reload', reason: 'missing-files' });
}

/** A lazily loaded module failed to download (the file was replaced by a newer release, or the connection dropped). */
export const isChunkLoadError = (error: unknown) =>
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(
    String((error as Error | null)?.message ?? error),
  );
