/**
 * Staff sign-in: individual accounts, password (scrypt) + TOTP second factor with single-use
 * recovery codes, per-account lockout, invitations and password reset by single-use links.
 * Mounted under /api/admin.
 */
import type { FastifyInstance } from 'fastify';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { ROLE_PERMISSIONS, type StaffRole } from '../../src/shared/permissions';
import type { SessionSummary } from '../../src/shared/platform';
import { isValidEmail, normalizeEmail } from '../../src/shared/validation';
import { audit, type AuditActor } from '../audit';
import { runInBackground } from '../background';
import {
  hashPassword,
  newRecoveryCode,
  normaliseRecoveryCode,
  passwordProblem,
  sha256Hex,
  verifyDummyPassword,
  verifyPassword,
} from '../crypto';
import type { Queryable } from '../db';
import { staffInviteEmail, staffResetEmail } from '../email';
import { deviceLabel, iso, isUuid, sendError, str } from '../http';
import type { Services } from '../services';
import { checkOrigin, staffGuard, type StaffContext } from './guards';
import { clearSessionCookie, createStaffSession, csrfTokenFor, revokeStaffSessions, setSessionCookie } from './sessions';
import { consumeAuthToken, createAuthToken, peekAuthToken, recentTokenCount, voidStaffTokens } from './tokens';

const TOTP_BASE = { issuer: 'School of Purpose', algorithm: 'SHA1', digits: 6, period: 30 } as const;
const LOCK_AFTER_FAILURES = 5;
const INVITE_HOURS = 72;
const RESET_MINUTES = 30;
const MAX_MFA_ATTEMPTS = 5;

export const staffActor = (staff: StaffContext): AuditActor => ({ type: 'staff', id: staff.id });

export const siteLink = (services: Services, path: string) =>
  `${services.config.siteOrigin ?? 'http://localhost:5173'}${path}`;

export const totpFor = (secretBase32: string, label: string) =>
  new TOTP({ ...TOTP_BASE, label, secret: Secret.fromBase32(secretBase32) });

/**
 * Checks a 6-digit code (±1 step for clock drift) and records the step, so the same code is
 * never accepted twice, even by two requests racing each other.
 */
export async function checkTotpCode(services: Services, staffId: string, secretEnc: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const delta = totpFor(services.secrets.decrypt(secretEnc), '').validate({ token: code, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 30_000) + delta;
  const { rows } = await services.db.query(
    `update staff_users set mfa_last_step = $2 where id = $1 and (mfa_last_step is null or mfa_last_step < $2) returning id`,
    [staffId, step],
  );
  return rows.length === 1;
}

/**
 * Recovery codes are stored as an HMAC under a key derived from APP_SECRET (not in the database),
 * tied to their owner, so a copy of the database alone can't be searched for them. Codes issued
 * before this used plain SHA-256 and still work until they're used or replaced.
 */
const recoveryHash = (services: Services, staffId: string, normalised: string) => services.secrets.hmac('recovery-code/v1', `${staffId}:${normalised}`);

/** Uses up one recovery code. */
async function useRecoveryCode(services: Services, staffId: string, code: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length !== 10) return false;
  const { rows } = await services.db.query(
    `update staff_recovery_codes set used_at = now()
      where staff_id = $1 and code_hash = any($2::text[]) and used_at is null returning id`,
    [staffId, [recoveryHash(services, staffId, normalised), sha256Hex(normalised)]],
  );
  return rows.length === 1;
}

async function replaceRecoveryCodes(services: Services, staffId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  const hashes = codes.map((code) => recoveryHash(services, staffId, normaliseRecoveryCode(code)));
  // One statement: the old codes stop working exactly when the new ones start.
  await services.db.query(
    `with removed as (delete from staff_recovery_codes where staff_id = $1)
     insert into staff_recovery_codes (staff_id, code_hash) select $1, hash from unnest($2::text[]) as hash`,
    [staffId, hashes],
  );
  return codes;
}

/** Second factor for sensitive steps (password reset, new recovery codes): a TOTP or recovery code. */
async function checkSecondFactor(services: Services, staffId: string, body: unknown): Promise<'totp' | 'recovery' | null> {
  const { rows } = await services.db.query<{ mfa_secret_enc: string | null }>('select mfa_secret_enc from staff_users where id = $1', [staffId]);
  const secretEnc = rows[0]?.mfa_secret_enc;
  if (!secretEnc) return null;
  const code = str(body, 'code', 10);
  if (code && (await checkTotpCode(services, staffId, secretEnc, code))) return 'totp';
  const recovery = str(body, 'recoveryCode', 20);
  if (recovery && (await useRecoveryCode(services, staffId, recovery))) return 'recovery';
  return null;
}

