/**
 * Push subscriptions. The endpoint and keys are encrypted at rest; a browser proves it owns a
 * subscription by presenting its `auth` secret (16 random bytes only it and we know), which we
 * compare with a stored hash. Endpoints are unique: re-subscribing updates the same row.
 */
import {
  NOTIFICATION_CONSENT_VERSION,
  isNotificationTopic,
  type NotificationTopic,
  type PushDeviceState,
  type PushSubscriptionJson,
} from '../../src/shared/platform';
import { safeEqual, sha256Hex } from '../crypto';
import type { Queryable } from '../db';
import type { Services } from '../services';
import { checkPushEndpoint } from './endpoint';

export type SubscriptionRow = {
  id: string;
  endpoint_enc: string;
  keys_enc: string;
  auth_hash: string;
  push_host: string;
  account_id: string | null;
  staff_id: string | null;
  topics: NotificationTopic[];
  status: 'active' | 'expired' | 'revoked';
  device_label: string | null;
  consent_version: string | null;
  consent_at: Date | null;
  created_at: Date;
  last_seen_at: Date;
};

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const bytes = (value: string) => Buffer.from(value, 'base64url');

export type ParsedSubscription = { endpoint: string; expirationTime: Date | null; keys: { p256dh: string; auth: string }; host: string };

export function parseSubscription(input: unknown, extraHosts: readonly string[]): { ok: true; value: ParsedSubscription } | { ok: false; reason: string } {
  const sub = input as Partial<PushSubscriptionJson> | null;
  if (!sub || typeof sub !== 'object') return { ok: false, reason: 'missing' };
  const endpoint = checkPushEndpoint(sub.endpoint, extraHosts);
  if (!endpoint.ok) return { ok: false, reason: endpoint.reason };
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  // P-256 public key: 65-byte uncompressed point (0x04 prefix). Auth secret: 16 bytes.
  if (typeof p256dh !== 'string' || !B64URL.test(p256dh) || bytes(p256dh).length !== 65 || bytes(p256dh)[0] !== 4) {
    return { ok: false, reason: 'invalid_p256dh' };
  }
  if (typeof auth !== 'string' || !B64URL.test(auth) || bytes(auth).length !== 16) return { ok: false, reason: 'invalid_auth' };
  // Browsers send null or a time in milliseconds; anything a Date can't hold is ignored.
  const expiration = typeof sub.expirationTime === 'number' && sub.expirationTime > 0 && sub.expirationTime <= 8.64e15 ? new Date(sub.expirationTime) : null;
  return { ok: true, value: { endpoint: sub.endpoint as string, expirationTime: expiration, keys: { p256dh, auth }, host: endpoint.host } };
}

export const endpointHash = (endpoint: string) => sha256Hex(`push-endpoint:${endpoint}`);
const authHash = (auth: string) => sha256Hex(`push-auth:${auth}`);

const COLUMNS = `id, endpoint_enc, keys_enc, auth_hash, push_host, account_id, staff_id, topics, status::text as status,
                 device_label, consent_version, consent_at, created_at, last_seen_at`;

export async function findByEndpoint(db: Queryable, endpoint: string): Promise<SubscriptionRow | null> {
  const { rows } = await db.query<SubscriptionRow>(`select ${COLUMNS} from push_subscriptions where endpoint_hash = $1`, [endpointHash(endpoint)]);
  return rows[0] ?? null;
}

/** The row for this endpoint, only if the caller also holds its auth secret. */
export async function findOwned(db: Queryable, endpoint: unknown, auth: unknown): Promise<SubscriptionRow | null> {
  if (typeof endpoint !== 'string' || typeof auth !== 'string' || endpoint.length > 2048 || auth.length > 64) return null;
  const row = await findByEndpoint(db, endpoint);
  return row && safeEqual(row.auth_hash, authHash(auth)) ? row : null;
}

export function decryptSubscription(services: Services, row: Pick<SubscriptionRow, 'endpoint_enc' | 'keys_enc'>) {
  return { endpoint: services.secrets.decrypt(row.endpoint_enc), keys: JSON.parse(services.secrets.decrypt(row.keys_enc)) as { p256dh: string; auth: string } };
}

/** Keeps only known topics; account-only topics need an account; staff test devices take none. */
export function allowedTopics(requested: unknown, hasAccount: boolean): NotificationTopic[] {
  const list = Array.isArray(requested) ? requested.filter(isNotificationTopic) : [];
  return [...new Set(list)].filter((topic) => topic === 'general' || hasAccount);
}

export const deviceState = (row: SubscriptionRow): PushDeviceState => ({
  id: row.id,
  status: row.status,
  topics: row.topics,
  linkedToAccount: Boolean(row.account_id),
});

export async function recordConsent(
  db: Queryable,
  subscriptionId: string | null,
  accountId: string | null,
  action: 'opt_in' | 'update' | 'opt_out' | 'expired' | 'linked' | 'unlinked',
  topics: readonly string[],
) {
  await db.query(
    `insert into notification_consent_events (subscription_id, account_id, action, topics, consent_version) values ($1, $2, $3, $4, $5)`,
    [subscriptionId, accountId, action, topics, NOTIFICATION_CONSENT_VERSION],
  );
}

