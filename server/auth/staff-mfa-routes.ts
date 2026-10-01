/**
 * A staff member's own two-step verification methods (06 D-58): passkeys, the authenticator app,
 * email codes and recovery codes. Mounted under /api/admin.
 *
 * - The first method can be set up with the password session alone (two-step verification isn't
 *   on yet); it turns two-step verification on, gives the recovery codes, and the session goes on
 *   as a verified one.
 * - Every later change needs a recent strong check ("step-up", methods.ts), refuses to remove the
 *   last method while two-step verification is required, voids outstanding reset links, is audited
 *   (identifiers and method names only) and is emailed to the staff member.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Secret } from 'otpauth';
import QRCode from 'qrcode';
import type { StaffMfaMethod, StaffPasskey } from '../../src/shared/platform';
import { characters, cleanText } from '../../src/shared/validation';
import { audit } from '../audit';
import { runInBackground } from '../background';
import type { StaffSecurityChange } from '../email';
import { deviceLabel, iso, isUuid, sendError, str } from '../http';
import type { Services } from '../services';
import { attemptFailed, resetAttempts, takeAttempt } from './attempts';
import { EMAIL_CODE_MINUTES, checkEmailCode, sendEmailCode } from './email-codes';
import { staffGuard, type StaffContext } from './guards';
import {
  STEP_UP_MINUTES,
  mfaSummary,
  removeApp,
  removeEmailCodes,
  removePasskey,
  stepUpFresh,
  stepUpUntil,
  strongFor,
  type Removal,
} from './methods';
import { asRegistrationResponse, authenticationOptions, checkRegistration, registrationOptions, relyingParty } from './passkeys';
import { checkSecondFactor, completeStaffSession, notifySecurityChange, replaceRecoveryCodes, totpFor } from './second-step';
import { staffActor } from './staff-routes';
import { voidStaffTokens } from './tokens';

const NICKNAME_MAX = 60;

/** A passkey's name: what the person typed (cleaned), or the device it was made on. */
function nicknameFrom(value: unknown, userAgent: string | undefined): string | null {
  if (value === undefined || value === null || value === '') return deviceLabel(userAgent);
  if (typeof value !== 'string') return null;
  const cleaned = cleanText(value);
  return cleaned && characters(cleaned) <= NICKNAME_MAX ? cleaned : null;
}

