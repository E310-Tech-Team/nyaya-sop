/**
 * One-time codes sent by email (06 D-58): six digits, valid 10 minutes, only the newest works, at
 * most 3 sent per 15 minutes. Only an HMAC of each code is stored (under a key derived from
 * APP_SECRET), tied to the staff member, the session that asked and what for; a code is used up
 * by the statement that checks it. Never accepted where the email link is already the other
 * factor (password reset).
 */
import { randomInt } from 'node:crypto';
import type { Queryable } from '../db';
import { staffEmailCodeEmail } from '../email';
import type { Services } from '../services';

export const EMAIL_CODE_MINUTES = 10;
const SENDS_ALLOWED = 3;
const SEND_WINDOW_MINUTES = 15;

export type EmailCodePurpose = 'second_step' | 'step_up' | 'enable';

const codeHash = (services: Services, staffId: string, sessionId: string, purpose: EmailCodePurpose, code: string) =>
  services.secrets.hmac('staff-email-code/v1', `${staffId}:${sessionId}:${purpose}:${code}`);

/**
 * Stores a new code and emails it, unless email is off or the account has had three in the last
 * 15 minutes. Callers run this in the background (runInBackground), so the answer never says
 * which happened.
 */
export async function sendEmailCode(
  services: Services,
  staff: { id: string; email: string },
  sessionId: string,
  purpose: EmailCodePurpose,
): Promise<boolean> {
  const { db } = services;
  if (!services.email.canSend) return false;
  const { rows } = await db.query<{ n: number }>(
    'select count(*)::int as n from staff_email_codes where staff_id = $1 and created_at > now() - make_interval(mins => $2)',
    [staff.id, SEND_WINDOW_MINUTES],
  );
  if ((rows[0]?.n ?? 0) >= SENDS_ALLOWED) return false;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // One statement: the earlier codes stop working exactly when this one is stored.
  await db.query(
    `with voided as (update staff_email_codes set used_at = now() where staff_id = $1::uuid and used_at is null)
     insert into staff_email_codes (staff_id, session_id, purpose, code_hash, expires_at)
     values ($1::uuid, $2, $3::staff_email_code_purpose, $4, now() + make_interval(mins => $5))`,
    [staff.id, sessionId, purpose, codeHash(services, staff.id, sessionId, purpose, code), EMAIL_CODE_MINUTES],
  );
  await services.email.send(staffEmailCodeEmail(staff.email, code, EMAIL_CODE_MINUTES));
  return true;
}

/** Uses up the code if it's this session's newest for `purpose` and still valid. */
export async function checkEmailCode(
  services: Services,
  staffId: string,
  sessionId: string,
  purpose: EmailCodePurpose,
  code: string | null,
): Promise<boolean> {
  const digits = code?.replace(/\s/g, '') ?? '';
  if (!/^\d{6}$/.test(digits)) return false;
  const { rows } = await services.db.query(
    `update staff_email_codes set used_at = now()
      where staff_id = $1 and session_id = $2 and purpose = $3::staff_email_code_purpose and code_hash = $4
        and used_at is null and expires_at > now()
      returning id`,
    [staffId, sessionId, purpose, codeHash(services, staffId, sessionId, purpose, digits)],
  );
  return rows.length === 1;
}

/** Whether email codes are one of this account's methods. */
export async function emailCodesOn(db: Queryable, staffId: string): Promise<boolean> {
  const { rows } = await db.query<{ on: boolean }>('select email_codes_enabled_at is not null as on from staff_users where id = $1', [staffId]);
  return rows[0]?.on ?? false;
}
