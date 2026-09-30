/**
 * Turning campaigns, published application updates and staff test sends into deliveries,
 * and delivering them. Every step is idempotent, because jobs are at-least-once:
 * - one frozen message per campaign (unique index);
 * - one delivery per message per device (unique key);
 * - batch jobs have deterministic dedupe keys;
 * - each delivery is re-checked (consent, account status, audience) right before sending.
 * The notification id doubles as the notification tag, so a repeat replaces rather than stacks.
 */
import { createHash } from 'node:crypto';
import { APPLICATION_UPDATE_NOTIFICATION, type NotificationTopic } from '../../src/shared/platform';
import { audit, SYSTEM } from '../audit';
import type { Queryable } from '../db';
import { enqueue, backoffMs } from '../jobs/queue';
import { deactivateSubscription, decryptSubscription } from '../push/subscriptions';
import type { Services } from '../services';
import { deviceCondition, hasFilters, parseAudience } from './audience';

export const BATCH_SIZE = 100;
/**
 * A push service that keeps refusing a subscription (malformed, or made up by someone filling the
 * list) won't start accepting it: after this many refusals in a row it's switched off, so it stops
 * inflating audiences and using up sends. Refused credentials (401/403) are counted but never switch
 * a device off: they follow from this server's own keys, which an operator can put right.
 */
export const REFUSALS_BEFORE_REMOVAL = 3;
const SUBSCRIPTION_FAULTS = new Set(['rejected', 'invalid_subscription_keys']);

async function countRefusal(db: Queryable, subscriptionId: string, error: string) {
  const { rows } = await db.query<{ failure_count: number }>(
    'update push_subscriptions set failure_count = failure_count + 1 where id = $1 returning failure_count',
    [subscriptionId],
  );
  if (SUBSCRIPTION_FAULTS.has(error) && (rows[0]?.failure_count ?? 0) >= REFUSALS_BEFORE_REMOVAL) {
    await deactivateSubscription(db, subscriptionId, 'rejected');
  }
}

export const MAX_DELIVERY_ATTEMPTS = 5;
const SEND_CONCURRENCY = 6;

type MessageRow = {
  id: string;
  origin: 'campaign' | 'application_update' | 'test';
  campaign_id: string | null;
  title: string;
  body: string;
  link_path: string;
  topic: NotificationTopic | 'test';
  expires_at: Date;
};

const hashIds = (ids: readonly string[]) => createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16);

/** Queues delivery jobs for every delivery of a message, in stable chunks (deterministic dedupe keys). */
async function enqueueDeliveries(db: Queryable, messageId: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>('select id from notification_deliveries where message_id = $1 order by id', [messageId]);
  for (let index = 0; index * BATCH_SIZE < rows.length; index++) {
    const deliveryIds = rows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE).map((row) => row.id);
    await enqueue(db, { kind: 'push.deliver', payload: { messageId, deliveryIds, attempt: 1 }, dedupeKey: `push.deliver:${messageId}:${index}:1` });
  }
  return rows.length;
}