export async function staffMfaRoutes(app: FastifyInstance, services: Services) {
  const { config, db } = services;
  // Before two-step verification is on (setting up the first method), or fully signed in.
  const signedInNoMfaYet = staffGuard(services, { allowWithoutMfaSetup: true });
  const signedIn = staffGuard(services);
  const rp = (request: FastifyRequest) => relyingParty(config, request.headers.origin);
  const staffTarget = (id: string) => ({ type: 'staff', id });
  const required = () => config.auth.staffMfaRequired;

  /** Setting up the first method, or a change backed by a recent strong check. */
  const mayChange = (staff: StaffContext) => !staff.mfaEnabled || (staff.mfaVerified && stepUpFresh(staff.stepUpAt));
  const stepUpNeeded = (reply: FastifyReply) => sendError(reply, 403, 'STEP_UP_REQUIRED', 'Confirm it’s you first.');

  /** After a method was added or removed: old reset links stop working, the change is audited and emailed. */
  const changed = async (request: FastifyRequest, staff: StaffContext, action: string, method: StaffMfaMethod, change: StaffSecurityChange) => {
    await voidStaffTokens(db, staff.id, ['staff_password_reset']);
    await audit(db, staffActor(staff), action, staffTarget(staff.id), { method });
    notifySecurityChange(services, request, staff.email, change);
  };

  /**
   * The first method turned two-step verification on: new recovery codes, and the session goes on
   * under a new token as a verified one; sessions opened with the password alone end.
   */
  const firstMethod = async (request: FastifyRequest, reply: FastifyReply, staff: StaffContext, method: StaffMfaMethod) => {
    const recoveryCodes = await replaceRecoveryCodes(services, staff.id);
    const csrfToken = await completeStaffSession(services, staff, request.headers['user-agent'], reply, method, true);
    await db.query(`update staff_sessions set revoked_at = now() where staff_id = $1 and revoked_at is null and mfa_verified_at is null`, [staff.id]);
    await audit(db, staffActor(staff), 'staff.mfa_enabled', staffTarget(staff.id), { method });
    return { recoveryCodes, csrfToken };
  };

  const removed = (reply: FastifyReply, result: Removal, what: string) => {
    if (result === 'not_found') return sendError(reply, 404, 'NOT_FOUND', `${what} not found.`);
    return sendError(reply, 409, 'LAST_METHOD', 'You need at least one way through two-step verification. Add another one first.');
  };

  // The statements below read the account as it was ("before", locked FOR UPDATE) and change it in
  // one go. "before" is referenced in the change's WHERE so it's read (and locked) before the row is
  // updated: a lock taken after the statement has updated the row would find nothing. The lock makes
  // a second request wait and then see the change, so only one of them is ever the "first" method.

  app.get('/mfa/methods', { preHandler: signedInNoMfaYet }, async (request) => {
    const staff = request.staff!;
    const { rows } = await db.query<{ id: string; nickname: string; created_at: Date; last_used_at: Date | null; backed_up: boolean; device_type: StaffPasskey['deviceType'] }>(
      'select id, nickname, created_at, last_used_at, backed_up, device_type from staff_passkeys where staff_id = $1 order by created_at',
      [staff.id],
    );
    const passkeys: StaffPasskey[] = rows.map((row) => ({
      id: row.id,
      nickname: row.nickname,
      createdAt: iso(row.created_at)!,
      lastUsedAt: iso(row.last_used_at),
      backedUp: row.backed_up,
      deviceType: row.device_type,
    }));
    return { summary: await mfaSummary(db, staff.id), passkeys, emailAvailable: services.email.canSend, stepUpUntil: stepUpUntil(staff.stepUpAt) };
  });

  // ── Step-up: a recent strong check before a security change ──────────────

  app.post('/mfa/step-up/options', { preHandler: signedIn, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    const options = await authenticationOptions(db, rp(request), 'step_up', { staffId: staff.id, sessionId: staff.sessionId }, staff.id);
    return options ?? sendError(reply, 400, 'BAD_REQUEST', 'This account has no passkeys.');
  });

  // Only an account whose only method is email codes steps up with one.
  app.post('/mfa/step-up/email', { preHandler: signedIn, config: { rateLimit: { max: 5, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    runInBackground(
      async () => {
        const summary = await mfaSummary(db, staff.id);
        if (summary.emailCodes && strongFor('email', summary)) await sendEmailCode(services, staff, staff.sessionId, 'step_up');
      },
      (error) => request.log.error({ code: (error as { code?: unknown }).code }, 'Email code could not be sent'),
    );
    return reply.code(202).send({ message: `If email codes are your way to confirm, a code is on its way. It expires in ${EMAIL_CODE_MINUTES} minutes.` });
  });

  app.post('/mfa/step-up', { preHandler: signedIn, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    const summary = await mfaSummary(db, staff.id);
    const allow: StaffMfaMethod[] = strongFor('email', summary) ? ['passkey', 'totp', 'recovery', 'email'] : ['passkey', 'totp', 'recovery'];
    // Wrong answers count against the account's budget, taken before the answer is checked.
    const attempt = await takeAttempt(db, staff.id);
    if (!attempt) return sendError(reply, 429, 'RATE_LIMITED', 'Too many incorrect attempts. Try again later.');
    const result = await checkSecondFactor(services, staff.id, request.body, { allow, purpose: 'step_up', sessionId: staff.sessionId, rp: rp(request) });
    if (!result.method) {
      await attemptFailed(db, staff.id, attempt);
      await audit(db, staffActor(staff), 'staff.step_up_failed', staffTarget(staff.id));
      if (result.clonedPasskey) await audit(db, staffActor(staff), 'staff.passkey_counter_went_back', staffTarget(staff.id), { passkeyId: result.clonedPasskey });
      return sendError(reply, 400, 'VALIDATION_FAILED', 'That didn’t work. Check it and try again.');
    }
    await resetAttempts(db, staff.id);
    await db.query('update staff_sessions set step_up_at = now() where id = $1', [staff.sessionId]);
    await audit(db, staffActor(staff), 'staff.step_up', staffTarget(staff.id), { method: result.method });
    return { stepUpUntil: new Date(Date.now() + STEP_UP_MINUTES * 60_000).toISOString() };
  });

  // ── Passkeys ─────────────────────────────────────────────────────────────

  app.post('/mfa/passkeys/options', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!mayChange(staff)) return stepUpNeeded(reply);
    return registrationOptions(db, rp(request), staff, staff.sessionId);
  });

  app.post('/mfa/passkeys', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!mayChange(staff)) return stepUpNeeded(reply);
    const body = request.body as { passkey?: unknown; nickname?: unknown } | null;
    const nickname = nicknameFrom(body?.nickname, request.headers['user-agent']);
    if (!nickname) return sendError(reply, 400, 'VALIDATION_FAILED', `Give the passkey a name of up to ${NICKNAME_MAX} characters.`);
    const response = asRegistrationResponse(body?.passkey);
    const created = response ? await checkRegistration(db, rp(request), { staffId: staff.id, sessionId: staff.sessionId }, response) : null;
    if (!created) return sendError(reply, 400, 'VALIDATION_FAILED', 'That passkey couldn’t be added. Please try again.');
    const { rows } = await db.query<{ id: string | null; first: boolean }>(
      `with before as (select mfa_enabled_at from staff_users where id = $1::uuid for update),
            added as (insert into staff_passkeys (staff_id, credential_id, public_key, counter, transports, aaguid, device_type, backed_up, nickname)
                      values ($1::uuid, $2, $3, $4, $5::text[], $6, $7, $8, $9)
                      on conflict (credential_id) do nothing returning id),
            switched as (update staff_users set mfa_enabled_at = coalesce(mfa_enabled_at, now())
                          where id = $1::uuid and exists (select 1 from added) and exists (select 1 from before))
       select (select id from added) as id, (select mfa_enabled_at is null from before) as first`,
      [staff.id, created.credentialId, created.publicKey, created.counter, created.transports, created.aaguid, created.deviceType, created.backedUp, nickname],
    );
    const row = rows[0]!;
    if (!row.id) return sendError(reply, 409, 'CONFLICT', 'That passkey is already registered.');
    await changed(request, staff, 'staff.mfa_method_added', 'passkey', 'passkey_added');
    const passkey = { id: row.id, nickname };
    return row.first ? { passkey, ...(await firstMethod(request, reply, staff, 'passkey')) } : { passkey };
  });

  app.patch<{ Params: { id: string } }>('/mfa/passkeys/:id', { preHandler: signedIn }, async (request, reply) => {
    const staff = request.staff!;
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Passkey not found.');
    const value = (request.body as { nickname?: unknown } | null)?.nickname;
    const nickname = typeof value === 'string' && value.trim() ? nicknameFrom(value, undefined) : null;
    if (!nickname) return sendError(reply, 400, 'VALIDATION_FAILED', `Give the passkey a name of up to ${NICKNAME_MAX} characters.`);
    const { rows } = await db.query('update staff_passkeys set nickname = $3 where id = $1 and staff_id = $2 returning id', [request.params.id, staff.id, nickname]);
    if (!rows.length) return sendError(reply, 404, 'NOT_FOUND', 'Passkey not found.');
    await audit(db, staffActor(staff), 'staff.passkey_renamed', staffTarget(staff.id), { passkeyId: request.params.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/mfa/passkeys/:id', { preHandler: signedIn }, async (request, reply) => {
    const staff = request.staff!;
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'Passkey not found.');
    if (!stepUpFresh(staff.stepUpAt)) return stepUpNeeded(reply);
    const result = await removePasskey(db, staff.id, request.params.id, required());
    if (result !== 'removed') return removed(reply, result, 'Passkey');
    await changed(request, staff, 'staff.mfa_method_removed', 'passkey', 'passkey_removed');
    return { ok: true };
  });

  // ── The authenticator app (TOTP) ─────────────────────────────────────────

  app.post('/mfa/enrol/start', { preHandler: signedInNoMfaYet }, async (request, reply) => {
    const staff = request.staff!;
    if (!mayChange(staff)) return stepUpNeeded(reply);
    const secret = new Secret({ size: 20 });
    await db.query('update staff_users set mfa_pending_secret_enc = $2 where id = $1', [staff.id, services.secrets.encrypt(secret.base32)]);
    const uri = totpFor(secret.base32, staff.email).toString();
    return { otpauthUri: uri, secret: secret.base32, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  });

  app.post('/mfa/enrol/confirm', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!mayChange(staff)) return stepUpNeeded(reply);
    const { rows } = await db.query<{ mfa_pending_secret_enc: string | null }>('select mfa_pending_secret_enc from staff_users where id = $1', [staff.id]);
    const pending = rows[0]?.mfa_pending_secret_enc;
    const code = str(request.body, 'code', 10)?.replace(/\s/g, '') ?? '';
    const delta = pending && /^\d{6}$/.test(code) ? totpFor(services.secrets.decrypt(pending), '').validate({ token: code, window: 1 }) : null;
    if (!pending || delta === null) {
      return sendError(reply, 400, 'VALIDATION_FAILED', 'That code didn’t match. Check the time on your phone is set automatically and try again.');
    }
    const step = Math.floor(Date.now() / 30_000) + delta;
    const { rows: done } = await db.query<{ first: boolean; replaced: boolean }>(
      `with before as (select mfa_enabled_at, mfa_secret_enc from staff_users where id = $1::uuid for update)
       update staff_users set mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = null,
              mfa_enabled_at = coalesce(mfa_enabled_at, now()), mfa_last_step = $2
        where id = $1::uuid and mfa_pending_secret_enc is not null and exists (select 1 from before)
       returning (select mfa_enabled_at is null from before) as first, (select mfa_secret_enc is not null from before) as replaced`,
      [staff.id, step],
    );
    if (!done[0]) return sendError(reply, 400, 'VALIDATION_FAILED', 'Start setting up the app again.');
    await changed(request, staff, 'staff.mfa_method_added', 'totp', done[0].replaced ? 'app_replaced' : 'app_added');
    return done[0].first ? await firstMethod(request, reply, staff, 'totp') : { ok: true };
  });

  app.delete('/mfa/app', { preHandler: signedIn }, async (request, reply) => {
    const staff = request.staff!;
    if (!stepUpFresh(staff.stepUpAt)) return stepUpNeeded(reply);
    const result = await removeApp(db, staff.id, required());
    if (result !== 'removed') return removed(reply, result, 'Authenticator app');
    await changed(request, staff, 'staff.mfa_method_removed', 'totp', 'app_removed');
    return { ok: true };
  });

  // ── Email codes ──────────────────────────────────────────────────────────

  // Turning them on proves the inbox works: a code goes to the account's address first.
  app.post('/mfa/email-codes/start', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 5, timeWindow: 15 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!services.email.canSend) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Email isn’t set up on this site, so email codes aren’t available.');
    if (!mayChange(staff)) return stepUpNeeded(reply);
    runInBackground(
      () => sendEmailCode(services, staff, staff.sessionId, 'enable'),
      (error) => request.log.error({ code: (error as { code?: unknown }).code }, 'Email code could not be sent'),
    );
    return reply
      .code(202)
      .send({ message: `A code is on its way to your email address, unless three have been sent in the last 15 minutes. It expires in ${EMAIL_CODE_MINUTES} minutes.` });
  });

  app.post('/mfa/email-codes/confirm', { preHandler: signedInNoMfaYet, config: { rateLimit: { max: 15, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!mayChange(staff)) return stepUpNeeded(reply);
    const attempt = await takeAttempt(db, staff.id);
    if (!attempt) return sendError(reply, 429, 'RATE_LIMITED', 'Too many incorrect attempts. Try again later.');
    if (!(await checkEmailCode(services, staff.id, staff.sessionId, 'enable', str(request.body, 'code', 10)))) {
      await attemptFailed(db, staff.id, attempt);
      await audit(db, staffActor(staff), 'staff.mfa_failed', staffTarget(staff.id), { step: 'email_codes_on' });
      return sendError(reply, 400, 'VALIDATION_FAILED', 'That code didn’t work. Use the newest email and try again.');
    }
    await resetAttempts(db, staff.id);
    const { rows } = await db.query<{ first: boolean; already: boolean }>(
      `with before as (select mfa_enabled_at, email_codes_enabled_at from staff_users where id = $1::uuid for update)
       update staff_users set email_codes_enabled_at = coalesce(email_codes_enabled_at, now()), mfa_enabled_at = coalesce(mfa_enabled_at, now())
        where id = $1::uuid and exists (select 1 from before)
       returning (select mfa_enabled_at is null from before) as first, (select email_codes_enabled_at is not null from before) as already`,
      [staff.id],
    );
    if (!rows[0]!.already) await changed(request, staff, 'staff.mfa_method_added', 'email', 'email_codes_on');
    return rows[0]!.first ? await firstMethod(request, reply, staff, 'email') : { ok: true };
  });

  app.delete('/mfa/email-codes', { preHandler: signedIn }, async (request, reply) => {
    const staff = request.staff!;
    if (!stepUpFresh(staff.stepUpAt)) return stepUpNeeded(reply);
    const result = await removeEmailCodes(db, staff.id, required());
    if (result !== 'removed') return removed(reply, result, 'Email codes');
    await changed(request, staff, 'staff.mfa_method_removed', 'email', 'email_codes_off');
    return { ok: true };
  });

  // ── Recovery codes ───────────────────────────────────────────────────────

  // A recent strong check, or (as before) a passkey, app or recovery code sent with the request.
  app.post('/mfa/recovery-codes', { preHandler: signedIn, config: { rateLimit: { max: 5, timeWindow: 5 * 60_000 } } }, async (request, reply) => {
    const staff = request.staff!;
    if (!staff.mfaEnabled) return sendError(reply, 400, 'BAD_REQUEST', 'Two-step verification is not set up.');
    if (!stepUpFresh(staff.stepUpAt)) {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (body.code === undefined && body.recoveryCode === undefined && body.passkey === undefined) return stepUpNeeded(reply);
      const attempt = await takeAttempt(db, staff.id);
      if (!attempt) return sendError(reply, 429, 'RATE_LIMITED', 'Too many incorrect attempts. Try again later.');
      const result = await checkSecondFactor(services, staff.id, body, { allow: ['passkey', 'totp', 'recovery'], purpose: 'step_up', sessionId: staff.sessionId, rp: rp(request) });
      if (!result.method) {
        await attemptFailed(db, staff.id, attempt);
        return sendError(reply, 400, 'VALIDATION_FAILED', 'Enter a current code from your authenticator app.');
      }
      await resetAttempts(db, staff.id);
    }
    const recoveryCodes = await replaceRecoveryCodes(services, staff.id);
    await audit(db, staffActor(staff), 'staff.recovery_codes_replaced', staffTarget(staff.id));
    notifySecurityChange(services, request, staff.email, 'recovery_codes_replaced');
    return { recoveryCodes };
  });
}
