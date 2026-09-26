/**
 * Announcements, notification campaigns and staff test devices (/api/admin/...).
 *
 * Campaign rules:
 * - Created as drafts with a client-supplied idempotency key (a retried "create" can't duplicate).
 * - Content can only change while a draft; scheduling or sending freezes it.
 * - Scheduling needs campaigns.send and the audience count the sender was shown: if the
 *   audience changed since the preview, the request is refused with fresh counts.
 * - The audience is evaluated when sending starts and re-checked before each device's send.
 * - Test sends go only to the sender's own registered test devices.
 * Reported numbers are what we know: queued, attempted, accepted by the push service, failed,
 * expired, skipped. Never "delivered" or "read".
 */
import type { FastifyInstance } from 'fastify';
import {
  CAMPAIGN_LIMITS,
  isAllowedNotificationPath,
  isNotificationTopic,
  type NotificationTopic,
} from '../../src/shared/platform';
import { DEFAULT_TIME_ZONE, isValidTimeZone, zonedLocalToUtc } from '../../src/shared/time';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { staffActor } from '../auth/staff-routes';
import { deviceLabel, iso, isUuid, sendError, str } from '../http';
import { enqueue } from '../jobs/queue';
import { countAudience, parseAudience } from '../notifications/audience';
import { sendTestMessage, stopCampaignDeliveries } from '../notifications/dispatch';
import { deactivateSubscription, parseSubscription, registerSubscription } from '../push/subscriptions';
import type { Services } from '../services';

type CampaignRow = {
  id: string;
  title: string;
  body: string;
  link_path: string;
  topic: NotificationTopic;
  audience: unknown;
  also_inbox: boolean;
  ttl_seconds: number;
  status: string;
  scheduled_for: Date | null;
  time_zone: string;
  frozen_at: Date | null;
  created_at: Date;
  dispatched_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_by_name: string | null;
};

function parseContent(input: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!title || title.length > CAMPAIGN_LIMITS.title) errors.title = `Write a title of up to ${CAMPAIGN_LIMITS.title} characters.`;
  if (!body || body.length > CAMPAIGN_LIMITS.body) errors.body = `Write a message of up to ${CAMPAIGN_LIMITS.body} characters.`;
  if (!isAllowedNotificationPath(input.linkPath)) errors.linkPath = 'Choose where the notification opens.';
  if (!isNotificationTopic(input.topic)) errors.topic = 'Choose a topic.';
  const ttlHours = Number(input.ttlHours ?? 24);
  const ttlSeconds = Math.round(ttlHours * 3600);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < CAMPAIGN_LIMITS.ttlMinSeconds || ttlSeconds > CAMPAIGN_LIMITS.ttlMaxSeconds) {
    errors.ttlHours = 'Keep it between 1 and 672 hours (28 days).';
  }
  return {
    errors,
    values: {
      title,
      body,
      linkPath: input.linkPath as string,
      topic: input.topic as NotificationTopic,
      audience: parseAudience(input.audience),
      alsoInbox: input.alsoInbox !== false,
      ttlSeconds,
    },
  };
}

async function campaignStats(services: Services, campaignId: string) {
  const { rows } = await services.db.query<{ status: string; n: number; attempted: number; message_id: string }>(
    `select d.status::text as status, count(*)::int as n, count(*) filter (where d.attempts > 0)::int as attempted, m.id as message_id
       from notification_messages m join notification_deliveries d on d.message_id = m.id
      where m.campaign_id = $1 and m.origin = 'campaign' group by d.status, m.id`,
    [campaignId],
  );
  const count = (status: string) => rows.find((row) => row.status === status)?.n ?? 0;
  const messageId = rows[0]?.message_id ?? null;
  const inbox = await services.db.query<{ n: number }>(
    `select count(*)::int as n from inbox_items i join notification_messages m on m.id = i.message_id where m.campaign_id = $1`,
    [campaignId],
  );
  const clicks = messageId
    ? await services.db.query<{ n: number }>(
        `select count(*)::int as n from analytics_events where name = 'notification_click' and properties->>'messageId' = $1`,
        [messageId],
      )
    : { rows: [{ n: 0 }] };
  return {
    devices: rows.reduce((sum, row) => sum + row.n, 0),
    queued: count('queued'),
    attempted: rows.reduce((sum, row) => sum + row.attempted, 0),
    acceptedByPushService: count('accepted'),
    failed: count('failed'),
    expired: count('expired'),
    skipped: count('skipped'),
    inboxEntries: inbox.rows[0]!.n,
    /** Only clicks the service worker could report; not every click is observable. */
    recordedClicks: clicks.rows[0]!.n,
  };
}

