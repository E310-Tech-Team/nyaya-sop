/**
 * Web Push in the browser (docs/03 §Notifications). Separate from installing the app and from
 * the application's contact consent.
 *
 * Support is decided by feature detection; the platform only explains *why* something is
 * missing (on iPhone/iPad, push exists only in the Home Screen app, iOS/iPadOS 16.4+).
 * Permission is asked for only when the person presses "Enable notifications", and
 * `pushManager.subscribe()` is the first call in that click handler (Safari requires it to run
 * within the gesture; other browsers prompt from it too).
 */
import { NOTIFICATION_CONSENT_VERSION, type NotificationTopic, type PushDeviceState } from '../shared/platform';
import { apiRequest, type CsrfScope } from './api';
import { appleSupportsWebPush, currentPlatform, isAppleMobile, isStandaloneDisplay } from './install';

export type PushSupport =
  | { kind: 'supported' }
  /** iPhone/iPad on 16.4+ in a browser tab: add to the Home Screen first. */
  | { kind: 'install-required' }
  | { kind: 'unsupported'; reason: 'in-app-browser' | 'old-apple-os' | 'not-secure' | 'no-push' };

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { kind: 'unsupported', reason: 'no-push' };
  if (!window.isSecureContext) return { kind: 'unsupported', reason: 'not-secure' };
  const platform = currentPlatform();
  if (platform.inApp) return { kind: 'unsupported', reason: 'in-app-browser' };
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return { kind: 'supported' };
  if (isAppleMobile(platform) && !isStandaloneDisplay()) {
    return appleSupportsWebPush(platform) ? { kind: 'install-required' } : { kind: 'unsupported', reason: 'old-apple-os' };
  }
  return { kind: 'unsupported', reason: isAppleMobile(platform) && !appleSupportsWebPush(platform) ? 'old-apple-os' : 'no-push' };
}

/** This device's state, once support is known. */
export type DeviceStatus =
  /** Never asked (permission "default"). */
  | { kind: 'not-requested' }
  /** Permission granted but no subscription (turned off here, or never set up). */
  | { kind: 'off' }
  /** Subscribed, and the server has it as active. */
  | { kind: 'enabled'; server: PushDeviceState }
  /** Blocked in browser or device settings: only the person can undo that. */
  | { kind: 'denied' }
  /** The browser still has a subscription the server no longer accepts (expired, key changed). */
  | { kind: 'expired' }
  /** Subscribing or registering failed. */
  | { kind: 'failed'; message: string };

export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

const authOf = (subscription: PushSubscription) => subscription.toJSON().keys?.auth ?? '';

/** Was this subscription made with the server's current public key? (Unknown counts as yes.) */
function madeWithKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  const mine = new Uint8Array(key);
  const theirs = urlBase64ToBytes(publicKey);
  return mine.length === theirs.length && mine.every((byte, index) => byte === theirs[index]);
}

/** The active service worker registration, or null (none in development, or it failed). */
export function serviceWorkerReady(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]).catch(() => null);
}

/** Reads this device's state and checks it against the server (also updates "last seen"). */
export async function readDeviceStatus(publicKey: string | null): Promise<DeviceStatus> {
  if (Notification.permission === 'denied') return { kind: 'denied' };
  const registration = await serviceWorkerReady();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return Notification.permission === 'granted' ? { kind: 'off' } : { kind: 'not-requested' };
  if (publicKey && !madeWithKey(subscription, publicKey)) return { kind: 'expired' };
  try {
    const server = await apiRequest<PushDeviceState | { status: 'unknown' }>('/push/status', {
      method: 'POST',
      json: { endpoint: subscription.endpoint, auth: authOf(subscription) },
    });
    if (server.status === 'active') return { kind: 'enabled', server: server as PushDeviceState };
    if (server.status === 'revoked') {
      // Turned off (here or from another page): tidy up the browser side too.
      await subscription.unsubscribe().catch(() => undefined);
      return { kind: 'off' };
    }
    return { kind: 'expired' };
  } catch (error) {
    return { kind: 'failed', message: (error as Error).message };
  }
}

/**
 * Turns notifications on for the chosen topics. Call directly from the click handler with a
 * registration obtained beforehand, so subscribe() runs inside the user's gesture.
 */
