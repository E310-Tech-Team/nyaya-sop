import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { loadPublicConfig } from '../lib/config';
import { reconcileOnOpen } from '../lib/push';
import { applyUpdate, snoozeUpdate, useUpdateState } from '../lib/pwa';
import { isAllowedNotificationPath } from '../shared/platform';

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};
/** The browser's own idea of connectivity: "offline" is reliable, "online" only means "maybe". */
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/**
 * A slim notice at the very top of the page while the browser is offline. It sits in the page
 * flow (it never covers anything) and says what still works. The live region is always present
 * so screen readers announce the change.
 */
export function ConnectionStatus() {
  const online = useOnline();
  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="bg-ink text-white">
          <p className="mx-auto max-w-[1120px] px-5 py-[10px] font-sans text-[13px] leading-[1.45]">
            <strong>You're offline.</strong> Pages you've opened still work. Sending an application, signing in and notification
            settings need a connection.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Offers a new version of the site. Nothing reloads until the person chooses to, because a
 * reload in the middle of a form (or an admin edit) must always be their decision.
 */
export function UpdatePrompt() {
  const update = useUpdateState();
  const { pathname } = useLocation();
  const inForm = pathname.startsWith('/apply/');
  const inAdmin = pathname.startsWith('/admin');
  const title =
    update.status === 'ready'
      ? 'An update is ready'
      : update.status === 'reload' && update.reason === 'missing-files'
        ? 'This page needs a refresh'
        : 'A newer version of the site is available';
  const detail = inForm
    ? 'Your answers stay saved on this device while this tab is open.'
    : inAdmin
      ? 'Save your changes first: anything unsaved on this page will be lost.'
      : 'It only takes a moment.';
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
      style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
    >
      {update.status !== 'idle' && (
        <div className="pointer-events-auto flex w-full max-w-[560px] flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] bg-ink px-5 py-4 text-white shadow-[0_12px_32px_rgba(26,8,16,0.28)]">
          <p className="min-w-[220px] flex-1 font-sans text-[14px] leading-[1.45]">
            <strong>{title}.</strong> {detail}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={snoozeUpdate}
              className="min-h-[44px] cursor-pointer rounded-full px-4 font-sans text-[14px] font-semibold text-white/85 hover:text-white"
            >
              Later
            </button>
            <button
              type="button"
              onClick={applyUpdate}
              className="min-h-[44px] cursor-pointer rounded-full bg-white px-5 font-sans text-[14px] font-bold text-brand hover:bg-cream"
            >
              {update.status === 'ready' ? 'Update now' : 'Reload'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A tapped notification asks an already-open window to go somewhere: navigate in place (no reload). */
export function ServiceWorkerMessages() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; path?: unknown } | null;
      if (data?.type === 'sop:navigate' && isAllowedNotificationPath(data.path)) navigate(data.path);
    };
    container.addEventListener('message', onMessage);
    container.startMessages();
    return () => container.removeEventListener('message', onMessage);
  }, [navigate]);
  return null;
}

/**
 * When the app opens on a device that already allowed notifications: confirm the subscription
 * with the server (and move it over if the server key changed). Nothing happens otherwise.
 */
export function PushReconciler() {
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    void loadPublicConfig().then((config) => reconcileOnOpen(config?.push.publicKey ?? null));
  }, []);
  return null;
}