export type RegisterResult = { row: SubscriptionRow; created: boolean; reactivated: boolean } | { conflict: true };

/**
 * Creates or refreshes a subscription. An existing endpoint can only be changed by a caller
 * holding its auth secret. Linking to an account (or a staff member's test devices) happens
 * only for a signed-in caller.
 */
export async function registerSubscription(
  services: Services,
  input: {
    sub: ParsedSubscription;
    topics: NotificationTopic[];
    accountId: string | null;
    staffId: string | null;
    deviceLabel: string;
    /** When the browser replaced a subscription on its own: the consent the person gave then, kept as it was. */
    carriedConsent?: { version: string | null; at: Date | null };
  },
): Promise<RegisterResult> {
  const { db, secrets } = services;
  const existing = await findByEndpoint(db, input.sub.endpoint);
  const keysEnc = secrets.encrypt(JSON.stringify(input.sub.keys));
  const consentVersion = input.carriedConsent ? input.carriedConsent.version : NOTIFICATION_CONSENT_VERSION;
  const consentAt = input.carriedConsent ? input.carriedConsent.at : new Date();
  if (existing) {
    if (!safeEqual(existing.auth_hash, authHash(input.sub.keys.auth))) return { conflict: true };
    // A switched-off device keeps no link: only a signed-in caller links it again (a removed
    // device must not come back to the account that removed it).
    const live = existing.status === 'active';
    const accountId = input.staffId ? null : (input.accountId ?? (live ? existing.account_id : null));
    const staffId = input.staffId ?? (input.accountId || !live ? null : existing.staff_id);
    const topics = staffId ? [] : input.topics.filter((topic) => topic === 'general' || accountId);
    const { rows } = await db.query<SubscriptionRow>(
      `update push_subscriptions
          set keys_enc = $2, account_id = $3, staff_id = $4, topics = $5, status = 'active', deactivated_at = null,
              deactivated_reason = null, expiration_time = $6, device_label = $7, consent_version = $8, consent_at = $9,
              updated_at = now(), last_seen_at = now(), failure_count = 0
        where id = $1 returning ${COLUMNS}`,
      [existing.id, keysEnc, accountId, staffId, topics, input.sub.expirationTime, input.deviceLabel, consentVersion, consentAt],
    );
    const row = rows[0]!;
    await recordConsent(db, row.id, row.account_id, live || input.carriedConsent ? 'update' : 'opt_in', row.topics);
    if (row.account_id && row.account_id !== existing.account_id) await recordConsent(db, row.id, row.account_id, 'linked', row.topics);
    return { row, created: false, reactivated: existing.status !== 'active' };
  }
  const topics = input.staffId ? [] : input.topics;
  const { rows } = await db.query<SubscriptionRow>(
    `insert into push_subscriptions
       (endpoint_hash, endpoint_enc, keys_enc, auth_hash, push_host, account_id, staff_id, topics, device_label, expiration_time, consent_version, consent_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (endpoint_hash) do nothing
     returning ${COLUMNS}`,
    [
      endpointHash(input.sub.endpoint),
      secrets.encrypt(input.sub.endpoint),
      keysEnc,
      authHash(input.sub.keys.auth),
      input.sub.host,
      input.staffId ? null : input.accountId,
      input.staffId,
      topics,
      input.deviceLabel,
      input.sub.expirationTime,
      consentVersion,
      consentAt,
    ],
  );
  if (!rows[0]) return registerSubscription(services, input); // raced with another request for the same endpoint
  await recordConsent(db, rows[0].id, rows[0].account_id, input.carriedConsent ? 'update' : 'opt_in', rows[0].topics);
  return { row: rows[0], created: true, reactivated: false };
}

/**
 * A device removed from an account (by its owner, or with a suspension) forgets the account and
 * its account-only topics, so nothing can link it back without that account's sign-in.
 */
export async function unlinkSubscription(db: Queryable, id: string): Promise<void> {
  const { rows } = await db.query<{ account_id: string; topics: string[] }>(
    `with before as (select account_id from push_subscriptions where id = $1 and account_id is not null)
     update push_subscriptions p
        set account_id = null, topics = array(select t from unnest(p.topics) as t where t not in ('application', 'training')), updated_at = now()
       from before where p.id = $1
     returning before.account_id, p.topics`,
    [id],
  );
  if (rows[0]) await recordConsent(db, id, rows[0].account_id, 'unlinked', rows[0].topics);
}

export async function deactivateSubscription(
  db: Queryable,
  id: string,
  reason: 'unsubscribed' | 'expired' | 'rejected' | 'account_deleted' | 'account_suspended' | 'replaced',
) {
  const { rows } = await db.query<{ account_id: string | null; topics: string[] }>(
    `update push_subscriptions set status = case when $2::text = 'expired' then 'expired'::push_subscription_status else 'revoked'::push_subscription_status end,
            deactivated_at = now(), deactivated_reason = $2::text, updated_at = now()
      where id = $1 and status = 'active' returning account_id, topics`,
    [id, reason],
  );
  if (rows[0]) await recordConsent(db, id, rows[0].account_id, reason === 'expired' ? 'expired' : 'opt_out', rows[0].topics);
}
