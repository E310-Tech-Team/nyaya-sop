/** Single-use, expiring link tokens (sign-in, staff invitation, password reset). Only hashes are stored. */
import { randomToken, sha256Hex } from '../crypto';
import type { Queryable } from '../db';

export type TokenPurpose = 'applicant_sign_in' | 'staff_invite' | 'staff_password_reset';

export async function createAuthToken(
  db: Queryable,
  purpose: TokenPurpose,
  email: string,
  ttlMinutes: number,
  staffId: string | null = null,
): Promise<string> {
  const token = randomToken();
  await db.query(
    `insert into auth_tokens (purpose, token_hash, email, staff_id, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [purpose, sha256Hex(token), email, staffId, ttlMinutes],
  );
  return token;
}

type TokenRow = { id: string; email: string; staff_id: string | null };

/** A valid, unused token, without consuming it (to show who an invitation is for). */
export async function peekAuthToken(db: Queryable, purpose: TokenPurpose, token: string): Promise<TokenRow | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const { rows } = await db.query<TokenRow>(
    `select id, email, staff_id from auth_tokens
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()`,
    [sha256Hex(token), purpose],
  );
  return rows[0] ?? null;
}

/** Marks the token used in the same statement that checks it, so it can only ever succeed once. */
export async function consumeAuthToken(db: Queryable, purpose: TokenPurpose, token: string): Promise<TokenRow | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const { rows } = await db.query<TokenRow>(
    `update auth_tokens set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning id, email, staff_id`,
    [sha256Hex(token), purpose],
  );
  return rows[0] ?? null;
}

/** Tokens issued to an address recently (per-address throttling, on top of per-IP limits). */
export async function recentTokenCount(db: Queryable, purpose: TokenPurpose, email: string, minutes: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from auth_tokens
      where email = $1 and purpose = $2 and created_at > now() - make_interval(mins => $3)`,
    [email, purpose, minutes],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Makes a staff member's outstanding links unusable: earlier reset links when a new one is sent,
 * after a reset or password change, and every link when the account is suspended.
 */
export async function voidStaffTokens(db: Queryable, staffId: string, purposes: readonly TokenPurpose[]): Promise<void> {
  await db.query(`update auth_tokens set used_at = now() where staff_id = $1 and purpose::text = any($2::text[]) and used_at is null`, [staffId, purposes]);
}

/** Once one sign-in link has been used, the others sent to that address stop working too. */
export async function voidSignInTokens(db: Queryable, email: string): Promise<void> {
  await db.query(`update auth_tokens set used_at = now() where email = $1 and purpose = 'applicant_sign_in' and used_at is null`, [email]);
}