// ── The account's attempt budget ─────────────────────────────────────────────

/** How long a lock lasts: 15 minutes at the limit, doubling with each further failure, at most 24 hours. */
const LOCK_LENGTH = (count: string) => `least(interval '24 hours', interval '15 minutes' * power(2, ${count} - $2::int))`;

type Attempt = { count: number; relocked: boolean };

/**
 * Takes one attempt from the account's budget BEFORE a password or code is checked, in one
 * statement, so requests racing each other can't get past the lockout. Below the limit each
 * attempt counts. Once a lock has run out, one attempt at a time gets through: it re-locks the
 * account as it passes (for longer each time), and a correct answer lifts that again. Null while
 * the account is locked.
 */
async function takeAttempt(db: Queryable, staffId: string): Promise<Attempt | null> {
  const { rows } = await db.query<{ count: number }>(
    `update staff_users
        set failed_login_count = failed_login_count + 1,
            locked_until = case when failed_login_count >= $2::int then now() + ${LOCK_LENGTH('(failed_login_count + 1)')} else locked_until end
      where id = $1 and (locked_until is null or locked_until <= now())
        and (failed_login_count < $2::int or locked_until is not null)
      returning failed_login_count as count`,
    [staffId, LOCK_AFTER_FAILURES],
  );
  const count = rows[0]?.count;
  return count === undefined ? null : { count, relocked: count > LOCK_AFTER_FAILURES };
}

/** A wrong answer: the attempt stays counted, and the one that reaches the limit locks the account. */
async function attemptFailed(db: Queryable, staffId: string, attempt: Attempt): Promise<void> {
  if (attempt.relocked || attempt.count < LOCK_AFTER_FAILURES) return;
  await db.query(`update staff_users set locked_until = now() + ${LOCK_LENGTH('$3::int')} where id = $1`, [staffId, LOCK_AFTER_FAILURES, attempt.count]);
}

/** A right password that still needs the second factor: the attempt is handed back, and a lock it set is lifted. */
async function attemptReturned(db: Queryable, staffId: string, attempt: Attempt): Promise<void> {
  await db.query(
    `update staff_users set failed_login_count = greatest(failed_login_count - 1, 0), locked_until = case when $2::boolean then now() else locked_until end where id = $1`,
    [staffId, attempt.relocked],
  );
}

/** Signed in (or reset) with every factor: the budget starts again. */
const clearAttempts = (db: Queryable, staffId: string) =>
  db.query('update staff_users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = $1', [staffId]);

export function sessionPayload(services: Services, staff: StaffContext) {
  return {
    staff: { id: staff.id, email: staff.email, displayName: staff.displayName, role: staff.role, mfaEnabled: staff.mfaEnabled },
    permissions: ROLE_PERMISSIONS[staff.role],
    mfa: { enabled: staff.mfaEnabled, verified: staff.mfaVerified, required: services.config.auth.staffMfaRequired },
    csrfToken: csrfTokenFor(services.secrets, 'staff', staff.sessionId),
  };
}

/** Creates an invited staff member and their single-use setup link (used by owners and the bootstrap CLI). */
export async function createStaffInvite(
  services: Services,
  input: { email: string; displayName: string; role: StaffRole; invitedBy: string | null },
): Promise<{ staffId: string; url: string; emailed: boolean } | 'exists'> {
  const { rows } = await services.db.query<{ id: string }>(
    `insert into staff_users (email, display_name, role, invited_by) values ($1, $2, $3, $4)
     on conflict (email) do nothing returning id`,
    [input.email, input.displayName, input.role, input.invitedBy],
  );
  const staffId = rows[0]?.id;
  if (!staffId) return 'exists';
  const url = await inviteLink(services, staffId, input.email);
  const emailed = await trySend(services, staffInviteEmail(input.email, url, INVITE_HOURS));
  return { staffId, url, emailed };
}

export async function inviteLink(services: Services, staffId: string, email: string): Promise<string> {
  // A new link replaces any earlier one.
  await services.db.query(`update auth_tokens set used_at = now() where staff_id = $1 and purpose = 'staff_invite' and used_at is null`, [staffId]);
  const token = await createAuthToken(services.db, 'staff_invite', email, INVITE_HOURS * 60, staffId);
  return siteLink(services, `/admin/setup?token=${token}`);
}