/** Job "campaign.dispatch": freeze → deliveries + inbox → delivery jobs. Safe to run twice. */
export async function dispatchCampaign(services: Services, campaignId: string): Promise<void> {
  const { db } = services;
  const { rows } = await db.query<{
    id: string;
    status: string;
    title: string;
    body: string;
    link_path: string;
    topic: NotificationTopic;
    audience: unknown;
    also_inbox: boolean;
    ttl_seconds: number;
    scheduled_by: string | null;
  }>(
    `select id, status::text as status, title, body, link_path, topic, audience, also_inbox, ttl_seconds, scheduled_by
       from campaigns where id = $1`,
    [campaignId],
  );
  const campaign = rows[0];
  if (!campaign || (campaign.status !== 'scheduled' && campaign.status !== 'sending')) return; // cancelled or already done

  // Compare-and-set: a cancellation that lands between the read above and here wins.
  const started = await db.query(
    `update campaigns set status = 'sending', dispatched_at = coalesce(dispatched_at, now()), updated_at = now()
      where id = $1 and status in ('scheduled', 'sending') returning id`,
    [campaignId],
  );
  if (!started.rows.length) return;
  await db.query(
    `insert into notification_messages (origin, campaign_id, title, body, link_path, topic, expires_at, created_by)
     values ('campaign', $1, $2, $3, $4, $5, now() + make_interval(secs => $6), $7)
     on conflict (campaign_id) where origin = 'campaign' do nothing`,
    [campaignId, campaign.title, campaign.body, campaign.link_path, campaign.topic, campaign.ttl_seconds, campaign.scheduled_by],
  );
  const message = (await db.query<{ id: string }>(`select id from notification_messages where campaign_id = $1 and origin = 'campaign'`, [campaignId]))
    .rows[0]!;
  const audience = parseAudience(campaign.audience);
  const params = [campaign.topic, audience.cohortIds, audience.publishedStatuses, hasFilters(audience)];

  if (services.push) {
    await db.query(
      `insert into notification_deliveries (message_id, subscription_id, account_id)
       select $5, s.id, s.account_id
         from push_subscriptions s left join applicant_accounts a on a.id = s.account_id
        where ${deviceCondition('$1', '$2', '$3', '$4')}
       on conflict (message_id, subscription_id) do nothing`,
      [...params, message.id],
    );
  }
  if (campaign.also_inbox) {
    await db.query(
      `insert into inbox_items (account_id, kind, title, body, link_path, message_id)
       select a.id, 'message', $4, $5, $6, $7 from applicant_accounts a
        where a.status = 'active'
          and (not $3 or exists (select 1 from applications ap where ap.account_id = a.id
                and (cardinality($1::uuid[]) = 0 or ap.cohort_id = any($1::uuid[]))
                and (cardinality($2::text[]) = 0 or ap.published_status::text = any($2::text[]))))
       on conflict (message_id, account_id) where message_id is not null do nothing`,
      [audience.cohortIds, audience.publishedStatuses, hasFilters(audience), campaign.title, campaign.body, campaign.link_path, message.id],
    );
  }
  const deliveries = await enqueueDeliveries(db, message.id);
  if (deliveries === 0) await finishCampaignIfDone(db, message.id);
  await audit(db, SYSTEM, 'campaign.dispatched', { type: 'campaign', id: campaignId }, { deliveries });
}

/**
 * A published application decision: an inbox entry, and a neutral push to the account's
 * devices that want application updates. The lock screen never shows the decision itself.
 */
export async function notifyApplicationUpdate(services: Services, applicationId: string, accountId: string): Promise<void> {
  const { db } = services;
  const note = APPLICATION_UPDATE_NOTIFICATION;
  await db.query(
    `insert into inbox_items (account_id, kind, title, body, link_path, application_id) values ($1, 'application_update', $2, $3, $4, $5)`,
    [accountId, 'Your application has been updated', 'Open your application to see the latest status.', note.linkPath, applicationId],
  );
  if (!services.push) return;
  const { rows } = await db.query<{ id: string }>(
    `insert into notification_messages (origin, title, body, link_path, topic, expires_at)
     values ('application_update', $1, $2, $3, 'application', now() + interval '7 days') returning id`,
    [note.title, note.body, note.linkPath],
  );
  const messageId = rows[0]!.id;
  await db.query(
    `insert into notification_deliveries (message_id, subscription_id, account_id)
     select $1, s.id, s.account_id from push_subscriptions s join applicant_accounts a on a.id = s.account_id
      where s.account_id = $2 and a.status = 'active' and s.status = 'active' and 'application' = any(s.topics)
     on conflict do nothing`,
    [messageId, accountId],
  );
  await enqueueDeliveries(db, messageId);
}

/** A test send to the staff member's own registered test devices only. Never to applicants. */
export async function sendTestMessage(
  services: Services,
  staffId: string,
  content: { title: string; body: string; linkPath: string },
): Promise<number> {
  const { db } = services;
  const { rows } = await db.query<{ id: string }>(
    `insert into notification_messages (origin, title, body, link_path, topic, expires_at, created_by)
     values ('test', $1, $2, $3, 'test', now() + interval '1 hour', $4) returning id`,
    [content.title, content.body, content.linkPath, staffId],
  );
  const messageId = rows[0]!.id;
  await db.query(
    `insert into notification_deliveries (message_id, subscription_id)
     select $1, id from push_subscriptions where staff_id = $2 and status = 'active'
     on conflict do nothing`,
    [messageId, staffId],
  );
  return enqueueDeliveries(db, messageId);
}

