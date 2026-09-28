/**
 * The service worker's caching policy, as pure functions (tested in routing.test.ts; used by sw.ts).
 *
 * Cached:  content-hashed build assets, the app shell and a few public files, the offline page.
 * Never:   /api/* (applications, accounts, auth, notes, CSV, admin data), anything that isn't GET,
 *          other origins, and every /admin or /account page, which always come from the network
 *          (offline, they show the offline page instead of a cached copy).
 * Public pages are network-first: offline, the cached app shell renders them from bundled content.
 */
import { CAMPAIGN_LIMITS, isAllowedNotificationPath } from '../shared/platform';

export type Strategy =
  /** Not handled by the service worker at all: straight to the network, never stored. */
  | 'bypass'
  /** Public page: network first, the cached app shell when offline. */
  | 'page'
  /** Account or admin page: network only; offline shows the offline page. */
  | 'private-page'
  /** Content-hashed build file: cache first (the name changes whenever the content does). */
  | 'asset'
  /** Unhashed public file (icons, manifest, offline page): network first, the stored copy offline. */
  | 'static';

export const SHELL_URL = '/index.html';
export const OFFLINE_URL = '/offline.html';

const PRIVATE_PAGE = /^\/(admin|account)(\/|$)/;
const STATIC_FILES = new Set(['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/manifest.webmanifest', OFFLINE_URL, '/og-image.jpg']);

export const isPrivatePath = (pathname: string) => PRIVATE_PAGE.test(pathname);

export function strategyFor(request: { method: string; url: string; mode?: string }, origin: string): Strategy {
  if (request.method !== 'GET') return 'bypass'; // submissions and every other change
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'bypass';
  }
  if (url.origin !== origin) return 'bypass';
  const path = url.pathname;
  if (path.startsWith('/api/') || path === '/api') return 'bypass';
  if (path === '/sw.js' || path === '/build-id.txt') return 'bypass'; // update checks must reach the server
  if (request.mode === 'navigate') return isPrivatePath(path) ? 'private-page' : 'page';
  if (isPrivatePath(path)) return 'bypass';
  if (path.startsWith('/assets/')) return 'asset';
  if (path.startsWith('/icons/') || STATIC_FILES.has(path)) return 'static';
  return 'bypass';
}

/** Only successful, same-origin, storable responses go into a cache. */
export function isCacheable(response: { ok: boolean; type: string; headers: { get(name: string): string | null } }): boolean {
  return response.ok && response.type === 'basic' && !/no-store/i.test(response.headers.get('cache-control') ?? '');
}

/** Server errors a proxy returns while the app is restarting: treat like being offline. */
export const isUnavailable = (status: number) => status === 502 || status === 503 || status === 504;

export type NotificationContent = { id: string; title: string; body: string; url: string; private: boolean };

/** Shown if a push arrives unreadable: browsers expect every push to show something. */
export const FALLBACK_NOTIFICATION: NotificationContent = {
  id: 'sop-update',
  title: 'School of Purpose',
  body: 'Open School of Purpose to see what’s new.',
  url: '/',
  private: false,
};

/**
 * Validates a decrypted push payload ({v:1,id,title,body,url,expiresAt}). The destination must be
 * a same-origin path on the allowlist; anything else opens the home page.
 */
export function readPushPayload(data: unknown): NotificationContent {
  const payload = data as Partial<Record<'v' | 'id' | 'title' | 'body' | 'url', unknown>> | null;
  if (!payload || typeof payload !== 'object' || payload.v !== 1) return FALLBACK_NOTIFICATION;
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const id = text(payload.id, 64);
  const title = text(payload.title, CAMPAIGN_LIMITS.title);
  const body = text(payload.body, CAMPAIGN_LIMITS.body);
  if (!id || !title || !body) return FALLBACK_NOTIFICATION;
  const url = isAllowedNotificationPath(payload.url) ? payload.url : '/';
  return { id, title, body, url, private: isPrivatePath(url) };
}

/** Where a notification click goes: an allowlisted same-origin path, as an absolute URL. */
export function notificationTarget(path: unknown, origin: string): string {
  return new URL(isAllowedNotificationPath(path) ? path : '/', origin).href;
}
