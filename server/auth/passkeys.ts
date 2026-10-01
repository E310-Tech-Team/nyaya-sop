/**
 * Staff passkeys (WebAuthn, through @simplewebauthn/server): registering one, the step after the
 * password, signing in with a passkey alone, the check before a security change, and confirming a
 * password reset. Every ceremony requires user verification (the device's fingerprint, face or
 * PIN), so a passkey is two factors on its own.
 *
 * Challenges are random, single-use, five minutes long and bound to what asked for them (the
 * session, the reset link, or nothing yet for a passkey-only sign-in); each is used up by the
 * statement that checks it, so a replayed or racing response finds it gone.
 */
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { AppConfig } from '../config';
import type { Queryable } from '../db';

export type ChallengePurpose = 'sign_in' | 'second_step' | 'step_up' | 'register' | 'password_reset';
/** What a challenge belongs to: the session (and its staff member), a reset link, or nothing (passkey-only sign-in). */
export type ChallengeBinding = { staffId?: string; sessionId?: string; tokenId?: string };

const CHALLENGE_SECONDS = 5 * 60;
const RP_NAME = 'School of Purpose admin';
const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;

export type RelyingParty = { rpID: string; origins: string[] };

/**
 * Where passkeys belong: SITE_URL's host, used only from SITE_URL's origin. A computer without
 * SITE_URL (development, tests) uses localhost from a localhost page: browsers refuse an IP
 * address as a passkey's domain. Never derived from request headers where SITE_URL is set.
 */
export function relyingParty(config: AppConfig, requestOrigin: unknown): RelyingParty {
  if (config.siteOrigin) return { rpID: new URL(config.siteOrigin).hostname, origins: [config.siteOrigin] };
  const origin = typeof requestOrigin === 'string' && LOCALHOST_ORIGIN.test(requestOrigin) ? requestOrigin : 'http://localhost';
  return { rpID: 'localhost', origins: [origin] };
}

// ── Challenges ───────────────────────────────────────────────────────────────

async function saveChallenge(db: Queryable, purpose: ChallengePurpose, challenge: string, binding: ChallengeBinding): Promise<void> {
  // Old ones go as new ones arrive (passkey-only sign-in creates them before anyone is known).
  await db.query(`delete from staff_passkey_challenges where expires_at < now() - interval '1 hour'`);
  await db.query(
    `insert into staff_passkey_challenges (purpose, challenge, staff_id, session_id, token_id, expires_at)
     values ($1::staff_challenge_purpose, $2, $3::uuid, $4::uuid, $5::uuid, now() + make_interval(secs => $6))`,
    [purpose, challenge, binding.staffId ?? null, binding.sessionId ?? null, binding.tokenId ?? null, CHALLENGE_SECONDS],
  );
}

/** Uses up the challenge in the statement that checks it. */
async function takeChallenge(db: Queryable, purpose: ChallengePurpose, challenge: string, binding: ChallengeBinding): Promise<boolean> {
  const { rows } = await db.query(
    `update staff_passkey_challenges set used_at = now()
      where challenge = $1 and purpose = $2::staff_challenge_purpose and used_at is null and expires_at > now()
        and staff_id is not distinct from $3::uuid and session_id is not distinct from $4::uuid and token_id is not distinct from $5::uuid
      returning id`,
    [challenge, purpose, binding.staffId ?? null, binding.sessionId ?? null, binding.tokenId ?? null],
  );
  return rows.length === 1;
}

// ── Stored passkeys ──────────────────────────────────────────────────────────

export type PasskeyRow = {
  id: string;
  staff_id: string;
  credential_id: string;
  public_key: Uint8Array;
  counter: string | number;
  transports: string[];
  user_handle: string | null;
};

const PASSKEY_COLUMNS = `p.id, p.staff_id, p.credential_id, p.public_key, p.counter, p.transports, u.webauthn_user_id as user_handle`;

async function passkeysOf(db: Queryable, staffId: string): Promise<{ id: string; transports: string[] }[]> {
  const { rows } = await db.query<{ credential_id: string; transports: string[] }>(
    'select credential_id, transports from staff_passkeys where staff_id = $1 order by created_at',
    [staffId],
  );
  return rows.map((row) => ({ id: row.credential_id, transports: row.transports }));
}

/** The passkey a response names (by its credential ID), whoever it belongs to; null if none. */
export async function findPasskey(db: Queryable, response: AuthenticationResponseJSON): Promise<PasskeyRow | null> {
  const { rows } = await db.query<PasskeyRow>(
    `select ${PASSKEY_COLUMNS} from staff_passkeys p join staff_users u on u.id = p.staff_id where p.credential_id = $1`,
    [response.id],
  );
  return rows[0] ?? null;
}

/** The passkey's user handle: random, made once per staff member (cleared by a reset). */
async function userHandleFor(db: Queryable, staffId: string): Promise<string> {
  const { rows } = await db.query<{ handle: string }>(
    'update staff_users set webauthn_user_id = coalesce(webauthn_user_id, $2) where id = $1 returning webauthn_user_id as handle',
    [staffId, isoBase64URL.fromBuffer(randomBytes(32))],
  );
  return rows[0]!.handle;
}

// ── Untrusted input ──────────────────────────────────────────────────────────

