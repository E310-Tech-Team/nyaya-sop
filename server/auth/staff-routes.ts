/**
 * Staff sign-in: individual accounts; a password (scrypt) and then a second step (a passkey, an
 * authenticator app code, an email code or a single-use recovery code), or a passkey on its own;
 * per-account lockout; invitations and password reset by single-use links. Managing the methods
 * is in staff-mfa-routes.ts. Mounted under /api/admin.
 */
import type { FastifyInstance } from 'fastify';
import type { StaffRole } from '../../src/shared/permissions';
import type { SessionSummary } from '../../src/shared/platform';
import { isValidEmail, normalizeEmail } from '../../src/shared/validation';
import { audit, type AuditActor } from '../audit';
import { runInBackground } from '../background';
import { hashPassword, passwordProblem, verifyDummyPassword, verifyPassword } from '../crypto';
import { staffInviteEmail, staffResetEmail } from '../email';
import { iso, isUuid, sendError, str } from '../http';
import type { Services } from '../services';
import { attemptFailed, attemptReturned, clearAttempts, takeAttempt } from './attempts';
import { EMAIL_CODE_MINUTES, emailCodesOn, sendEmailCode } from './email-codes';
import { checkOrigin, staffGuard, type StaffContext } from './guards';
import { mfaSummary, strongFor } from './methods';
import { asAuthenticationResponse, authenticationOptions, checkPasskey, findPasskey, relyingParty } from './passkeys';
import { checkSecondFactor, completeStaffSession, sessionPayload, startStaffSession } from './second-step';
import { clearSessionCookie, csrfTokenFor, revokeStaffSessions } from './sessions';
import { consumeAuthToken, createAuthToken, peekAuthToken, recentTokenCount, voidStaffTokens } from './tokens';

const INVITE_HOURS = 72;
const RESET_MINUTES = 30;
const MAX_MFA_ATTEMPTS = 5;

export const staffActor = (staff: StaffContext): AuditActor => ({ type: 'staff', id: staff.id });

export const siteLink = (services: Services, path: string) =>
  `${services.config.siteOrigin ?? 'http://localhost:5173'}${path}`;

