import type { Queryable } from '../db';
import { deactivateSubscription } from '../push/subscriptions';

/**
 * Deletes an applicant account (the person's own request, or staff acting on one). Applications
 * stay with the Programme team, unlinked; sessions and inbox entries go with the account (FK
 * cascade); devices stop receiving and keep only a revoked, anonymous record (the push service's
 * name, for campaign counts) beside the consent history. Safe to run again if it stops part-way.
 */
export async function deleteApplicantAccount(db: Queryable, accountId: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(`select id from push_subscriptions where account_id = $1 and status = 'active'`, [accountId]);
  for (const row of rows) await deactivateSubscription(db, row.id, 'account_deleted');
  // Application and training topics need an account (a table check), so drop them before the
  // account row goes and its devices' account_id is set to null.
  await db.query(
    `update push_subscriptions set topics = array(select t from unnest(topics) as t where t not in ('application', 'training')), updated_at = now()
      where account_id = $1 and topics && array['application', 'training']::text[]`,
    [accountId],
  );
  // The browser's push address and keys, and the hashes that would recognise it again, go now rather
  // than with the 180-day clean-up: kept, they would still single out the device.
  await db.query(
    `update push_subscriptions set endpoint_hash = 'erased:' || id::text, auth_hash = 'erased:' || id::text, endpoint_enc = '', keys_enc = '',
            device_label = null, expiration_time = null, updated_at = now()
      where account_id = $1 and status <> 'active'`,
    [accountId],
  );
  await db.query('update applications set account_id = null, claimed_at = null where account_id = $1', [accountId]);
  await db.query('delete from applicant_accounts where id = $1', [accountId]);
}