const b64 = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The shape the browser library sends after navigator.credentials.get, within sane sizes. */
export function asAuthenticationResponse(value: unknown): AuthenticationResponseJSON | null {
  if (!object(value) || !object(value.response) || value.type !== 'public-key') return null;
  const { response } = value;
  if (!b64(value.id, 1400) || value.rawId !== value.id) return null;
  if (!b64(response.clientDataJSON, 4096) || !b64(response.authenticatorData, 4096) || !b64(response.signature, 1024)) return null;
  if (response.userHandle !== undefined && response.userHandle !== null && !b64(response.userHandle, 256)) return null;
  return {
    id: value.id,
    rawId: value.id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
      signature: response.signature,
      ...(typeof response.userHandle === 'string' ? { userHandle: response.userHandle } : {}),
    },
  };
}

/** The shape the browser library sends after navigator.credentials.create, within sane sizes. */
export function asRegistrationResponse(value: unknown): RegistrationResponseJSON | null {
  if (!object(value) || !object(value.response) || value.type !== 'public-key') return null;
  const { response } = value;
  if (!b64(value.id, 1400) || value.rawId !== value.id) return null;
  if (!b64(response.clientDataJSON, 4096) || !b64(response.attestationObject, 65_536)) return null;
  const transports = Array.isArray(response.transports)
    ? response.transports.filter((item): item is string => typeof item === 'string' && /^[a-z-]{1,20}$/.test(item)).slice(0, 8)
    : [];
  return {
    id: value.id,
    rawId: value.id,
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON: response.clientDataJSON, attestationObject: response.attestationObject, transports },
  };
}

// ── Ceremonies ───────────────────────────────────────────────────────────────

/**
 * Options for navigator.credentials.get. With a staff member: only their passkeys (null if they
 * have none). Without one (passkey-only sign-in): any passkey the device holds for this site.
 */
export async function authenticationOptions(
  db: Queryable,
  rp: RelyingParty,
  purpose: ChallengePurpose,
  binding: ChallengeBinding,
  staffId: string | null,
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const allowCredentials = staffId ? await passkeysOf(db, staffId) : undefined;
  if (allowCredentials && !allowCredentials.length) return null;
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, allowCredentials, userVerification: 'required', timeout: CHALLENGE_SECONDS * 1000 });
  await saveChallenge(db, purpose, options.challenge, binding);
  return options;
}

export type PasskeyCheck = { ok: true } | { ok: false; counterWentBack: boolean };

/**
 * Checks an assertion from `passkey` against a challenge for `purpose` bound to `binding`, then
 * records the new signature counter. A counter that went backwards is refused (the library
 * throws) and reported, as it suggests a cloned key. With `requireUserHandle` (passkey-only
 * sign-in) the response must name the passkey's own account.
 */
export async function checkPasskey(
  db: Queryable,
  rp: RelyingParty,
  passkey: PasskeyRow,
  response: AuthenticationResponseJSON,
  purpose: ChallengePurpose,
  binding: ChallengeBinding,
  options: { requireUserHandle?: boolean } = {},
): Promise<PasskeyCheck> {
  const userHandle = response.response.userHandle;
  if ((options.requireUserHandle || userHandle) && (!passkey.user_handle || userHandle !== passkey.user_handle)) {
    // Use the challenge up anyway: a refused response never leaves a live challenge behind.
    await takeChallenge(db, purpose, challengeOf(response), binding);
    return { ok: false, counterWentBack: false };
  }
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => takeChallenge(db, purpose, challenge, binding),
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: { id: passkey.credential_id, publicKey: new Uint8Array(passkey.public_key), counter: Number(passkey.counter), transports: passkey.transports },
    });
    if (!verification.verified) return { ok: false, counterWentBack: false };
    await db.query(
      'update staff_passkeys set counter = greatest(counter, $2), backed_up = $3, last_used_at = now() where id = $1',
      [passkey.id, verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialBackedUp],
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, counterWentBack: /counter value/i.test(error instanceof Error ? error.message : '') };
  }
}

/** The challenge a response claims to answer (for using it up when the response is refused early). */
function challengeOf(response: AuthenticationResponseJSON): string {
  try {
    const parsed = JSON.parse(isoBase64URL.toUTF8String(response.response.clientDataJSON)) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? parsed.challenge : '';
  } catch {
    return '';
  }
}

/** Options for navigator.credentials.create: a discoverable passkey if the device can make one (for passkey-only sign-in). */
export async function registrationOptions(
  db: Queryable,
  rp: RelyingParty,
  staff: { id: string; email: string; displayName: string },
  sessionId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const userHandle = await userHandleFor(db, staff.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: staff.email,
    userDisplayName: staff.displayName,
    userID: isoBase64URL.toBuffer(userHandle),
    attestationType: 'none',
    excludeCredentials: await passkeysOf(db, staff.id),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    timeout: CHALLENGE_SECONDS * 1000,
  });
  await saveChallenge(db, 'register', options.challenge, { staffId: staff.id, sessionId });
  return options;
}

export type NewPasskey = {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  aaguid: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
};

/** Checks a registration against this session's challenge; null if it doesn't hold up. */
export async function checkRegistration(
  db: Queryable,
  rp: RelyingParty,
  binding: { staffId: string; sessionId: string },
  response: RegistrationResponseJSON,
): Promise<NewPasskey | null> {
  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => takeChallenge(db, 'register', challenge, binding),
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified) return null;
    const { credential, aaguid, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: (credential.transports ?? []).filter((item) => /^[a-z-]{1,20}$/.test(item)).slice(0, 8),
      aaguid,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    };
  } catch {
    return null;
  }
}