export async function enableNotifications(input: {
  registration: ServiceWorkerRegistration;
  publicKey: string;
  topics: NotificationTopic[];
  csrf?: CsrfScope;
}): Promise<DeviceStatus> {
  const options: PushSubscriptionOptionsInit = { userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(input.publicKey) };
  let subscription: PushSubscription;
  try {
    subscription = await input.registration.pushManager.subscribe(options);
  } catch (error) {
    if (Notification.permission === 'denied') return { kind: 'denied' };
    if (Notification.permission === 'default') return { kind: 'not-requested' }; // prompt dismissed
    // Permission is granted: most likely an old subscription made with a previous server key.
    const old = await input.registration.pushManager.getSubscription().catch(() => null);
    if (!old) return { kind: 'failed', message: (error as Error).message || 'Subscribing failed.' };
    await old.unsubscribe().catch(() => undefined);
    try {
      subscription = await input.registration.pushManager.subscribe(options);
    } catch (retryError) {
      return { kind: 'failed', message: (retryError as Error).message || 'Subscribing failed.' };
    }
  }
  try {
    const server = await apiRequest<PushDeviceState>('/push/subscribe', {
      method: 'POST',
      csrf: input.csrf,
      json: { subscription: subscription.toJSON(), topics: input.topics, consentVersion: NOTIFICATION_CONSENT_VERSION },
    });
    return { kind: 'enabled', server };
  } catch (error) {
    return { kind: 'failed', message: (error as Error).message };
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await serviceWorkerReady();
  return (await registration?.pushManager.getSubscription().catch(() => null)) ?? null;
}

export async function changeTopics(topics: NotificationTopic[], csrf?: CsrfScope): Promise<PushDeviceState> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Notifications aren’t on for this device.');
  return apiRequest<PushDeviceState>('/push/topics', { method: 'POST', csrf, json: { endpoint: subscription.endpoint, auth: authOf(subscription), topics } });
}

/** Turns notifications off on this device: the server stops sending, then the browser forgets it. */
export async function disableNotifications(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await apiRequest('/push/unsubscribe', { method: 'POST', json: { endpoint: subscription.endpoint, auth: authOf(subscription) } });
  await subscription.unsubscribe().catch(() => undefined);
}

/** Links this browser's subscription to the signed-in account (proven by holding its secret). */
export async function linkThisDevice(): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription) return false;
  await apiRequest('/account/devices/link', { method: 'POST', csrf: 'applicant', json: { endpoint: subscription.endpoint, auth: authOf(subscription) } });
  return true;
}

/** This device's server id (to mark "this device" in the account's device list). */
export async function thisDeviceId(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const state = await apiRequest<{ id?: string; status: string }>('/push/status', {
    method: 'POST',
    json: { endpoint: subscription.endpoint, auth: authOf(subscription) },
  }).catch(() => null);
  return state?.id ?? null;
}

/**
 * Once per session when the app opens: tells the server the device is still here, and if the
 * server's key changed since this device subscribed, re-subscribes and moves the record over.
 * Only when permission is already granted; never prompts.
 */
export async function reconcileOnOpen(publicKey: string | null): Promise<void> {
  if (!publicKey || pushSupport().kind !== 'supported' || Notification.permission !== 'granted') return;
  try {
    if (window.sessionStorage.getItem('sop.push.reconciled')) return;
    window.sessionStorage.setItem('sop.push.reconciled', '1');
  } catch {
    // no storage: reconcile anyway
  }
  const registration = await serviceWorkerReady();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!registration || !subscription) return;
  if (madeWithKey(subscription, publicKey)) {
    await apiRequest('/push/status', { method: 'POST', json: { endpoint: subscription.endpoint, auth: authOf(subscription) } }).catch(() => undefined);
    return;
  }
  const oldEndpoint = subscription.endpoint;
  const oldAuth = authOf(subscription);
  await subscription.unsubscribe().catch(() => undefined);
  const next = await registration.pushManager
    .subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) })
    .catch(() => null);
  if (next) {
    await apiRequest('/push/rotate', { method: 'POST', json: { oldEndpoint, oldAuth, subscription: next.toJSON() } }).catch(() => undefined);
  }
}

// ── "Not now" for the notification card ───────────────────────────────────────

const SNOOZE_KEY = 'sop.push.snoozedAt';
export const PUSH_SNOOZE_DAYS = 30;

export function isPushCardSnoozed(now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY));
    return at > 0 && now - at < PUSH_SNOOZE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function snoozePushCard(now = Date.now()): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(now));
  } catch {
    // storage blocked
  }
}

/** Where to re-allow notifications once they're blocked (platform hint only). */
export function unblockInstructions(): string {
  const platform = currentPlatform();
  if (isAppleMobile(platform)) return 'Open the Settings app, tap Notifications, then School of Purpose, and turn on Allow Notifications.';
  if (platform.os === 'android') {
    return 'Tap the icon at the left of the address bar (or long-press the app icon and choose App info), open Permissions or Notifications, and allow them. Then come back here.';
  }
  if (platform.browser === 'safari') return 'In Safari, choose Settings → Websites → Notifications, and set this website to Allow. Then reload this page.';
  if (platform.browser === 'firefox') return 'Click the icon at the left of the address bar, remove the “Blocked” notifications setting, then reload this page.';
  return 'Click the icon at the left of the address bar, set Notifications to Allow, then reload this page.';
}