async function trySend(services: Services, message: Parameters<Services['email']['send']>[0]): Promise<boolean> {
  if (!services.email.canSend) return false;
  try {
    await services.email.send(message);
    return true;
  } catch {
    return false;
  }
}

export async function staffAuthRoutes(app: FastifyInstance, services: Services) {
  const { config, db, secrets } = services;
  const signedInAny = staffGuard(services, { allowPendingMfa: true, allowWithoutMfaSetup: true });
  const signedInNoMfaYet = staffGuard(services, { allowWithoutMfaSetup: true });
  const signedIn = staffGuard(services);

  const startSession = async (staffId: string, userAgent: string | undefined, reply: Parameters<typeof setSessionCookie>[0]) => {
    const session = await createStaffSession(db, staffId, config.auth.staffSessionHours, deviceLabel(userAgent));
    setSessionCookie(reply, 'staff', session.token, config, config.auth.staffSessionHours * 3600);
    return session;
  };

  app.get('/session', { preHandler: signedInAny }, async (request) => sessionPayload(services, request.staff!));

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const email = normalizeEmail(str(request.body, 'email', 254) ?? '');
    const password = (request.body as { password?: unknown } | null)?.password;
    if (!isValidEmail(email) || typeof password !== 'string' || !password || password.length > 128) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'Enter your email address and password.');
    }
    const generic = () =>
      sendError(reply, 401, 'UNAUTHORIZED', 'That email and password don’t match an active admin account, or the account is temporarily locked.');
    const { rows } = await db.query<{ id: string; status: string; password_hash: string | null; mfa_enabled_at: Date | null }>(
      'select id, status::text as status, password_hash, mfa_enabled_at from staff_users where email = $1',
      [email],
    );
    const staff = rows[0];
    if (!staff || staff.status !== 'active' || !staff.password_hash) {
      await verifyDummyPassword(password);
      return generic();
    }
    const attempt = await takeAttempt(db, staff.id);
    if (!attempt) {
      await verifyDummyPassword(password);
      await audit(db, { type: 'staff', id: staff.id }, 'staff.login_locked', { type: 'staff', id: staff.id });
      return generic();
    }
    if (!(await verifyPassword(password, staff.password_hash))) {
      await attemptFailed(db, staff.id, attempt);
      await audit(db, { type: 'staff', id: staff.id }, 'staff.login_failed', { type: 'staff', id: staff.id }, { failures: attempt.count });
      return generic();
    }
    // With a second factor, the budget only starts again once that is passed too, so signing in
    // again doesn't buy an attacker who knows the password fresh guesses at the code.
    if (staff.mfa_enabled_at) await attemptReturned(db, staff.id, attempt);
    else await clearAttempts(db, staff.id);
    const session = await startSession(staff.id, request.headers['user-agent'], reply);
    await audit(db, { type: 'staff', id: staff.id }, 'staff.login', { type: 'staff', id: staff.id }, { step: 'password' });
    const next = staff.mfa_enabled_at ? 'mfa' : config.auth.staffMfaRequired ? 'mfa_setup' : 'done';
    return { next, csrfToken: csrfTokenFor(secrets, 'staff', session.id) };
  });

  /**
   * Signing in is complete: a new session (new token, new id) replaces the one used so far, so
   * nothing issued before the second factor carries over.
   */
  const completeSession = async (staff: StaffContext, userAgent: string | undefined, reply: Parameters<typeof setSessionCookie>[0]) => {
    const session = await startSession(staff.id, userAgent, reply);
    await db.query('update staff_sessions set mfa_verified_at = now() where id = $1', [session.id]);
    await db.query('update staff_sessions set revoked_at = now() where id = $1', [staff.sessionId]);
    return csrfTokenFor(secrets, 'staff', session.id);
  };

  app.post('/mfa/verify', { preHandler: signedInAny, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!staff.mfaEnabled) return sendError(reply, 400, 'BAD_REQUEST', 'Two-step verification is not set up for this account.');
    if (staff.mfaVerified) return { ok: true };
    const tooMany = async () => {
      await db.query('update staff_sessions set revoked_at = now() where id = $1', [staff.sessionId]);
      clearSessionCookie(reply, 'staff', config);
      return sendError(reply, 401, 'UNAUTHORIZED', 'Too many incorrect codes. Please sign in again later.');
    };
    // Both limits are taken before the code is checked, each in one statement: this session's
    // attempts, then the account's budget (shared with passwords and every other session).
    const { rows: reserved } = await db.query(
      `update staff_sessions set mfa_attempts = mfa_attempts + 1
        where id = $1 and mfa_attempts < $2::int and revoked_at is null and mfa_verified_at is null returning id`,
      [staff.sessionId, MAX_MFA_ATTEMPTS],
    );
    if (!reserved.length) return tooMany();
    const attempt = await takeAttempt(db, staff.id);
    if (!attempt) return tooMany();
    const method = await checkSecondFactor(services, staff.id, request.body);
    if (!method) {
      await attemptFailed(db, staff.id, attempt);
      await audit(db, staffActor(staff), 'staff.mfa_failed', { type: 'staff', id: staff.id });
      return sendError(reply, 401, 'UNAUTHORIZED', 'That code didn’t work. Check your authenticator app and try again.');
    }
    await clearAttempts(db, staff.id);
    const csrfToken = await completeSession(staff, request.headers['user-agent'], reply);
    await audit(db, staffActor(staff), 'staff.mfa_verified', { type: 'staff', id: staff.id }, { method });
    const remaining =
      method === 'recovery'
        ? (await db.query<{ n: number }>('select count(*)::int as n from staff_recovery_codes where staff_id = $1 and used_at is null', [staff.id]))
            .rows[0]!.n
        : null;
    return { ok: true, recoveryCodesRemaining: remaining, csrfToken };
  });

  app.post('/mfa/enrol/start', { preHandler: signedInNoMfaYet }, async (request, reply) => {
    const staff = request.staff!;
    if (staff.mfaEnabled) return sendError(reply, 409, 'CONFLICT', 'Two-step verification is already on for this account.');
    const secret = new Secret({ size: 20 });
    await db.query('update staff_users set mfa_pending_secret_enc = $2 where id = $1', [staff.id, secrets.encrypt(secret.base32)]);
    const uri = totpFor(secret.base32, staff.email).toString();
    return { otpauthUri: uri, secret: secret.base32, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  });

  app.post('/mfa/enrol/confirm', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (staff.mfaEnabled) return sendError(reply, 409, 'CONFLICT', 'Two-step verification is already on for this account.');
    const { rows } = await db.query<{ mfa_pending_secret_enc: string | null }>('select mfa_pending_secret_enc from staff_users where id = $1', [staff.id]);
    const pending = rows[0]?.mfa_pending_secret_enc;
    const code = str(request.body, 'code', 10) ?? '';
    const delta = pending && /^\d{6}$/.test(code) ? totpFor(secrets.decrypt(pending), '').validate({ token: code, window: 1 }) : null;
    if (!pending || delta === null) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'That code didn’t match. Check the time on your phone is set automatically and try again.');
    }
    const step = Math.floor(Date.now() / 30_000) + delta;
    await db.query(
      `update staff_users set mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = null,
              mfa_enabled_at = now(), mfa_last_step = $2 where id = $1`,
      [staff.id, step],
    );
    const recoveryCodes = await replaceRecoveryCodes(services, staff.id);
    // Sessions opened with the password alone end; this one continues under a new token.
    const csrfToken = await completeSession(staff, request.headers['user-agent'], reply);
    await db.query(`update staff_sessions set revoked_at = now() where staff_id = $1 and revoked_at is null and mfa_verified_at is null`, [staff.id]);
    await audit(db, staffActor(staff), 'staff.mfa_enabled', { type: 'staff', id: staff.id });
    return { recoveryCodes, csrfToken };
  });

  app.post('/mfa/recovery-codes', { preHandler: signedIn, config: { rateLimit: { max: 5, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!staff.mfaEnabled) return sendError(reply, 400, 'BAD_REQUEST', 'Two-step verification is not set up.');
    if (!(await checkSecondFactor(services, staff.id, request.body))) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Enter a current code from your authenticator app.');
    }
    const recoveryCodes = await replaceRecoveryCodes(services, staff.id);
    await audit(db, staffActor(staff), 'staff.recovery_codes_replaced', { type: 'staff', id: staff.id });
    return { recoveryCodes };
  });

  app.post('/logout', { preHandler: signedInAny }, async (request, reply) => {
    await db.query('update staff_sessions set revoked_at = now() where id = $1', [request.staff!.sessionId]);
    clearSessionCookie(reply, 'staff', config);
    await audit(db, staffActor(request.staff!), 'staff.logout', { type: 'staff', id: request.staff!.id });
    return { ok: true };
  });

  app.post('/me/password', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 5, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    const body = request.body as { currentPassword?: unknown; newPassword?: unknown } | null;
    const problem = passwordProblem(body?.newPassword);
    if (problem) return sendError(reply, 400, 'VALIDATION_FAILED', problem);
    const { rows } = await db.query<{ password_hash: string }>('select password_hash from staff_users where id = $1', [staff.id]);
    if (typeof body?.currentPassword !== 'string' || !(await verifyPassword(body.currentPassword, rows[0]!.password_hash))) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Your current password is not correct.');
    }
    await db.query('update staff_users set password_hash = $2, password_changed_at = now() where id = $1', [
      staff.id,
      await hashPassword(body.newPassword as string),
    ]);
    await revokeStaffSessions(db, staff.id, staff.sessionId);
    await voidStaffTokens(db, staff.id, ['staff_password_reset']);
    await audit(db, staffActor(staff), 'staff.password_changed', { type: 'staff', id: staff.id });
    return { ok: true };
  });

  app.get('/me/sessions', { preHandler: signedInNoMfaYet }, async (request): Promise<{ sessions: SessionSummary[] }> => {
    const { rows } = await db.query<{ id: string; device_label: string | null; created_at: Date; last_seen_at: Date }>(
      `select id, device_label, created_at, last_seen_at from staff_sessions
        where staff_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
      [request.staff!.id],
    );
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        deviceLabel: row.device_label ?? 'Unknown device',
        createdAt: iso(row.created_at)!,
        lastSeenAt: iso(row.last_seen_at)!,
        current: row.id === request.staff!.sessionId,
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/me/sessions/:id/revoke', { preHandler: signedInNoMfaYet }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Session not found.');
    const { rows } = await db.query(
      'update staff_sessions set revoked_at = now() where id = $1 and staff_id = $2 and revoked_at is null returning id',
      [request.params.id, request.staff!.id],
    );
    if (!rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Session not found.');
    if (request.params.id === request.staff!.sessionId) clearSessionCookie(reply, 'staff', config);
    await audit(db, staffActor(request.staff!), 'staff.session_revoked', { type: 'staff', id: request.staff!.id });
    return { ok: true };
  });

  app.post('/me/sessions/revoke-others', { preHandler: signedInNoMfaYet }, async (request) => {
    await revokeStaffSessions(db, request.staff!.id, request.staff!.sessionId);
    await audit(db, staffActor(request.staff!), 'staff.sessions_revoked', { type: 'staff', id: request.staff!.id }, { scope: 'others' });
    return { ok: true };
  });

  // ── Invitation (first password) ──────────────────────────────────────────

  const inviteRate = { rateLimit: { max: 10, timeWindow: 15 * 60_000 } };

  app.post('/setup/check', { config: inviteRate }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const token = await peekAuthToken(db, 'staff_invite', str(request.body, 'token', 80) ?? '');
    const { rows } = token
      ? await db.query<{ email: string; display_name: string; status: string }>(
          'select email, display_name, status::text as status from staff_users where id = $1',
          [token.staff_id],
        )
      : { rows: [] };
    if (!rows[0] || rows[0].status !== 'invited') {
      return sendError(reply, 400, 'INVALID_TOKEN', 'This invitation link has expired or has already been used. Ask an owner for a new one.');
    }
    return { email: rows[0].email, displayName: rows[0].display_name };
  });

  app.post('/setup/complete', { config: inviteRate }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const password = (request.body as { password?: unknown } | null)?.password;
    const problem = passwordProblem(password);
    if (problem) return sendError(reply, 400, 'VALIDATION_FAILED', problem);
    const token = await consumeAuthToken(db, 'staff_invite', str(request.body, 'token', 80) ?? '');
    const { rows } = token
      ? await db.query<{ id: string }>(
          `update staff_users set password_hash = $2, password_changed_at = now(), status = 'active'
            where id = $1 and status = 'invited' returning id`,
          [token.staff_id, await hashPassword(password as string)],
        )
      : { rows: [] };
    if (!rows[0]) {
      return sendError(reply, 400, 'INVALID_TOKEN', 'This invitation link has expired or has already been used. Ask an owner for a new one.');
    }
    const session = await startSession(rows[0].id, request.headers['user-agent'], reply);
    await audit(db, { type: 'staff', id: rows[0].id }, 'staff.invite_accepted', { type: 'staff', id: rows[0].id });
    return { next: config.auth.staffMfaRequired ? 'mfa_setup' : 'done', csrfToken: csrfTokenFor(secrets, 'staff', session.id) };
  });

  // ── Password reset (generic responses; needs the second factor too) ──────

  const GENERIC_RESET = 'If that address belongs to an active admin account, a reset link is on its way. It expires in 30 minutes.';

  app.post('/password/forgot', { config: { rateLimit: { max: 5, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const email = normalizeEmail(str(request.body, 'email', 254) ?? '');
    if (!isValidEmail(email)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Enter a valid email address.');
    if (!services.email.canSend) {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Email isn’t set up yet, so passwords can’t be reset by email. Ask an owner to help.');
    }
    const { rows } = await db.query<{ id: string }>(`select id from staff_users where email = $1 and status = 'active'`, [email]);
    const staff = rows[0];
    // The answer goes before any work for a real account (a new link, the email), so the time it
    // takes doesn't say whether the address belongs to staff.
    if (staff) {
      runInBackground(
        async () => {
          if ((await recentTokenCount(db, 'staff_password_reset', email, 30)) >= 3) return;
          await voidStaffTokens(db, staff.id, ['staff_password_reset']); // only the newest link works
          const token = await createAuthToken(db, 'staff_password_reset', email, RESET_MINUTES, staff.id);
          if (await trySend(services, staffResetEmail(email, siteLink(services, `/admin/reset?token=${token}`), RESET_MINUTES))) {
            await audit(db, { type: 'system', id: null }, 'staff.password_reset_requested', { type: 'staff', id: staff.id });
          }
        },
        (error) => request.log.error({ code: (error as { code?: unknown }).code }, 'Password reset link could not be prepared'),
      );
    }
    return reply.code(202).send({ message: GENERIC_RESET });
  });

  app.post('/password/reset', { config: { rateLimit: { max: 10, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const password = (request.body as { password?: unknown } | null)?.password;
    const problem = passwordProblem(password);
    if (problem) return sendError(reply, 400, 'VALIDATION_FAILED', problem);
    const tokenText = str(request.body, 'token', 80) ?? '';
    const peeked = await peekAuthToken(db, 'staff_password_reset', tokenText);
    const invalid = () => sendError(reply, 400, 'INVALID_TOKEN', 'This reset link has expired or has already been used. Ask for a new one.');
    if (!peeked?.staff_id) return invalid();
    const { rows } = await db.query<{ mfa_enabled_at: Date | null; status: string }>(
      'select mfa_enabled_at, status::text as status from staff_users where id = $1',
      [peeked.staff_id],
    );
    if (rows[0]?.status !== 'active') return invalid();
    // The emailed link alone isn't enough: a second factor is needed too, and wrong codes count
    // against the same budget as sign-in (a stolen link doesn't bring unlimited guesses).
    if (rows[0].mfa_enabled_at) {
      const attempt = await takeAttempt(db, peeked.staff_id);
      if (!attempt) return sendError(reply, 401, 'UNAUTHORIZED', 'Too many incorrect codes. Please try again later.');
      if (!(await checkSecondFactor(services, peeked.staff_id, request.body))) {
        await attemptFailed(db, peeked.staff_id, attempt);
        await audit(db, { type: 'staff', id: peeked.staff_id }, 'staff.mfa_failed', { type: 'staff', id: peeked.staff_id }, { step: 'password_reset' });
        return sendError(reply, 401, 'MFA_REQUIRED', 'Enter a current code from your authenticator app (or a recovery code).');
      }
    }
    const consumed = await consumeAuthToken(db, 'staff_password_reset', tokenText);
    if (!consumed) return invalid();
    await db.query(
      `update staff_users set password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = null where id = $1`,
      [peeked.staff_id, await hashPassword(password as string)],
    );
    await revokeStaffSessions(db, peeked.staff_id);
    await voidStaffTokens(db, peeked.staff_id, ['staff_password_reset']);
    await audit(db, { type: 'staff', id: peeked.staff_id }, 'staff.password_reset', { type: 'staff', id: peeked.staff_id });
    return { ok: true };
  });
}
