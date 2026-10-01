/**
 * A staff account's two-step verification methods (06 D-58): passkeys, the authenticator app
 * (TOTP) and email codes, plus single-use recovery codes. Two-step verification is on
 * (staff_users.mfa_enabled_at) while the account has at least one method.
 *
 * Security changes (adding or removing a method, new recovery codes) need a recent strong check
 * ("step-up"): a passkey, an app code or a recovery code; an email code only on an account whose
 * only method is email codes. Removing the last method is refused while two-step verification is
 * required, in one statement that locks the account and its passkeys (two removals at once can't
 * both see "another method remains").
 */
import type { StaffMfaMethod, StaffMfaSummary } from '../../src/shared/platform';
import type { Queryable } from '../db';

export type { StaffMfaMethod, StaffMfaSummary };

export const STEP_UP_MINUTES = 5;

export async function mfaSummary(db: Queryable, staffId: string): Promise<StaffMfaSummary> {
  const { rows } = await db.query<{ app: boolean; email: boolean; passkeys: number; recovery: number }>(
    `select u.mfa_secret_enc is not null as app, u.email_codes_enabled_at is not null as email,
            (select count(*)::int from staff_passkeys p where p.staff_id = u.id) as passkeys,
            (select count(*)::int from staff_recovery_codes r where r.staff_id = u.id and r.used_at is null) as recovery
       from staff_users u where u.id = $1`,
    [staffId],
  );
  const row = rows[0];
  return { passkeys: row?.passkeys ?? 0, app: row?.app ?? false, emailCodes: row?.email ?? false, recoveryCodes: row?.recovery ?? 0 };
}

/** Whether passing `method` counts as a strong check for this account (see above). */
export const strongFor = (method: StaffMfaMethod, summary: StaffMfaSummary): boolean =>
  method !== 'email' || (summary.passkeys === 0 && !summary.app);

export const stepUpFresh = (stepUpAt: Date | null): boolean =>
  stepUpAt !== null && Date.now() - new Date(stepUpAt).getTime() < STEP_UP_MINUTES * 60_000;

export const stepUpUntil = (stepUpAt: Date | null): string | null =>
  stepUpFresh(stepUpAt) ? new Date(new Date(stepUpAt!).getTime() + STEP_UP_MINUTES * 60_000).toISOString() : null;

// ── Removing a method ────────────────────────────────────────────────────────

/** Locks the account, then its passkeys (always in this order), and counts what would remain. */
const LOCKED = `me as (select mfa_secret_enc is not null as app, email_codes_enabled_at is not null as email from staff_users where id = $1::uuid for update),
  keys as (select id from staff_passkeys where staff_id = $1::uuid order by id for update)`;

export type Removal = 'removed' | 'not_found' | 'last_method';

export async function removePasskey(db: Queryable, staffId: string, passkeyId: string, required: boolean): Promise<Removal> {
  const { rows } = await db.query<{ found: boolean; removed: boolean }>(
    `with ${LOCKED},
       remaining as (select (select count(*) from keys where id <> $2::uuid) + (select app::int + email::int from me) as n),
       gone as (delete from staff_passkeys where id = $2::uuid and staff_id = $1::uuid and (not $3::boolean or (select n from remaining) > 0) returning id)
     select exists (select 1 from keys where id = $2::uuid) as found, exists (select 1 from gone) as removed`,
    [staffId, passkeyId, required],
  );
  const row = rows[0]!;
  if (row.removed) await switchOffIfNone(db, staffId);
  return row.removed ? 'removed' : row.found ? 'last_method' : 'not_found';
}

export async function removeApp(db: Queryable, staffId: string, required: boolean): Promise<Removal> {
  const { rows } = await db.query<{ found: boolean; removed: boolean }>(
    `with ${LOCKED},
       remaining as (select (select count(*) from keys) + (select email::int from me) as n),
       gone as (update staff_users set mfa_secret_enc = null, mfa_pending_secret_enc = null, mfa_last_step = null
                 where id = $1::uuid and mfa_secret_enc is not null and (not $2::boolean or (select n from remaining) > 0) returning id)
     select (select app from me) as found, exists (select 1 from gone) as removed`,
    [staffId, required],
  );
  const row = rows[0]!;
  if (row.removed) await switchOffIfNone(db, staffId);
  return row.removed ? 'removed' : row.found ? 'last_method' : 'not_found';
}

export async function removeEmailCodes(db: Queryable, staffId: string, required: boolean): Promise<Removal> {
  const { rows } = await db.query<{ found: boolean; removed: boolean }>(
    `with ${LOCKED},
       remaining as (select (select count(*) from keys) + (select app::int from me) as n),
       gone as (update staff_users set email_codes_enabled_at = null
                 where id = $1::uuid and email_codes_enabled_at is not null and (not $2::boolean or (select n from remaining) > 0) returning id)
     select (select email from me) as found, exists (select 1 from gone) as removed`,
    [staffId, required],
  );
  const row = rows[0]!;
  if (row.removed) {
    await db.query('update staff_email_codes set used_at = now() where staff_id = $1 and used_at is null', [staffId]);
    await switchOffIfNone(db, staffId);
  }
  return row.removed ? 'removed' : row.found ? 'last_method' : 'not_found';
}

/** Off once no method is left (only possible where two-step verification isn't required). */
async function switchOffIfNone(db: Queryable, staffId: string): Promise<void> {
  await db.query(
    `update staff_users u set mfa_enabled_at = null
      where u.id = $1 and u.mfa_secret_enc is null and u.email_codes_enabled_at is null
        and not exists (select 1 from staff_passkeys p where p.staff_id = u.id)`,
    [staffId],
  );
}

/**
 * Every method gone, in one statement: an owner's reset or `pnpm admin reset-mfa` (a lost phone,
 * passkey or inbox). The account sets up two-step verification again at its next sign-in.
 */
export async function clearMfa(db: Queryable, staffId: string): Promise<void> {
  await db.query(
    `with keys as (delete from staff_passkeys where staff_id = $1::uuid),
          codes as (delete from staff_recovery_codes where staff_id = $1::uuid),
          mail as (delete from staff_email_codes where staff_id = $1::uuid),
          challenges as (delete from staff_passkey_challenges where staff_id = $1::uuid)
     update staff_users set mfa_secret_enc = null, mfa_pending_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null,
            email_codes_enabled_at = null, webauthn_user_id = null
      where id = $1::uuid`,
    [staffId],
  );
}
