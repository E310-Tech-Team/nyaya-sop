/// <reference lib="webworker" />
/**
 * The School of Purpose service worker (built by scripts/vite-pwa.ts into dist/sw.js).
 * Caching policy: ./routing.ts. Updates never take over by themselves: a new version waits
 * until the page asks (the person pressed "Update"), so nobody is reloaded mid-form.
 * Emergency rollback: a build made with SW_KILL_SWITCH=1 deletes every cache and unregisters.
 */
import {
  OFFLINE_URL,
  SHELL_URL,
  isCacheable,
  isUnavailable,
  notificationTarget,
  readPushPayload,
  strategyFor,
} from './routing';

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;
declare const __PRECACHE__: string[];
declare const __KILL_SWITCH__: boolean;

const PRECACHE = `sop-precache-${__BUILD_ID__}`;
const RUNTIME = 'sop-runtime-v1';
const RUNTIME_MAX_ENTRIES = 150;

self.addEventListener('install', (event) => {
  if (__KILL_SWITCH__) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  // All or nothing: if any file fails (say, mid-deploy), this version isn't installed and the
  // current one keeps working; the browser tries again later. `reload` skips the HTTP cache.
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll(__PRECACHE__.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (__KILL_SWITCH__) {
        for (const key of await caches.keys()) if (key.startsWith('sop-')) await caches.delete(key);
        await self.registration.unregister();
        return;
      }
      const runtime = await caches.open(RUNTIME);
      for (const key of await caches.keys()) {
        if (!key.startsWith('sop-precache-') || key === PRECACHE) continue;
        // Tabs still running the previous version may lazy-load its files: keep those around.
        const old = await caches.open(key);
        for (const request of await old.keys()) {
          if (!new URL(request.url).pathname.startsWith('/assets/')) continue;
          const response = await old.match(request);
          if (response) await runtime.put(request, response);
        }
        await caches.delete(key);
      }
      await trimRuntime();
      await self.registration.navigationPreload?.enable().catch(() => undefined);
      await self.clients.claim();
    })(),
  );
});

async function trimRuntime(): Promise<void> {
  const cache = await caches.open(RUNTIME);
  const keys = await cache.keys(); // oldest first
  for (const request of keys.slice(0, Math.max(0, keys.length - RUNTIME_MAX_ENTRIES))) await cache.delete(request);
}

function remember(event: FetchEvent, response: Response): void {
  if (!isCacheable(response)) return;
  const copy = response.clone();
  event.waitUntil(
    caches
      .open(RUNTIME)
      .then((cache) => cache.put(event.request, copy))
      .then(trimRuntime)
      .catch(() => undefined),
  );
}

const offlineText = () =>
  new Response('You are offline. Please reconnect and try again.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });

async function network(event: FetchEvent): Promise<Response> {
  const preloaded = (await event.preloadResponse.catch(() => undefined)) as Response | undefined;
  return preloaded ?? fetch(event.request);
}

/** Public pages: the live page when reachable; offline (or while the server restarts), the cached app shell. */
async function publicPage(event: FetchEvent): Promise<Response> {
  let response: Response | undefined;
  try {
    response = await network(event);
    if (!isUnavailable(response.status)) return response;
  } catch {
    // offline
  }
  return (await caches.match(SHELL_URL, { cacheName: PRECACHE })) ?? (await caches.match(OFFLINE_URL)) ?? response ?? offlineText();
}

/** Account and admin pages: never from a cache. Offline, explain that they need a connection. */
async function privatePage(event: FetchEvent): Promise<Response> {
  try {
    return await network(event);
  } catch {
    return (await caches.match(OFFLINE_URL)) ?? offlineText();
  }
}

/** Content-hashed build files never change under the same name: cache first. */
async function hashedAsset(event: FetchEvent): Promise<Response> {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request); // a failure reaches the page, which offers a reload
  remember(event, response);
  return response;
}

/** Icons, manifest, offline page: fresh when online, the stored copy when not. */
async function staticFile(event: FetchEvent): Promise<Response> {
  try {
    const response = await fetch(event.request);
    remember(event, response);
    return response;
  } catch {
    return (await caches.match(event.request)) ?? offlineText();
  }
}

self.addEventListener('fetch', (event) => {
  if (__KILL_SWITCH__) return;
  switch (strategyFor(event.request, self.location.origin)) {
    case 'page':
      return event.respondWith(publicPage(event));
    case 'private-page':
      return event.respondWith(privatePage(event));
    case 'asset':
      return event.respondWith(hashedAsset(event));
    case 'static':
      return event.respondWith(staticFile(event));
    default:
      return; // bypass: the browser handles it and nothing is stored
  }
});

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: unknown } | null)?.type;
  if (type === 'SKIP_WAITING') void self.skipWaiting();
  if (type === 'GET_BUILD') event.ports[0]?.postMessage({ build: __BUILD_ID__ });
});

// ── Push notifications ───────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data: unknown = null;
  try {
    data = event.data?.json() ?? null;
  } catch {
    data = null;
  }
  // Every push shows a notification (no silent pushes): unreadable ones get a neutral text.
  const note = readPushPayload(data);
  event.waitUntil(
    self.registration.showNotification(note.title, {
      body: note.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: note.id, // a repeat of the same message replaces the earlier one
      data: { url: note.url, id: note.id },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: unknown; id?: unknown };
  const target = notificationTarget(data.url, self.location.origin);
  event.waitUntil(
    (async () => {
      if (typeof data.id === 'string') {
        // Counted only when this request gets through, and anyone holding the id could report one:
        // the figure is what devices reported, never exact.
        void fetch('/api/events', {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'notification_click', properties: { messageId: data.id } }),
        }).catch(() => undefined);
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        // Focus the open app and let it navigate in place (no reload, so no lost form answers).
        await open.focus().catch(() => undefined);
        open.postMessage({ type: 'sop:navigate', path: new URL(target).pathname });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

const base64url = (buffer: ArrayBuffer | null) =>
  buffer ? btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';

/** The browser replaced the subscription: move it over on the server, proving ownership with the old secret. */
self.addEventListener('pushsubscriptionchange', (rawEvent: Event) => {
  const event = rawEvent as ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null };
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      if (!old) return; // nothing to prove ownership with: the app re-checks the next time it opens
      const next =
        event.newSubscription ??
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey }).catch(() => null));
      if (!next) return;
      await fetch('/api/push/rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ oldEndpoint: old.endpoint, oldAuth: base64url(old.getKey('auth')), subscription: next.toJSON() }),
      }).catch(() => undefined);
    })(),
  );
});
