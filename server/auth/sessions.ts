/**
 * Server-side sessions for staff and applicants. The cookie holds a 256-bit random token;
 * the database holds only its SHA-256 hash, so a leaked database can't be used to sign in.
 * Sessions have an absolute lifetime and an idle timeout, and can be revoked individually
 * or all at once.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config';
import { randomToken, safeEqual, sha256Hex, type Secrets } from '../crypto';
import type { Queryable } from '../db';

export type SessionKind = 'staff' | 'applicant';

export const cookieName = (kind: SessionKind, config: AppConfig) =>
  config.cookieSecure ? `__Host-sop_${kind}` : `sop_${kind}`;

export function readSessionToken(request: FastifyRequest, kind: SessionKind, config: AppConfig): string | null {
  const value = request.cookies?.[cookieName(kind, config)];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : null;
}

export function setSessionCookie(reply: FastifyReply, kind: SessionKind, token: string, config: AppConfig, maxAgeSeconds: number) {
  reply.setCookie(cookieName(kind, config), token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply, kind: SessionKind, config: AppConfig) {
  reply.clearCookie(cookieName(kind, config), { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
}

/** CSRF token for a session: an HMAC of its id, sent back in the x-csrf-token header. */
export const csrfTokenFor = (secrets: Secrets, kind: SessionKind, sessionId: string) => secrets.hmac(`csrf:${kind}`, sessionId);

export function hasValidCsrf(request: FastifyRequest, secrets: Secrets, kind: SessionKind, sessionId: string): boolean {
  const header = request.headers['x-csrf-token'];
  return typeof header === 'string' && safeEqual(header, csrfTokenFor(secrets, kind, sessionId));
}

// ── Staff ────────────────────────────────────────────────────────────────────

export type StaffSessionRow = {
  session_id: string;
  staff_id: string;
  mfa_verified_at: Date | null;
  mfa_attempts: number;
  /** When the session last passed a strong check (security changes need a recent one). */
  step_up_at: Date | null;
  email: string;
  display_name: string;
  role: string;
  status: string;
  mfa_enabled_at: Date | null;
};

export async function createStaffSession(db: Queryable, staffId: string, hours: number, deviceLabel: string) {
  const token = randomToken();
  const { rows } = await db.query<{ id: string }>(
    `insert into staff_sessions (token_hash, staff_id, expires_at, device_label)
     values ($1, $2, now() + make_interval(hours => $3), $4) returning id`,
    [sha256Hex(token), staffId, hours, deviceLabel],
  );
  return { token, id: rows[0]!.id };
}

export async function loadStaffSession(db: Queryable, token: string, idleMinutes: number): Promise<StaffSessionRow | null> {
  const { rows } = await db.query<StaffSessionRow & { last_seen_at: Date }>(
    `select s.id as session_id, s.staff_id, s.mfa_verified_at, s.mfa_attempts, s.step_up_at, s.last_seen_at,
            u.email, u.display_name, u.role::text as role, u.status::text as status, u.mfa_enabled_at
       from staff_sessions s
       join staff_users u on u.id = s.staff_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(mins => $2)`,
    [sha256Hex(token), idleMinutes],
  );
  const row = rows[0];
  if (!row) return null;
  // Touch at most once a minute, so reads don't turn into a write per request.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    await db.query('update staff_sessions set last_seen_at = now() where id = $1', [row.session_id]);
  }
  return row;
}

export async function revokeStaffSessions(db: Queryable, staffId: string, exceptSessionId?: string) {
  await db.query(
    `update staff_sessions set revoked_at = now()
      where staff_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)`,
    [staffId, exceptSessionId ?? null],
  );
}

// ── Applicants ───────────────────────────────────────────────────────────────

export type ApplicantSessionRow = {
  session_id: string;
  account_id: string;
  email: string;
  status: string;
  created_at: Date;
};

export async function createApplicantSession(db: Queryable, accountId: string, days: number, deviceLabel: string) {
  const token = randomToken();
  const { rows } = await db.query<{ id: string }>(
    `insert into applicant_sessions (token_hash, account_id, expires_at, device_label)
     values ($1, $2, now() + make_interval(days => $3), $4) returning id`,
    [sha256Hex(token), accountId, days, deviceLabel],
  );
  return { token, id: rows[0]!.id };
}

export async function loadApplicantSession(db: Queryable, token: string, idleDays: number): Promise<ApplicantSessionRow | null> {
  const { rows } = await db.query<ApplicantSessionRow & { last_seen_at: Date }>(
    `select s.id as session_id, s.account_id, s.last_seen_at, a.email, a.status::text as status, a.created_at
       from applicant_sessions s
       join applicant_accounts a on a.id = s.account_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(days => $2)`,
    [sha256Hex(token), idleDays],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    await db.query('update applicant_sessions set last_seen_at = now() where id = $1', [row.session_id]);
  }
  return row;
}

export async function revokeApplicantSessions(db: Queryable, accountId: string, exceptSessionId?: string) {
  await db.query(
    `update applicant_sessions set revoked_at = now()
      where account_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)`,
    [accountId, exceptSessionId ?? null],
  );
}
