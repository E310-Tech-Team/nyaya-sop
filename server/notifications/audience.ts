/**
 * Who a campaign reaches. One definition, used for the preview count staff see, for
 * dispatch, and again just before each send (anyone who opted out or was suspended in
 * between is skipped).
 *
 * - Devices: active, not a staff test device, opted in to the campaign's topic, and (if linked
 *   to an account) that account is active.
 * - Cohort / status filters need an account: with filters, only devices linked to an account
 *   with a claimed application in those cohorts / with those published statuses qualify.
 *   Anonymous devices only ever receive unfiltered "general" campaigns.
 * - Inbox: with also_inbox, every active account matching the filters gets an inbox entry,
 *   whether or not it has any device.
 */
import { isApplicationStatus, isNotificationTopic, type ApplicationStatus, type NotificationTopic } from '../../src/shared/platform';
import type { Queryable } from '../db';
import { isUuid } from '../http';

export type Audience = { cohortIds: string[]; publishedStatuses: ApplicationStatus[] };

export function parseAudience(input: unknown): Audience {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const cohortIds = Array.isArray(raw.cohortIds) ? [...new Set(raw.cohortIds.filter(isUuid))].slice(0, 20) : [];
  const publishedStatuses = Array.isArray(raw.publishedStatuses) ? [...new Set(raw.publishedStatuses.filter(isApplicationStatus))] : [];
  return { cohortIds, publishedStatuses };
}

export const hasFilters = (audience: Audience) => audience.cohortIds.length > 0 || audience.publishedStatuses.length > 0;

/**
 * SQL condition on push_subscriptions `s` (joined to applicant_accounts `a`).
 * Parameters: $topic, $cohortIds (uuid[]), $statuses (text[]), $filtered (bool).
 */
const matchesAccountFilters = (accountColumn: string, cohorts: string, statuses: string) => `exists (
  select 1 from applications ap
   where ap.account_id = ${accountColumn}
     and (cardinality(${cohorts}::uuid[]) = 0 or ap.cohort_id = any(${cohorts}::uuid[]))
     and (cardinality(${statuses}::text[]) = 0 or ap.published_status::text = any(${statuses}::text[])))`;

export const deviceCondition = (topic: string, cohorts: string, statuses: string, filtered: string) => `
  s.status = 'active' and s.staff_id is null and ${topic} = any(s.topics)
  and (s.account_id is null or a.status = 'active')
  and (not ${filtered} or (s.account_id is not null and ${matchesAccountFilters('s.account_id', cohorts, statuses)}))`;

export async function countAudience(db: Queryable, topic: NotificationTopic, audience: Audience) {
  if (!isNotificationTopic(topic)) throw new Error('Unknown topic');
  const params = [topic, audience.cohortIds, audience.publishedStatuses, hasFilters(audience)];
  const { rows } = await db.query<{ devices: number; linked_devices: number; accounts: number }>(
    `select count(*)::int as devices, count(s.account_id)::int as linked_devices, count(distinct s.account_id)::int as accounts
       from push_subscriptions s left join applicant_accounts a on a.id = s.account_id
      where ${deviceCondition('$1', '$2', '$3', '$4')}`,
    params,
  );
  const { rows: inbox } = await db.query<{ n: number }>(
    `select count(*)::int as n from applicant_accounts a
      where a.status = 'active' and (not $3 or ${matchesAccountFilters('a.id', '$1', '$2')})`,
    [audience.cohortIds, audience.publishedStatuses, hasFilters(audience)],
  );
  const row = rows[0]!;
  return {
    /** Devices that would be sent a push. */
    devices: row.devices,
    /** Of which linked to a verified account / not linked to anyone. */
    linkedDevices: row.linked_devices,
    anonymousDevices: row.devices - row.linked_devices,
    /** Distinct verified accounts behind the linked devices (people with an account, not all people). */
    accountsWithDevices: row.accounts,
    /** Accounts that would get an in-app inbox entry (if the campaign adds one). */
    inboxAccounts: inbox[0]!.n,
  };
}