async function finishCampaignIfDone(db: Queryable, messageId: string): Promise<void> {
  await db.query(
    `update campaigns c set status = 'sent', completed_at = now(), updated_at = now()
       from notification_messages m
      where m.id = $1 and m.origin = 'campaign' and c.id = m.campaign_id and c.status = 'sending'
        and not exists (select 1 from notification_deliveries d where d.message_id = m.id and d.status = 'queued')`,
    [messageId],
  );
}

/** Still eligible right now? (Consent, account status and audience are re-checked before each send.) */
async function eligibleNow(db: Queryable, message: MessageRow, deliveryIds: string[]): Promise<Set<string>> {
  if (message.origin === 'test') {
    const { rows } = await db.query<{ id: string }>(
      `select d.id from notification_deliveries d join push_subscriptions s on s.id = d.subscription_id
        where d.id = any($1::uuid[]) and s.status = 'active' and s.staff_id is not null`,
      [deliveryIds],
    );
    return new Set(rows.map((row) => row.id));
  }
  let audience = parseAudience({});
  if (message.origin === 'campaign') {
    const { rows } = await db.query<{ audience: unknown }>('select audience from campaigns where id = $1', [message.campaign_id]);
    audience = parseAudience(rows[0]?.audience);
  }
  const { rows } = await db.query<{ id: string }>(
    `select d.id from notification_deliveries d
       join push_subscriptions s on s.id = d.subscription_id
       left join applicant_accounts a on a.id = s.account_id
      where d.id = any($5::uuid[]) and ${deviceCondition('$1', '$2', '$3', '$4')}
        and ($6 <> 'application_update' or s.account_id = d.account_id)`,
    [message.topic, audience.cohortIds, audience.publishedStatuses, hasFilters(audience), deliveryIds, message.origin],
  );
  return new Set(rows.map((row) => row.id));
}

