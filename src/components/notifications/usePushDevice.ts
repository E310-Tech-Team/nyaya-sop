import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CsrfScope } from '../../lib/api';
import { usePublicConfig } from '../../lib/config';
import {
  changeTopics,
  disableNotifications,
  enableNotifications,
  linkThisDevice,
  pushSupport,
  readDeviceStatus,
  serviceWorkerReady,
  type DeviceStatus,
} from '../../lib/push';
import { TOPIC_DETAILS, type NotificationTopic } from '../../shared/platform';

/** This device's notification state and the actions that change it. */
export function usePushDevice(options: { signedIn?: boolean } = {}) {
  const config = usePublicConfig();
  const support = useMemo(pushSupport, []);
  const csrf: CsrfScope | undefined = options.signedIn ? 'applicant' : undefined;
  const publicKey = config?.push.publicKey ?? null;
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null | undefined>(undefined);
  const [status, setStatus] = useState<DeviceStatus | null>(null); // null while checking
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (support.kind !== 'supported' || !config?.push.enabled) return;
    setStatus(await readDeviceStatus(publicKey));
  }, [support.kind, config?.push.enabled, publicKey]);

  useEffect(() => {
    if (support.kind !== 'supported' || !config?.push.enabled) return;
    let cancelled = false;
    void serviceWorkerReady().then((value) => !cancelled && setRegistration(value));
    void readDeviceStatus(publicKey).then((value) => !cancelled && setStatus(value));
    return () => {
      cancelled = true;
    };
  }, [support.kind, config?.push.enabled, publicKey]);

  /** Must be called straight from a click: subscribe() is its first step. */
  const enable = useCallback(
    async (topics: NotificationTopic[]) => {
      setError(null);
      if (!registration || !publicKey) {
        setStatus({ kind: 'failed', message: 'Notifications need this site’s background service, which isn’t running. Reload the page and try again.' });
        return;
      }
      setBusy(true);
      const next = await enableNotifications({ registration, publicKey, topics, csrf });
      setStatus(next);
      setBusy(false);
    },
    [registration, publicKey, csrf],
  );

  const save = useCallback(
    async (topics: NotificationTopic[]) => {
      setError(null);
      setBusy(true);
      try {
        const wantsAccountTopics = topics.some((topic) => TOPIC_DETAILS[topic].requiresAccount);
        if (options.signedIn && wantsAccountTopics && status?.kind === 'enabled' && !status.server.linkedToAccount) await linkThisDevice();
        const server = await changeTopics(topics, csrf);
        setStatus(server.status === 'active' ? { kind: 'enabled', server } : { kind: 'off' });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [options.signedIn, status, csrf],
  );

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await disableNotifications();
      setStatus({ kind: 'off' });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    configLoaded: config !== null,
    serverEnabled: Boolean(config?.push.enabled),
    support,
    status,
    busy,
    error,
    ready: registration !== undefined,
    enable,
    save,
    disable,
    refresh,
  };
}

export type PushDevice = ReturnType<typeof usePushDevice>;
