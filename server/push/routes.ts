/**
 * Public push-subscription endpoints (/api/push). Anyone may subscribe this device to public
 * announcements; application and training topics need a signed-in, verified applicant.
 * Changing or removing a subscription needs its auth secret (see subscriptions.ts).
 * Nothing here logs endpoints, keys or payloads.
 */
import type { FastifyInstance } from 'fastify';
import { NOTIFICATION_CONSENT_VERSION } from '../../src/shared/platform';
import { recordEvent } from '../analytics';
import { checkOrigin, optionalAccount } from '../auth/guards';
import { deviceLabel, sendError } from '../http';
import type { Services } from '../services';
import { getSettings } from '../settings';
import {
  allowedTopics,
  deactivateSubscription,
  deviceState,
  findOwned,
  parseSubscription,
  recordConsent,
  registerSubscription,
} from './subscriptions';

export async function pushRoutes(app: FastifyInstance, services: Services) {
  const { db, config } = services;
  const limit = { rateLimit: { max: 30, timeWindow: 60_000 } };

  const ready = (reply: Parameters<typeof sendError>[0]) => {
    if (services.push) return true;
    sendError(reply, 503, 'PUSH_UNAVAILABLE', 'Notifications aren’t available on this site yet.');
    return false;
  };

  app.post('/subscribe', { config: limit }, async (request, reply) => {
    if (!checkOrigin(services, request, reply) || !ready(reply)) return reply;
    const body = request.body as { subscription?: unknown; topics?: unknown; consentVersion?: unknown } | null;
    if (body?.consentVersion !== NOTIFICATION_CONSENT_VERSION) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Please reload the page and confirm the notification choices again.');
    }
    const parsed = parseSubscription(body.subscription, config.push.extraHosts);
    if (!parsed.ok) {
      request.log.warn({ reason: parsed.reason }, 'Push subscription refused');
      return sendError(reply, 400, 'VALIDATION_FAILED', 'This browser’s notification service isn’t supported.');
    }
    const account = await optionalAccount(services, request);
    const requested = Array.isArray(body.topics) ? body.topics : [];
    const topics = allowedTopics(requested, Boolean(account));
    if (requested.length > topics.length && !account) {
      return sendError(reply, 403, 'FORBIDDEN', 'Sign in to your account to get application updates and training reminders.');
    }
    if (!topics.length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose at least one kind of notification.');
    if (!account && !(await getSettings(db)).public_notifications_enabled) {
      return sendError(reply, 403, 'FORBIDDEN', 'New public notification sign-ups are paused. Please try again later.');
    }
    const result = await registerSubscription(services, {
      sub: parsed.value,
      topics,
      accountId: account?.id ?? null,
      staffId: null,
      deviceLabel: deviceLabel(request.headers['user-agent']),
    });
    if ('conflict' in result) {
      return sendError(reply, 409, 'CONFLICT', 'This device’s notification registration changed. Turn notifications off and on again.');
    }
    if (result.created || result.reactivated) await recordEvent(db, 'push_opt_in');
    return reply.code(result.created ? 201 : 200).send(deviceState(result.row));
  });

  /** Reconciliation when the app opens: what the server knows about this browser's subscription. */
  app.post('/status', { config: limit }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const body = request.body as { endpoint?: unknown; auth?: unknown } | null;
    const row = await findOwned(db, body?.endpoint, body?.auth);
    if (!row) return { status: 'unknown' as const };
    if (row.status === 'active') await db.query('update push_subscriptions set last_seen_at = now() where id = $1', [row.id]);
    return deviceState(row);
  });

  app.post('/topics', { config: limit }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const body = request.body as { endpoint?: unknown; auth?: unknown; topics?: unknown } | null;
    const row = await findOwned(db, body?.endpoint, body?.auth);
    if (!row || row.status !== 'active' || row.staff_id) return sendError(reply, 404, 'NOT_FOUND', 'Notifications aren’t on for this device.');
    // Account topics on a linked device need that account to be the one signed in here.
    const account = row.account_id ? await optionalAccount(services, request) : null;
    const ownsAccountTopics = Boolean(account && account.id === row.account_id);
    const requested = Array.isArray(body?.topics) ? body.topics : [];
    const topics = allowedTopics(requested, ownsAccountTopics);
    if (requested.length > topics.length) {
      return sendError(reply, 403, 'FORBIDDEN', 'Sign in to the account linked to this device to change those notifications.');
    }
    const keep = ownsAccountTopics ? [] : row.topics.filter((topic) => topic !== 'general'); // leave account topics alone
    const next = [...new Set([...topics, ...keep])];
    if (!next.length) {
      await deactivateSubscription(db, row.id, 'unsubscribed');
      await recordEvent(db, 'push_opt_out');
      return { ...deviceState(row), status: 'revoked', topics: [] };
    }
    const { rows } = await db.query<{ topics: typeof row.topics }>(
      'update push_subscriptions set topics = $2, updated_at = now() where id = $1 returning topics',
      [row.id, next],
    );
    await recordConsent(db, row.id, row.account_id, 'update', rows[0]!.topics);
    return { ...deviceState(row), topics: rows[0]!.topics };
  });

  app.post('/unsubscribe', { config: limit }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const body = request.body as { endpoint?: unknown; auth?: unknown } | null;
    const row = await findOwned(db, body?.endpoint, body?.auth);
    if (row?.status === 'active') {
      await deactivateSubscription(db, row.id, 'unsubscribed');
      await recordEvent(db, 'push_opt_out');
    }
    return { ok: true };
  });

  /**
   * From the service worker's pushsubscriptionchange handler: the browser replaced the
   * subscription. Ownership is proven with the old auth secret; topics and links carry over.
   */
  app.post('/rotate', { config: limit }, async (request, reply) => {
    if (!checkOrigin(services, request, reply) || !ready(reply)) return reply;
    const body = request.body as { oldEndpoint?: unknown; oldAuth?: unknown; subscription?: unknown } | null;
    const old = await findOwned(db, body?.oldEndpoint, body?.oldAuth);
    const parsed = parseSubscription(body?.subscription, config.push.extraHosts);
    if (!old || old.staff_id || !parsed.ok) return sendError(reply, 404, 'NOT_FOUND', 'Nothing to update.');
    const result = await registerSubscription(services, {
      sub: parsed.value,
      topics: old.topics,
      accountId: old.account_id,
      staffId: null,
      deviceLabel: old.device_label ?? deviceLabel(request.headers['user-agent']),
    });
    if ('conflict' in result) return sendError(reply, 409, 'CONFLICT', 'Could not update this device.');
    if (result.row.id !== old.id) await deactivateSubscription(db, old.id, 'replaced');
    return deviceState(result.row);
  });
}