async function runPool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/** Job "push.deliver": sends one batch. Retryable failures are re-queued as a smaller batch with backoff. */
export async function deliverBatch(services: Services, payload: { messageId: string; deliveryIds: string[]; attempt: number }): Promise<void> {
  const { db } = services;
  const { rows: messages } = await db.query<MessageRow>(
    `select id, origin, campaign_id, title, body, link_path, topic, expires_at from notification_messages where id = $1`,
    [payload.messageId],
  );
  const message = messages[0];
  if (!message) return;
  const ids = payload.deliveryIds.filter((id) => typeof id === 'string').slice(0, BATCH_SIZE);

  if (message.origin === 'campaign') {
    const { rows: campaigns } = await db.query<{ status: string }>('select status::text as status from campaigns where id = $1', [message.campaign_id]);
    if (campaigns[0]?.status !== 'sending') {
      // Cancelled while this batch was waiting (or being claimed): send nothing more.
      await db.query(
        `update notification_deliveries set status = 'skipped', last_error = 'campaign_cancelled', updated_at = now()
          where id = any($1::uuid[]) and status = 'queued'`,
        [ids],
      );
      return;
    }
  }
  if (new Date(message.expires_at) <= new Date()) {
    await db.query(
      `update notification_deliveries set status = 'expired', updated_at = now() where id = any($1::uuid[]) and status = 'queued'`,
      [ids],
    );
    await finishCampaignIfDone(db, message.id);
    return;
  }
  if (!services.push) {
    await db.query(
      `update notification_deliveries set status = 'failed', last_error = 'push_not_configured', updated_at = now()
        where id = any($1::uuid[]) and status = 'queued'`,
      [ids],
    );
    await finishCampaignIfDone(db, message.id);
    return;
  }
  const push = services.push;

  const { rows: deliveries } = await db.query<{ id: string; subscription_id: string; endpoint_enc: string; keys_enc: string }>(
    `select d.id, d.subscription_id, s.endpoint_enc, s.keys_enc
       from notification_deliveries d join push_subscriptions s on s.id = d.subscription_id
      where d.id = any($1::uuid[]) and d.status = 'queued'`,
    [ids],
  );
  const eligible = await eligibleNow(db, message, deliveries.map((delivery) => delivery.id));
  const skipped = deliveries.filter((delivery) => !eligible.has(delivery.id)).map((delivery) => delivery.id);
  if (skipped.length) {
    await db.query(
      `update notification_deliveries set status = 'skipped', last_error = 'no_longer_eligible', updated_at = now()
        where id = any($1::uuid[]) and status = 'queued'`,
      [skipped],
    );
  }

  const ttlSeconds = Math.max(0, Math.floor((new Date(message.expires_at).getTime() - Date.now()) / 1000));
  const retry: string[] = [];
  let retryAfter = 0;
  await runPool(
    deliveries.filter((delivery) => eligible.has(delivery.id)),
    SEND_CONCURRENCY,
    async (delivery) => {
      const outcome = await push.send(
        decryptSubscription(services, delivery),
        { v: 1, id: message.id, title: message.title, body: message.body, url: message.link_path, expiresAt: new Date(message.expires_at).toISOString() },
        { ttlSeconds, urgency: message.origin === 'application_update' ? 'high' : 'normal' },
      );
      const status = outcome.kind === 'accepted' ? 'accepted' : outcome.kind === 'retry' ? 'queued' : 'failed';
      const error = outcome.kind === 'gone' ? 'subscription_gone' : outcome.kind === 'accepted' ? null : outcome.error;
      await db.query(
        // Explicit casts: $2 is used twice, and Postgres must deduce the same type for both.
        `update notification_deliveries set status = $2::delivery_status, attempts = attempts + 1, last_http_status = $3::int,
                last_error = $4::text, accepted_at = case when $2::delivery_status = 'accepted' then now() else accepted_at end, updated_at = now()
          where id = $1`,
        [delivery.id, status, outcome.status || null, error],
      );
      if (outcome.kind === 'gone') await deactivateSubscription(db, delivery.subscription_id, 'expired');
      else if (outcome.kind === 'accepted') {
        await db.query('update push_subscriptions set failure_count = 0 where id = $1 and failure_count > 0', [delivery.subscription_id]);
      } else if (outcome.kind === 'failed') await countRefusal(db, delivery.subscription_id, outcome.error);
      else if (outcome.kind === 'retry') {
        retry.push(delivery.id);
        retryAfter = Math.max(retryAfter, outcome.retryAfterSeconds ?? 0);
      }
    },
  );

  if (retry.length) {
    if (payload.attempt < MAX_DELIVERY_ATTEMPTS) {
      const next = payload.attempt + 1;
      await enqueue(db, {
        kind: 'push.deliver',
        payload: { messageId: message.id, deliveryIds: retry, attempt: next },
        runAt: new Date(Date.now() + backoffMs(payload.attempt, retryAfter)),
        dedupeKey: `push.deliver:${message.id}:${hashIds(retry)}:${next}`,
      });
    } else {
      await db.query(
        `update notification_deliveries set status = 'failed', last_error = 'retries_exhausted', updated_at = now()
          where id = any($1::uuid[]) and status = 'queued'`,
        [retry],
      );
    }
  }
  await finishCampaignIfDone(db, message.id);
}

/** Cancels a scheduled or sending campaign: nothing more is sent; what's queued is marked skipped. */
export async function stopCampaignDeliveries(db: Queryable, campaignId: string): Promise<void> {
  await db.query(
    `update jobs set status = 'cancelled', finished_at = now(), updated_at = now()
      where status = 'pending' and ((kind = 'campaign.dispatch' and payload->>'campaignId' = $1)
         or (kind = 'push.deliver' and payload->>'messageId' in (select id::text from notification_messages where campaign_id = $1::uuid)))`,
    [campaignId],
  );
  await db.query(
    `update notification_deliveries set status = 'skipped', last_error = 'campaign_cancelled', updated_at = now()
      where status = 'queued' and message_id in (select id from notification_messages where campaign_id = $1)`,
    [campaignId],
  );
}