const campaignJson = (row: CampaignRow) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  linkPath: row.link_path,
  topic: row.topic,
  audience: parseAudience(row.audience),
  alsoInbox: row.also_inbox,
  ttlHours: row.ttl_seconds / 3600,
  status: row.status,
  scheduledFor: iso(row.scheduled_for),
  timeZone: row.time_zone,
  frozenAt: iso(row.frozen_at),
  createdAt: iso(row.created_at),
  dispatchedAt: iso(row.dispatched_at),
  completedAt: iso(row.completed_at),
  cancelledAt: iso(row.cancelled_at),
  createdBy: row.created_by_name,
});

export async function communicationRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const manage = staffGuard(services, { permission: 'campaigns.manage' });
  const send = staffGuard(services, { permission: 'campaigns.send' });
  const announcements = staffGuard(services, { permission: 'announcements.manage' });

  const loadCampaign = async (id: string) => {
    if (!isUuid(id)) return null;
    const { rows } = await db.query<CampaignRow>(
      `select c.*, c.status::text as status, s.display_name as created_by_name
         from campaigns c left join staff_users s on s.id = c.created_by where c.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  };

  // ── Campaigns ────────────────────────────────────────────────────────────

  app.get('/campaigns', { preHandler: manage }, async () => {
    const { rows } = await db.query<CampaignRow>(
      `select c.*, c.status::text as status, s.display_name as created_by_name
         from campaigns c left join staff_users s on s.id = c.created_by order by c.created_at desc limit 200`,
    );
    return { items: await Promise.all(rows.map(async (row) => ({ ...campaignJson(row), stats: await campaignStats(services, row.id) }))) };
  });

  app.post('/campaigns', { preHandler: manage }, async (request, reply) => {
    const input = (request.body ?? {}) as Record<string, unknown>;
    const key = str(input, 'idempotencyKey', 80);
    if (!key || key.length < 8) return sendError(reply, 400, 'BAD_REQUEST', 'Missing idempotency key.');
    const { errors, values } = parseContent(input);
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    const { rows } = await db.query<{ id: string }>(
      `insert into campaigns (idempotency_key, title, body, link_path, topic, audience, also_inbox, ttl_seconds, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (idempotency_key) do nothing returning id`,
      [key, values.title, values.body, values.linkPath, values.topic, JSON.stringify(values.audience), values.alsoInbox, values.ttlSeconds, request.staff!.id],
    );
    if (!rows[0]) {
      const existing = await db.query<{ id: string }>('select id from campaigns where idempotency_key = $1', [key]);
      return reply.code(200).send({ id: existing.rows[0]!.id, duplicate: true });
    }
    await audit(db, staffActor(request.staff!), 'campaign.created', { type: 'campaign', id: rows[0].id }, { topic: values.topic });
    return reply.code(201).send({ id: rows[0].id });
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', { preHandler: manage }, async (request, reply) => {
    const campaign = await loadCampaign(request.params.id);
    if (!campaign) return sendError(reply, 404, 'NOT_FOUND', 'Campaign not found.');
    const live = campaign.status === 'draft' || campaign.status === 'scheduled';
    return {
      campaign: campaignJson(campaign),
      stats: await campaignStats(services, campaign.id),
      audience: live ? await countAudience(db, campaign.topic, parseAudience(campaign.audience)) : null,
    };
  });

  app.patch<{ Params: { id: string } }>('/campaigns/:id', { preHandler: manage }, async (request, reply) => {
    const campaign = await loadCampaign(request.params.id);
    if (!campaign) return sendError(reply, 404, 'NOT_FOUND', 'Campaign not found.');
    if (campaign.status !== 'draft') return sendError(reply, 409, 'CONFLICT', 'Only drafts can be edited. Cancel it and make a copy to change it.');
    const { errors, values } = parseContent((request.body ?? {}) as Record<string, unknown>);
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    await db.query(
      `update campaigns set title = $2, body = $3, link_path = $4, topic = $5, audience = $6, also_inbox = $7, ttl_seconds = $8, updated_at = now()
        where id = $1 and status = 'draft'`,
      [campaign.id, values.title, values.body, values.linkPath, values.topic, JSON.stringify(values.audience), values.alsoInbox, values.ttlSeconds],
    );
    await audit(db, staffActor(request.staff!), 'campaign.edited', { type: 'campaign', id: campaign.id });
    return { ok: true };
  });

  /** Preview counts for unsaved choices (the editor shows these live). */
  app.post('/campaigns/audience-preview', { preHandler: manage }, async (request, reply) => {
    const input = (request.body ?? {}) as Record<string, unknown>;
    if (!isNotificationTopic(input.topic)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a topic.');
    return countAudience(db, input.topic, parseAudience(input.audience));
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/test', { preHandler: manage, config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    const campaign = await loadCampaign(request.params.id);
    if (!campaign) return sendError(reply, 404, 'NOT_FOUND', 'Campaign not found.');
    if (!services.push) return sendError(reply, 503, 'PUSH_UNAVAILABLE', 'Push isn’t configured on this server.');
    const devices = await sendTestMessage(services, request.staff!.id, { title: campaign.title, body: campaign.body, linkPath: campaign.link_path });
    if (!devices) return sendError(reply, 400, 'VALIDATION_FAILED', 'Register one of your devices as a test device first (Notifications → Your test devices).');
    await audit(db, staffActor(request.staff!), 'campaign.test_sent', { type: 'campaign', id: campaign.id }, { devices });
    return { devices };
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/schedule', { preHandler: send }, async (request, reply) => {
    const campaign = await loadCampaign(request.params.id);
    if (!campaign) return sendError(reply, 404, 'NOT_FOUND', 'Campaign not found.');
    if (campaign.status !== 'draft') return sendError(reply, 409, 'CONFLICT', 'This campaign has already been scheduled or sent.');
    const body = (request.body ?? {}) as { when?: unknown; localTime?: unknown; timeZone?: unknown; confirmDevices?: unknown; confirmInbox?: unknown };
    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_TIME_ZONE;
    let sendAt = new Date();
    if (body.when === 'later') {
      try {
        sendAt = zonedLocalToUtc(String(body.localTime ?? ''), timeZone);
      } catch {
        return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a date and time.');
      }
      if (sendAt.getTime() < Date.now() + 60_000) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a time at least a minute from now.');
      if (sendAt.getTime() > Date.now() + 90 * 86_400_000) return sendError(reply, 400, 'VALIDATION_FAILED', 'Schedule up to 90 days ahead.');
    } else if (body.when !== 'now') {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose to send now or later.');
    }
    const audience = await countAudience(db, campaign.topic, parseAudience(campaign.audience));
    const inbox = campaign.also_inbox ? audience.inboxAccounts : 0;
    if (body.confirmDevices !== audience.devices || body.confirmInbox !== inbox) {
      return reply.code(409).send({
        code: 'CONFLICT',
        message: 'The audience changed since you checked it. Review the new numbers and confirm again.',
        audience,
      });
    }
    const { rows } = await db.query(
      `update campaigns set status = 'scheduled', scheduled_for = $2, time_zone = $3, frozen_at = now(), scheduled_by = $4, updated_at = now()
        where id = $1 and status = 'draft' returning id`,
      [campaign.id, sendAt, timeZone, request.staff!.id],
    );
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'This campaign has already been scheduled or sent.');
    await enqueue(db, { kind: 'campaign.dispatch', payload: { campaignId: campaign.id }, runAt: sendAt, dedupeKey: `campaign.dispatch:${campaign.id}` });
    await audit(db, staffActor(request.staff!), 'campaign.scheduled', { type: 'campaign', id: campaign.id }, {
      sendAt: sendAt.toISOString(),
      timeZone,
      devices: audience.devices,
      inboxAccounts: inbox,
    });
    return { ok: true, scheduledFor: sendAt.toISOString() };
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/cancel', { preHandler: send }, async (request, reply) => {
    const campaign = await loadCampaign(request.params.id);
    if (!campaign) return sendError(reply, 404, 'NOT_FOUND', 'Campaign not found.');
    const { rows } = await db.query(
      `update campaigns set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, frozen_at = coalesce(frozen_at, now()), updated_at = now()
        where id = $1 and status in ('draft', 'scheduled', 'sending') returning id`,
      [campaign.id, request.staff!.id],
    );
    if (!rows.length) return sendError(reply, 409, 'CONFLICT', 'Only drafts, scheduled or sending campaigns can be cancelled.');
    await stopCampaignDeliveries(db, campaign.id);
    await audit(db, staffActor(request.staff!), 'campaign.cancelled', { type: 'campaign', id: campaign.id }, { previousStatus: campaign.status });
    return { ok: true };
  });

  // ── Staff test devices ───────────────────────────────────────────────────

  app.get('/test-devices', { preHandler: manage }, async (request) => {
    const { rows } = await db.query<{ id: string; device_label: string | null; created_at: Date; last_seen_at: Date }>(
      `select id, device_label, created_at, last_seen_at from push_subscriptions where staff_id = $1 and status = 'active' order by created_at desc`,
      [request.staff!.id],
    );
    return { devices: rows.map((row) => ({ id: row.id, label: row.device_label ?? 'Unknown device', createdAt: iso(row.created_at), lastSeenAt: iso(row.last_seen_at) })) };
  });

  app.post('/test-devices', { preHandler: manage }, async (request, reply) => {
    if (!services.push) return sendError(reply, 503, 'PUSH_UNAVAILABLE', 'Push isn’t configured on this server.');
    const parsed = parseSubscription((request.body as { subscription?: unknown } | null)?.subscription, services.config.push.extraHosts);
    if (!parsed.ok) return sendError(reply, 400, 'VALIDATION_FAILED', 'This browser’s notification service isn’t supported.');
    const result = await registerSubscription(services, {
      sub: parsed.value,
      topics: [],
      accountId: null,
      staffId: request.staff!.id,
      deviceLabel: deviceLabel(request.headers['user-agent']),
    });
    if ('conflict' in result) return sendError(reply, 409, 'CONFLICT', 'Turn notifications off and on again in this browser, then retry.');
    await audit(db, staffActor(request.staff!), 'staff.test_device_added', { type: 'push_subscription', id: result.row.id });
    return reply.code(201).send({ id: result.row.id });
  });

  app.post<{ Params: { id: string } }>('/test-devices/:id/remove', { preHandler: manage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Device not found.');
    const { rows } = await db.query<{ id: string }>(`select id from push_subscriptions where id = $1 and staff_id = $2`, [request.params.id, request.staff!.id]);
    if (!rows[0]) return sendError(reply, 404, 'NOT_FOUND', 'Device not found.');
    await deactivateSubscription(db, rows[0].id, 'unsubscribed');
    return { ok: true };
  });

  // ── Announcements ────────────────────────────────────────────────────────

  app.get('/announcements', { preHandler: announcements }, async () => {
    const { rows } = await db.query<{
      id: string;
      audience: string;
      cohort_id: string | null;
      cohort_name: string | null;
      title: string;
      body: string;
      status: string;
      published_at: Date | null;
      updated_at: Date;
    }>(
      `select n.id, n.audience::text as audience, n.cohort_id, c.name as cohort_name, n.title, n.body, n.status::text as status,
              n.published_at, n.updated_at
         from announcements n left join cohorts c on c.id = n.cohort_id order by n.updated_at desc limit 200`,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        audience: row.audience,
        cohort: row.cohort_id ? { id: row.cohort_id, name: row.cohort_name } : null,
        title: row.title,
        body: row.body,
        status: row.status,
        publishedAt: iso(row.published_at),
        updatedAt: iso(row.updated_at),
      })),
    };
  });

  const parseAnnouncement = (input: Record<string, unknown>) => {
    const errors: Record<string, string> = {};
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    const audience = input.audience === 'public' || input.audience === 'applicants' ? input.audience : null;
    if (!title || title.length > 120) errors.title = 'Write a title of up to 120 characters.';
    if (!body || body.length > 5000) errors.body = 'Write the announcement (up to 5,000 characters).';
    if (!audience) errors.audience = 'Choose who sees it.';
    const cohortId = audience === 'applicants' && isUuid(input.cohortId) ? input.cohortId : null;
    return { errors, values: { title, body, audience, cohortId } };
  };

  app.post('/announcements', { preHandler: announcements }, async (request, reply) => {
    const { errors, values } = parseAnnouncement((request.body ?? {}) as Record<string, unknown>);
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    const { rows } = await db.query<{ id: string }>(
      `insert into announcements (audience, cohort_id, title, body, created_by) values ($1, $2, $3, $4, $5) returning id`,
      [values.audience, values.cohortId, values.title, values.body, request.staff!.id],
    );
    await audit(db, staffActor(request.staff!), 'announcement.created', { type: 'announcement', id: rows[0]!.id }, { audience: values.audience });
    return reply.code(201).send({ id: rows[0]!.id });
  });

  app.patch<{ Params: { id: string } }>('/announcements/:id', { preHandler: announcements }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Announcement not found.');
    const { errors, values } = parseAnnouncement((request.body ?? {}) as Record<string, unknown>);
    if (Object.keys(errors).length) return sendError(reply, 400, 'VALIDATION_FAILED', 'Some details need attention.', { fieldErrors: errors as never });
    const { rows } = await db.query(
      `update announcements set audience = $2, cohort_id = $3, title = $4, body = $5, updated_at = now()
        where id = $1 and status <> 'archived' returning id`,
      [request.params.id, values.audience, values.cohortId, values.title, values.body],
    );
    if (!rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Announcement not found (archived announcements can’t be edited).');
    await audit(db, staffActor(request.staff!), 'announcement.edited', { type: 'announcement', id: request.params.id });
    return { ok: true };
  });

  for (const action of ['publish', 'archive'] as const) {
    app.post<{ Params: { id: string } }>(`/announcements/:id/${action}`, { preHandler: announcements }, async (request, reply) => {
      if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Announcement not found.');
      const { rows } =
        action === 'publish'
          ? await db.query(
              `update announcements set status = 'published', published_at = now(), updated_at = now() where id = $1 and status = 'draft' returning id`,
              [request.params.id],
            )
          : await db.query(
              `update announcements set status = 'archived', updated_at = now() where id = $1 and status = 'published' returning id`,
              [request.params.id],
            );
      if (!rows.length) return sendError(reply, 409, 'CONFLICT', action === 'publish' ? 'Only drafts can be published.' : 'Only published announcements can be archived.');
      await audit(db, staffActor(request.staff!), `announcement.${action === 'publish' ? 'published' : 'archived'}`, { type: 'announcement', id: request.params.id });
      return { ok: true };
    });
  }
}