/** Creates an invited staff member and their single-use setup link (used by owners and the bootstrap CLI). */
export async function createStaffInvite(
  services: Services,
  input: { email: string; displayName: string; role: StaffRole; invitedBy: string | null },
): Promise<{ staffId: string; url: string; emailed: boolean; reopened: boolean } | 'exists'> {
  // A removed account (D-61) is reopened as a new invitation, keeping its history; any other
  // account with that address is refused.
  const { rows: earlier } = await services.db.query<{ removed: boolean }>('select removed_at is not null as removed from staff_users where email = $1', [input.email]);
  const { rows } = await services.db.query<{ id: string }>(
    `insert into staff_users (email, display_name, role, invited_by) values ($1, $2, $3, $4)
     on conflict (email) do update
        set display_name = excluded.display_name, role = excluded.role, invited_by = excluded.invited_by, status = 'invited',
            removed_at = null, suspended_at = null, last_login_at = null, failed_login_count = 0, locked_until = null
      where staff_users.removed_at is not null
     returning id`,
    [input.email, input.displayName, input.role, input.invitedBy],
  );
  const staffId = rows[0]?.id;
  if (!staffId) return 'exists';
  const url = await inviteLink(services, staffId, input.email);
  const emailed = await trySend(services, staffInviteEmail(input.email, url, INVITE_HOURS));
  return { staffId, url, emailed, reopened: earlier[0]?.removed === true };
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
  const { config, db } = services;
  const signedInAny = staffGuard(services, { allowPendingMfa: true, allowWithoutMfaSetup: true });
  const signedInNoMfaYet = staffGuard(services, { allowWithoutMfaSetup: true });
  const rp = (request: { headers: { origin?: string } }) => relyingParty(config, request.headers.origin);
  const staffTarget = (id: string) => ({ type: 'staff', id });

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
      await audit(db, { type: 'staff', id: staff.id }, 'staff.login_locked', staffTarget(staff.id));
      return generic();
    }
    if (!(await verifyPassword(password, staff.password_hash))) {
      await attemptFailed(db, staff.id, attempt);
      await audit(db, { type: 'staff', id: staff.id }, 'staff.login_failed', staffTarget(staff.id), { failures: attempt.count });
      return generic();
    }
    // With a second step, the budget only starts again once that is passed too, so signing in
    // again doesn't buy an attacker who knows the password fresh guesses at the code.
    if (staff.mfa_enabled_at) await attemptReturned(db, staff.id, attempt);
    else await clearAttempts(db, staff.id);
    const session = await startStaffSession(services, staff.id, request.headers['user-agent'], reply);
    await audit(db, { type: 'staff', id: staff.id }, 'staff.login', staffTarget(staff.id), { step: 'password' });
    const next = staff.mfa_enabled_at ? 'mfa' : config.auth.staffMfaRequired ? 'mfa_setup' : 'done';
    return { next, csrfToken: csrfTokenFor(services.secrets, 'staff', session.id) };
  });

  // ── Signing in with a passkey alone (06 D-58) ────────────────────────────

  // The challenge names no account yet: the passkey the person picks does.
  app.post('/passkey/sign-in/options', { config: { rateLimit: { max: 30, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    return authenticationOptions(db, rp(request), 'sign_in', {}, null);
  });

  app.post('/passkey/sign-in', { config: { rateLimit: { max: 10, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const generic = () =>
      sendError(reply, 401, 'UNAUTHORIZED', 'That passkey didn’t sign you in. Try again, or sign in with your email and password.');
    const response = asAuthenticationResponse((request.body as { passkey?: unknown } | null)?.passkey);
    const passkey = response ? await findPasskey(db, response) : null;
    if (!response || !passkey) return generic();
    const { rows } = await db.query<{ status: string }>('select status::text as status from staff_users where id = $1', [passkey.staff_id]);
    if (rows[0]?.status !== 'active') return generic();
    // A passkey is both factors (user verification is required), but a wrong one still counts
    // against the account's budget, taken before it's checked.
    const attempt = await takeAttempt(db, passkey.staff_id);
    if (!attempt) {
      await audit(db, { type: 'staff', id: passkey.staff_id }, 'staff.login_locked', staffTarget(passkey.staff_id));
      return generic();
    }
    const check = await checkPasskey(db, rp(request), passkey, response, 'sign_in', {}, { requireUserHandle: true });
    if (!check.ok) {
      await attemptFailed(db, passkey.staff_id, attempt);
      await audit(db, { type: 'staff', id: passkey.staff_id }, 'staff.login_failed', staffTarget(passkey.staff_id), { method: 'passkey', failures: attempt.count });
      if (check.counterWentBack) {
        await audit(db, { type: 'staff', id: passkey.staff_id }, 'staff.passkey_counter_went_back', staffTarget(passkey.staff_id), { passkeyId: passkey.id });
      }
      return generic();
    }
    await clearAttempts(db, passkey.staff_id);
    const csrfToken = await completeStaffSession(services, { id: passkey.staff_id, sessionId: null }, request.headers['user-agent'], reply, 'passkey', true);
    await audit(db, { type: 'staff', id: passkey.staff_id }, 'staff.login', staffTarget(passkey.staff_id), { step: 'passkey' });
    return { next: 'done', csrfToken };
  });

  // ── The second step ──────────────────────────────────────────────────────

  const waitingForSecondStep = (staff: StaffContext) => staff.mfaEnabled && !staff.mfaVerified;

  app.post('/mfa/passkey/options', { preHandler: signedInAny, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!waitingForSecondStep(staff)) return sendError(reply, 400, 'BAD_REQUEST', 'There’s no second step waiting.');
    const options = await authenticationOptions(db, rp(request), 'second_step', { staffId: staff.id, sessionId: staff.sessionId }, staff.id);
    return options ?? sendError(reply, 400, 'BAD_REQUEST', 'This account has no passkeys.');
  });

  // Same answer whatever happens (sent, email codes off, three already sent), and nothing is
  // done before it goes back.
  app.post('/mfa/email/send', { preHandler: signedInAny, config: { rateLimit: { max: 5, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!waitingForSecondStep(staff)) return sendError(reply, 400, 'BAD_REQUEST', 'There’s no second step waiting.');
    runInBackground(
      async () => {
        if (await emailCodesOn(db, staff.id)) await sendEmailCode(services, staff, staff.sessionId, 'second_step');
      },
      (error) => request.log.error({ code: (error as { code?: unknown }).code }, 'Email code could not be sent'),
    );
    return reply.code(202).send({ message: `If email codes are on for your account, a code is on its way. It expires in ${EMAIL_CODE_MINUTES} minutes.` });
  });

  app.post('/mfa/verify', { preHandler: signedInAny, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!staff.mfaEnabled) return sendError(reply, 400, 'BAD_REQUEST', 'Two-step verification is not set up for this account.');
    if (staff.mfaVerified) return { ok: true };
    const tooMany = async () => {
      await db.query('update staff_sessions set revoked_at = now() where id = $1', [staff.sessionId]);
      clearSessionCookie(reply, 'staff', config);
      return sendError(reply, 401, 'UNAUTHORIZED', 'Too many incorrect attempts. Please sign in again later.');
    };
    // Both limits are taken before the answer is checked, each in one statement: this session's
    // attempts, then the account's budget (shared with passwords and every other session).
    const { rows: reserved } = await db.query(
      `update staff_sessions set mfa_attempts = mfa_attempts + 1
        where id = $1 and mfa_attempts < $2::int and revoked_at is null and mfa_verified_at is null returning id`,
      [staff.sessionId, MAX_MFA_ATTEMPTS],
    );
    if (!reserved.length) return tooMany();
    const attempt = await takeAttempt(db, staff.id);
    if (!attempt) return tooMany();
    const result = await checkSecondFactor(services, staff.id, request.body, {
      allow: ['passkey', 'totp', 'email', 'recovery'],
      purpose: 'second_step',
      sessionId: staff.sessionId,
      rp: rp(request),
    });
    if (!result.method) {
      await attemptFailed(db, staff.id, attempt);
      await audit(db, staffActor(staff), 'staff.mfa_failed', staffTarget(staff.id));
      if (result.clonedPasskey) await audit(db, staffActor(staff), 'staff.passkey_counter_went_back', staffTarget(staff.id), { passkeyId: result.clonedPasskey });
      return sendError(reply, 401, 'UNAUTHORIZED', 'That didn’t work. Check it and try again, or choose another way.');
    }
    await clearAttempts(db, staff.id);
    const summary = await mfaSummary(db, staff.id);
    const csrfToken = await completeStaffSession(services, staff, request.headers['user-agent'], reply, result.method, strongFor(result.method, summary));
    await audit(db, staffActor(staff), 'staff.mfa_verified', staffTarget(staff.id), { method: result.method });
    return { ok: true, recoveryCodesRemaining: result.method === 'recovery' ? summary.recoveryCodes : null, csrfToken };
  });

  app.post('/logout', { preHandler: signedInAny }, async (request, reply) => {
    await db.query('update staff_sessions set revoked_at = now() where id = $1', [request.staff!.sessionId]);
    clearSessionCookie(reply, 'staff', config);
    await audit(db, staffActor(request.staff!), 'staff.logout', staffTarget(request.staff!.id));
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
    await audit(db, staffActor(staff), 'staff.password_changed', staffTarget(staff.id));
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
    await audit(db, staffActor(request.staff!), 'staff.session_revoked', staffTarget(request.staff!.id));
    return { ok: true };
  });

  app.post('/me/sessions/revoke-others', { preHandler: signedInNoMfaYet }, async (request) => {
    await revokeStaffSessions(db, request.staff!.id, request.staff!.sessionId);
    await audit(db, staffActor(request.staff!), 'staff.sessions_revoked', staffTarget(request.staff!.id), { scope: 'others' });
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
    const session = await startStaffSession(services, rows[0].id, request.headers['user-agent'], reply);
    await audit(db, { type: 'staff', id: rows[0].id }, 'staff.invite_accepted', staffTarget(rows[0].id));
    return { next: config.auth.staffMfaRequired ? 'mfa_setup' : 'done', csrfToken: csrfTokenFor(services.secrets, 'staff', session.id) };
  });

  // ── Password reset (generic responses; needs the second step too) ─────────

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
            await audit(db, { type: 'system', id: null }, 'staff.password_reset_requested', staffTarget(staff.id));
          }
        },
        (error) => request.log.error({ code: (error as { code?: unknown }).code }, 'Password reset link could not be prepared'),
      );
    }
    return reply.code(202).send({ message: GENERIC_RESET });
  });

  // A passkey challenge for this reset link (the link names the account; there's no session).
  app.post('/password/reset/passkey', { config: { rateLimit: { max: 10, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const peeked = await peekAuthToken(db, 'staff_password_reset', str(request.body, 'token', 80) ?? '');
    const options = peeked?.staff_id
      ? await authenticationOptions(db, rp(request), 'password_reset', { staffId: peeked.staff_id, tokenId: peeked.id }, peeked.staff_id)
      : null;
    return options ?? sendError(reply, 400, 'NO_PASSKEY', 'There’s no passkey to use with this link. Use your authenticator app or a recovery code.');
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
    // The emailed link alone isn't enough: the second step is needed too, and wrong answers count
    // against the same budget as sign-in (a stolen link doesn't bring unlimited guesses). Never an
    // email code: the link came by email, so the inbox alone would be enough.
    if (rows[0].mfa_enabled_at) {
      const attempt = await takeAttempt(db, peeked.staff_id);
      if (!attempt) return sendError(reply, 401, 'UNAUTHORIZED', 'Too many incorrect codes. Please try again later.');
      const result = await checkSecondFactor(services, peeked.staff_id, request.body, {
        allow: ['passkey', 'totp', 'recovery'],
        purpose: 'password_reset',
        tokenId: peeked.id,
        rp: rp(request),
      });
      if (!result.method) {
        await attemptFailed(db, peeked.staff_id, attempt);
        await audit(db, { type: 'staff', id: peeked.staff_id }, 'staff.mfa_failed', staffTarget(peeked.staff_id), { step: 'password_reset' });
        return sendError(
          reply,
          401,
          'MFA_REQUIRED',
          'Confirm it’s you with your passkey, a code from your authenticator app or a recovery code. (A code sent by email can’t confirm a reset: the link came by email too.)',
        );
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
    await audit(db, { type: 'staff', id: peeked.staff_id }, 'staff.password_reset', staffTarget(peeked.staff_id));
    return { ok: true };
  });
}
