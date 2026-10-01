/**
 * The staff second step, shared by signing in, security changes ("step-up") and password reset:
 * app codes (TOTP), recovery codes, email codes and passkeys, and the session that passing it
 * starts. Callers take the attempt budget (attempts.ts) BEFORE calling checkSecondFactor.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Secret, TOTP } from 'otpauth';
import { ROLE_PERMISSIONS } from '../../src/shared/permissions';
import type { StaffMfaMethod } from '../../src/shared/platform';
import { runInBackground } from '../background';
import { newRecoveryCode, normaliseRecoveryCode, sha256Hex } from '../crypto';
import { staffSecurityEmail, type StaffSecurityChange } from '../email';
import { deviceLabel, str } from '../http';
import type { Services } from '../services';
import { checkEmailCode, emailCodesOn } from './email-codes';
import type { StaffContext } from './guards';
import { mfaSummary, stepUpUntil } from './methods';
import { asAuthenticationResponse, checkPasskey, findPasskey, type RelyingParty } from './passkeys';
import { createStaffSession, csrfTokenFor, setSessionCookie } from './sessions';

// ── Authenticator app (TOTP) ─────────────────────────────────────────────────

const TOTP_BASE = { issuer: 'School of Purpose', algorithm: 'SHA1', digits: 6, period: 30 } as const;

export const totpFor = (secretBase32: string, label: string) => new TOTP({ ...TOTP_BASE, label, secret: Secret.fromBase32(secretBase32) });

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

// ── Recovery codes ───────────────────────────────────────────────────────────

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

export async function replaceRecoveryCodes(services: Services, staffId: string): Promise<string[]> {
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

// ── The check ────────────────────────────────────────────────────────────────

export type SecondFactorContext = {
  /** The methods this step accepts (email codes are never accepted for a password reset). */
  allow: readonly StaffMfaMethod[];
  purpose: 'second_step' | 'step_up' | 'password_reset';
  /** What a passkey challenge or an email code must belong to. */
  sessionId?: string;
  tokenId?: string;
  rp: RelyingParty;
};

/** The method that passed, or null; `clonedPasskey` names a passkey whose counter went backwards. */
export type SecondFactorResult = { method: StaffMfaMethod; clonedPasskey?: undefined } | { method: null; clonedPasskey?: string };

/**
 * Checks whichever answer the body carries: `passkey` (a WebAuthn assertion), `code` (the app),
 * `emailCode` or `recoveryCode`. Each is single-use. The caller has already taken the attempt.
 */
export async function checkSecondFactor(services: Services, staffId: string, body: unknown, context: SecondFactorContext): Promise<SecondFactorResult> {
  const { db } = services;
  const allows = (method: StaffMfaMethod) => context.allow.includes(method);
  const fields = (body ?? {}) as Record<string, unknown>;

  if (fields.passkey !== undefined) {
    const response = allows('passkey') ? asAuthenticationResponse(fields.passkey) : null;
    const passkey = response ? await findPasskey(db, response) : null;
    if (!response || !passkey || passkey.staff_id !== staffId) return { method: null };
    const binding = context.purpose === 'password_reset' ? { staffId, tokenId: context.tokenId } : { staffId, sessionId: context.sessionId };
    const check = await checkPasskey(db, context.rp, passkey, response, context.purpose, binding);
    return check.ok ? { method: 'passkey' } : { method: null, clonedPasskey: check.counterWentBack ? passkey.id : undefined };
  }

  const code = str(body, 'code', 10)?.replace(/\s/g, '');
  if (code && allows('totp')) {
    const { rows } = await db.query<{ mfa_secret_enc: string | null }>('select mfa_secret_enc from staff_users where id = $1', [staffId]);
    const secretEnc = rows[0]?.mfa_secret_enc;
    if (secretEnc && (await checkTotpCode(services, staffId, secretEnc, code))) return { method: 'totp' };
    return { method: null };
  }

  const emailCode = str(body, 'emailCode', 10);
  if (emailCode && allows('email') && context.sessionId && context.purpose !== 'password_reset') {
    if ((await emailCodesOn(db, staffId)) && (await checkEmailCode(services, staffId, context.sessionId, context.purpose, emailCode))) return { method: 'email' };
    return { method: null };
  }

  const recovery = str(body, 'recoveryCode', 20);
  if (recovery && allows('recovery') && (await useRecoveryCode(services, staffId, recovery))) return { method: 'recovery' };
  return { method: null };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function startStaffSession(services: Services, staffId: string, userAgent: string | undefined, reply: FastifyReply) {
  const { config, db } = services;
  const session = await createStaffSession(db, staffId, config.auth.staffSessionHours, deviceLabel(userAgent));
  setSessionCookie(reply, 'staff', session.token, config, config.auth.staffSessionHours * 3600);
  return session;
}

/**
 * Signing in is complete: a new session (new token, new id) replaces the one used so far, so
 * nothing issued before the second step carries over. `strong` marks a check good enough for
 * security changes for the next few minutes.
 */
export async function completeStaffSession(
  services: Services,
  staff: { id: string; sessionId: string | null },
  userAgent: string | undefined,
  reply: FastifyReply,
  method: StaffMfaMethod,
  strong: boolean,
): Promise<string> {
  const { db, secrets } = services;
  const session = await startStaffSession(services, staff.id, userAgent, reply);
  await db.query(
    `update staff_sessions set mfa_verified_at = now(), mfa_method = $2, step_up_at = case when $3::boolean then now() end where id = $1`,
    [session.id, method, strong],
  );
  if (staff.sessionId) await db.query('update staff_sessions set revoked_at = now() where id = $1', [staff.sessionId]);
  return csrfTokenFor(secrets, 'staff', session.id);
}

export async function sessionPayload(services: Services, staff: StaffContext) {
  return {
    staff: { id: staff.id, email: staff.email, displayName: staff.displayName, role: staff.role, mfaEnabled: staff.mfaEnabled },
    permissions: ROLE_PERMISSIONS[staff.role],
    mfa: {
      enabled: staff.mfaEnabled,
      verified: staff.mfaVerified,
      required: services.config.auth.staffMfaRequired,
      methods: await mfaSummary(services.db, staff.id),
      emailAvailable: services.email.canSend,
      stepUpUntil: stepUpUntil(staff.stepUpAt),
    },
    csrfToken: csrfTokenFor(services.secrets, 'staff', staff.sessionId),
  };
}

/** Tells the staff member their sign-in methods changed, without making the response wait. */
export function notifySecurityChange(services: Services, request: FastifyRequest, email: string, change: StaffSecurityChange): void {
  if (!services.email.canSend) return;
  runInBackground(
    () => services.email.send(staffSecurityEmail(email, change)),
    (error) => request.log.error({ code: (error as { code?: unknown }).code }, 'Security email could not be sent'),
  );
}
