import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StaffRole } from '../src/shared/permissions';
import { backgroundIdle } from './background';
import { sha256Hex } from './crypto';
import { SoftAuthenticator, type SoftPasskey } from './test-webauthn';
import { asUser, cookieFrom, createStaff, createTestContext, nextVisitor, ORIGIN, staffSignIn, totpCode, type Session, type TestContext } from './test-helpers';

// Passkeys and email codes for staff two-step verification (06 D-58). Every passkey here is a
// software authenticator with a real key: the server's WebAuthn checks run for real.

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx?.close());

const soft = new SoftAuthenticator();

const req = (session: Session | null) => (options: InjectOptions) => asUser(ctx.app, session)({ remoteAddress: nextVisitor(), ...options });
const login = (email: string, password: string) =>
  ctx.app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: nextVisitor(), headers: { origin: ORIGIN }, payload: { email, password } });
const sessionOf = (res: LightMyRequestResponse): Session => ({ cookie: cookieFrom(res), csrf: res.json().csrfToken as string });
const resetBudget = (staffId: string) => ctx.db.query('update staff_users set failed_login_count = 0, locked_until = null where id = $1', [staffId]);
const auditRows = async (action: string, staffId: string) =>
  (await ctx.db.query<{ details: Record<string, unknown> }>('select details from audit_events where action = $1 and target_id = $2', [action, staffId])).rows;
/** Makes this session's last strong check older than the five minutes a change allows. */
const staleStepUp = (session: Session) =>
  ctx.db.query(`update staff_sessions set step_up_at = now() - interval '10 minutes' where token_hash = $1`, [sha256Hex(session.cookie.split('=')[1]!)]);
/** A fresh window for the three-per-15-minutes limit (and no outstanding codes). */
const freshSendWindow = (staffId: string) => ctx.db.query('delete from staff_email_codes where staff_id = $1', [staffId]);

/** The newest email code sent to `email`. */
async function emailedCode(email: string): Promise<string | undefined> {
  await backgroundIdle();
  const message = [...ctx.outbox.messages].reverse().find((item) => item.to === email && item.purpose === 'staff_email_code');
  return /\b(\d{6})\b/.exec(message?.text ?? '')?.[1];
}
const codeEmails = (email: string) => ctx.outbox.messages.filter((item) => item.to === email && item.purpose === 'staff_email_code').length;
const securityEmails = (email: string) => ctx.outbox.messages.filter((item) => item.to === email && item.purpose === 'staff_security');

type Staff = Awaited<ReturnType<typeof createStaff>>;

/** A staff member whose first (and only) method is a passkey registered through the API. */
async function staffWithPasskey(role: StaffRole = 'reviewer'): Promise<{ staff: Staff; passkey: SoftPasskey; session: Session; recoveryCodes: string[] }> {
  const staff = await createStaff(ctx, { role, mfa: false });
  const pending = sessionOf(await login(staff.email, staff.password));
  const options = (await req(pending)({ method: 'POST', url: '/api/admin/mfa/passkeys/options' })).json();
  const { response, passkey } = soft.register(options);
  const added = await req(pending)({ method: 'POST', url: '/api/admin/mfa/passkeys', payload: { passkey: response, nickname: 'Laptop' } });
  if (added.statusCode !== 200) throw new Error(`passkey registration failed: ${added.statusCode} ${added.body}`);
  return { staff, passkey, session: sessionOf(added), recoveryCodes: added.json().recoveryCodes as string[] };
}

/** Password, then a passkey answer (from `passkey`, or tweaked by `answer`). */
async function passwordThenPasskey(staff: Staff, passkey: SoftPasskey, answer?: (options: never) => unknown) {
  const pending = sessionOf(await login(staff.email, staff.password));
  const options = (await req(pending)({ method: 'POST', url: '/api/admin/mfa/passkey/options' })).json();
  const response = answer ? answer(options as never) : soft.authenticate(passkey, options);
  return { pending, result: await req(pending)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { passkey: response } }) };
}

/** A staff member whose only method is email codes (the owner's decision: allowed on their own). */
async function staffWithEmailCodes(): Promise<{ staff: Staff; session: Session; recoveryCodes: string[] }> {
  const staff = await createStaff(ctx, { role: 'reviewer', mfa: false });
  const pending = sessionOf(await login(staff.email, staff.password));
  expect((await req(pending)({ method: 'POST', url: '/api/admin/mfa/email-codes/start' })).statusCode).toBe(202);
  const confirm = await req(pending)({ method: 'POST', url: '/api/admin/mfa/email-codes/confirm', payload: { code: await emailedCode(staff.email) } });
  if (confirm.statusCode !== 200) throw new Error(`email codes failed: ${confirm.statusCode} ${confirm.body}`);
  return { staff, session: sessionOf(confirm), recoveryCodes: confirm.json().recoveryCodes as string[] };
}

beforeEach(() => {
  ctx.outbox.messages.length = 0;
});

describe('passkeys', () => {
  it('registers a passkey as the first method, then signs in with it after the password and on its own', async () => {
    const { staff, passkey, session, recoveryCodes } = await staffWithPasskey('owner');
    expect(recoveryCodes).toHaveLength(10);
    // Registering the first method finished signing in: this session is a verified one.
    expect((await req(session)({ url: '/api/admin/dashboard' })).statusCode).toBe(200);
    expect((await auditRows('staff.mfa_enabled', staff.id))[0]?.details).toEqual({ method: 'passkey' });
    await backgroundIdle();
    expect(securityEmails(staff.email)).toHaveLength(1);

    // Password, then the passkey (a new session replaces the password-only one).
    const { pending, result } = await passwordThenPasskey(staff, passkey);
    expect(result.statusCode).toBe(200);
    expect((await req(pending)({ url: '/api/admin/session' })).statusCode).toBe(401);
    const full = req(sessionOf(result));
    expect((await full({ url: '/api/admin/session' })).json().mfa).toMatchObject({ enabled: true, verified: true, methods: { passkeys: 1 } });
    expect((await full({ url: '/api/admin/dashboard' })).statusCode).toBe(200);

    // The passkey on its own: the challenge names no account until the passkey does.
    const options = await req(null)({ method: 'POST', url: '/api/admin/passkey/sign-in/options' });
    expect(options.json().allowCredentials).toBeUndefined();
    const signedIn = await req(null)({ method: 'POST', url: '/api/admin/passkey/sign-in', payload: { passkey: soft.authenticate(passkey, options.json()) } });
    expect(signedIn.json()).toMatchObject({ next: 'done' });
    expect((await req(sessionOf(signedIn))({ url: '/api/admin/dashboard' })).statusCode).toBe(200);
    expect((await auditRows('staff.login', staff.id)).map((row) => row.details.step)).toContain('passkey');
  });

  it('refuses a wrong origin, a wrong domain, no user verification, a replay, another session’s challenge and someone else’s passkey (security audit)', async () => {
    const { staff, passkey } = await staffWithPasskey();
    const other = await staffWithPasskey();
    const refused = async (answer: (options: never) => unknown) => {
      const { result } = await passwordThenPasskey(staff, passkey, answer);
      await resetBudget(staff.id);
      return result.statusCode;
    };
    expect(await refused((options) => soft.authenticate(passkey, options, { origin: 'https://evil.example' }))).toBe(401);
    expect(await refused((options) => soft.authenticate(passkey, options, { rpId: 'evil.example' }))).toBe(401);
    expect(await refused((options) => soft.authenticate(passkey, options, { userVerified: false }))).toBe(401);
    expect(await refused((options) => soft.authenticate(other.passkey, options))).toBe(401);

    // A response answers one challenge, once, in the session that asked for it.
    const first = sessionOf(await login(staff.email, staff.password));
    const second = sessionOf(await login(staff.email, staff.password));
    const options = (await req(first)({ method: 'POST', url: '/api/admin/mfa/passkey/options' })).json();
    const response = soft.authenticate(passkey, options);
    expect((await req(second)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { passkey: response } })).statusCode).toBe(401);
    await resetBudget(staff.id);
    const third = sessionOf(await login(staff.email, staff.password));
    await req(third)({ method: 'POST', url: '/api/admin/mfa/passkey/options' });
    expect((await req(third)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { passkey: response } })).statusCode).toBe(401);
    await resetBudget(staff.id);

    // On its own, the response must name the passkey's own account.
    const alone = (await req(null)({ method: 'POST', url: '/api/admin/passkey/sign-in/options' })).json();
    const wrongHandle = soft.authenticate(passkey, alone, { userHandle: other.passkey.userHandle });
    expect((await req(null)({ method: 'POST', url: '/api/admin/passkey/sign-in', payload: { passkey: wrongHandle } })).statusCode).toBe(401);
    await resetBudget(staff.id);
    // The challenge it answered is used up even so.
    expect((await req(null)({ method: 'POST', url: '/api/admin/passkey/sign-in', payload: { passkey: soft.authenticate(passkey, alone) } })).statusCode).toBe(401);
  });

  it('refuses a signature counter that goes backwards and reports a possible cloned key (security audit)', async () => {
    const { staff, passkey } = await staffWithPasskey();
    expect((await passwordThenPasskey(staff, passkey, (options) => soft.authenticate(passkey, options, { counter: 7 }))).result.statusCode).toBe(200);
    expect((await passwordThenPasskey(staff, passkey, (options) => soft.authenticate(passkey, options, { counter: 3 }))).result.statusCode).toBe(401);
    expect(await auditRows('staff.passkey_counter_went_back', staff.id)).toHaveLength(1);
  });

  it('lets exactly one of two racing answers to the same challenge through (security audit)', async () => {
    const { staff, passkey } = await staffWithPasskey();
    const pending = sessionOf(await login(staff.email, staff.password));
    const options = (await req(pending)({ method: 'POST', url: '/api/admin/mfa/passkey/options' })).json();
    const response = soft.authenticate(passkey, options);
    const results = await Promise.all([1, 2].map(() => req(pending)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { passkey: response } })));
    expect(results.map((res) => res.statusCode).sort()).toEqual([200, 401]);
  });

  it('confirms a password reset with a passkey bound to the reset link', async () => {
    const { staff, passkey } = await staffWithPasskey();
    await req(null)({ method: 'POST', url: '/api/admin/password/forgot', payload: { email: staff.email } });
    await backgroundIdle();
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(staff.email)?.text ?? '')?.[1];
    const options = await req(null)({ method: 'POST', url: '/api/admin/password/reset/passkey', payload: { token } });
    expect(options.statusCode).toBe(200);
    const reset = await req(null)({
      method: 'POST',
      url: '/api/admin/password/reset',
      payload: { token, password: 'a brand new long password', passkey: soft.authenticate(passkey, options.json()) },
    });
    expect(reset.json()).toEqual({ ok: true });
    expect((await login(staff.email, 'a brand new long password')).json().next).toBe('mfa');
  });

  it('never logs credentials or challenges', async () => {
    const { staff, passkey } = await staffWithPasskey();
    await passwordThenPasskey(staff, passkey);
    const logs = ctx.logs.join('\n');
    expect(logs).not.toContain(passkey.credentialId);
    const { rows } = await ctx.db.query<{ challenge: string }>('select challenge from staff_passkey_challenges order by created_at desc limit 5');
    for (const row of rows) expect(logs).not.toContain(row.challenge);
  });
});

describe('email codes', () => {
  it('can be an account’s only method (the owner’s decision), proven by a first code, then used to sign in', async () => {
    const { staff, session, recoveryCodes } = await staffWithEmailCodes();
    expect(recoveryCodes).toHaveLength(10);
    expect((await req(session)({ url: '/api/admin/session' })).json().mfa.methods).toMatchObject({ emailCodes: true, passkeys: 0, app: false });

    const pending = sessionOf(await login(staff.email, staff.password));
    expect((await req(pending)({ method: 'POST', url: '/api/admin/mfa/email/send' })).statusCode).toBe(202);
    const verify = await req(pending)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { emailCode: await emailedCode(staff.email) } });
    expect(verify.statusCode).toBe(200);
    expect((await auditRows('staff.mfa_verified', staff.id)).map((row) => row.details.method)).toContain('email');
    // The email carries the code and no link.
    const message = [...ctx.outbox.messages].reverse().find((item) => item.purpose === 'staff_email_code')!;
    expect(message.text).not.toMatch(/https?:\/\//);
  });

  it('refuses a wrong, expired, reused, replaced or another session’s code (security audit)', async () => {
    const { staff } = await staffWithEmailCodes();
    const pendingSession = async () => sessionOf(await login(staff.email, staff.password));
    const send = async (session: Session) => {
      await req(session)({ method: 'POST', url: '/api/admin/mfa/email/send' });
      return emailedCode(staff.email);
    };
    const verify = (session: Session, emailCode: string | undefined) => req(session)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { emailCode } });

    await freshSendWindow(staff.id);
    const a = await pendingSession();
    const codeA = await send(a);
    const wrong = codeA === '000000' ? '000001' : '000000';
    expect((await verify(a, wrong)).statusCode).toBe(401);
    // Another session's code.
    const b = await pendingSession();
    expect((await verify(b, codeA)).statusCode).toBe(401);
    await resetBudget(staff.id);

    // A newer code replaces the older one.
    await freshSendWindow(staff.id);
    const c = await pendingSession();
    const first = await send(c);
    const second = await send(c);
    if (first !== second) expect((await verify(c, first)).statusCode).toBe(401);
    expect((await verify(c, second)).statusCode).toBe(200);
    await resetBudget(staff.id);

    // Used once, even by two requests racing each other.
    await freshSendWindow(staff.id);
    const d = await pendingSession();
    const once = await send(d);
    const racing = await Promise.all([verify(d, once), verify(d, once)]);
    expect(racing.map((res) => res.statusCode).sort()).toEqual([200, 401]);
    await resetBudget(staff.id);

    // Expired.
    await freshSendWindow(staff.id);
    const e = await pendingSession();
    const late = await send(e);
    await ctx.db.query(`update staff_email_codes set expires_at = now() - interval '1 minute' where staff_id = $1`, [staff.id]);
    expect((await verify(e, late)).statusCode).toBe(401);
  });

  it('answers the same whether or not a code is sent, and sends at most three in 15 minutes', async () => {
    const { staff } = await staffWithEmailCodes();
    const pending = sessionOf(await login(staff.email, staff.password));
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await req(pending)({ method: 'POST', url: '/api/admin/mfa/email/send' }));
    await backgroundIdle();
    expect(new Set(answers.map((res) => `${res.statusCode} ${res.body}`)).size).toBe(1);
    expect(codeEmails(staff.email)).toBe(3); // the one that turned them on, plus two

    // An account without email codes gets the same answer and no email.
    const appOnly = await createStaff(ctx, { role: 'reviewer' });
    const appPending = sessionOf(await login(appOnly.email, appOnly.password));
    const answer = await req(appPending)({ method: 'POST', url: '/api/admin/mfa/email/send' });
    await backgroundIdle();
    expect(`${answer.statusCode} ${answer.body}`).toBe(`${answers[0]!.statusCode} ${answers[0]!.body}`);
    expect(codeEmails(appOnly.email)).toBe(0);
  });

  it('is never accepted for a password reset: the link already came by email (security audit)', async () => {
    const { staff, recoveryCodes } = await staffWithEmailCodes();
    await req(null)({ method: 'POST', url: '/api/admin/password/forgot', payload: { email: staff.email } });
    await backgroundIdle();
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(staff.email)?.text ?? '')?.[1];
    const pending = sessionOf(await login(staff.email, staff.password));
    await req(pending)({ method: 'POST', url: '/api/admin/mfa/email/send' });
    const emailCode = await emailedCode(staff.email);
    const reset = (extra: object) => req(null)({ method: 'POST', url: '/api/admin/password/reset', payload: { token, password: 'another long new password', ...extra } });
    expect((await reset({ emailCode })).json().code).toBe('MFA_REQUIRED');
    // A recovery code does it.
    expect((await reset({ recoveryCode: recoveryCodes[0] })).json()).toEqual({ ok: true });
  });

  it('counts wrong codes against the account’s budget, shared with passwords (security audit)', async () => {
    const { staff } = await staffWithEmailCodes();
    for (let i = 0; i < 5; i++) {
      const pending = sessionOf(await login(staff.email, staff.password));
      await req(pending)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { emailCode: '000000' } });
    }
    expect((await login(staff.email, staff.password)).statusCode).toBe(401); // locked
  });
});

describe('managing methods', () => {
  it('needs a recent strong check for a change; an email code doesn’t count while a stronger method exists', async () => {
    const staff = await createStaff(ctx, { role: 'reviewer' });
    const session = await staffSignIn(ctx, staff); // the app code just now counts as a strong check
    const as = req(session);
    expect((await as({ method: 'POST', url: '/api/admin/mfa/passkeys/options' })).statusCode).toBe(200);
    // Email codes on, then the check goes stale.
    await as({ method: 'POST', url: '/api/admin/mfa/email-codes/start' });
    expect((await as({ method: 'POST', url: '/api/admin/mfa/email-codes/confirm', payload: { code: await emailedCode(staff.email) } })).json()).toEqual({ ok: true });
    await staleStepUp(session);
    expect((await as({ method: 'POST', url: '/api/admin/mfa/passkeys/options' })).json().code).toBe('STEP_UP_REQUIRED');
    expect((await as({ method: 'DELETE', url: '/api/admin/mfa/email-codes' })).json().code).toBe('STEP_UP_REQUIRED');
    // No step-up code is emailed to an account that has the app, and none is accepted.
    const before = codeEmails(staff.email);
    await as({ method: 'POST', url: '/api/admin/mfa/step-up/email' });
    await backgroundIdle();
    expect(codeEmails(staff.email)).toBe(before);
    expect((await as({ method: 'POST', url: '/api/admin/mfa/step-up', payload: { emailCode: '123456' } })).statusCode).toBe(400);
    await resetBudget(staff.id);
    // The app does it.
    const stepUp = await as({ method: 'POST', url: '/api/admin/mfa/step-up', payload: { code: totpCode(staff.totpSecret!, 1) } });
    expect(stepUp.statusCode).toBe(200);
    expect((await as({ method: 'DELETE', url: '/api/admin/mfa/email-codes' })).json()).toEqual({ ok: true });
    await backgroundIdle();
    expect(securityEmails(staff.email).map((item) => item.text)).toEqual([expect.stringMatching(/turned on/), expect.stringMatching(/turned off/)]);
  });

  it('lets an email-codes-only account confirm changes with an email code', async () => {
    const { staff, session } = await staffWithEmailCodes();
    await staleStepUp(session);
    const as = req(session);
    expect((await as({ method: 'POST', url: '/api/admin/mfa/passkeys/options' })).json().code).toBe('STEP_UP_REQUIRED');
    await as({ method: 'POST', url: '/api/admin/mfa/step-up/email' });
    expect((await as({ method: 'POST', url: '/api/admin/mfa/step-up', payload: { emailCode: await emailedCode(staff.email) } })).statusCode).toBe(200);
    const options = await as({ method: 'POST', url: '/api/admin/mfa/passkeys/options' });
    const { response } = soft.register(options.json());
    const added = await as({ method: 'POST', url: '/api/admin/mfa/passkeys', payload: { passkey: response } });
    expect(added.json().passkey.nickname).toBeTruthy(); // named after the device when no name is given
    expect(added.json().recoveryCodes).toBeUndefined(); // not the first method
  });

  it('never removes the last method while two-step verification is required, even with two removals at once (security audit)', async () => {
    const { staff, session } = await staffWithPasskey();
    const as = req(session);
    const options = (await as({ method: 'POST', url: '/api/admin/mfa/passkeys/options' })).json();
    expect((await as({ method: 'POST', url: '/api/admin/mfa/passkeys', payload: { passkey: soft.register(options).response, nickname: 'Phone' } })).statusCode).toBe(200);
    const list = (await as({ url: '/api/admin/mfa/methods' })).json();
    expect(list.passkeys.map((item: { nickname: string }) => item.nickname)).toEqual(['Laptop', 'Phone']);
    // Exactly the keys a list shows: no secrets, no credential IDs.
    expect(Object.keys(list.passkeys[0]).sort()).toEqual(['backedUp', 'createdAt', 'deviceType', 'id', 'lastUsedAt', 'nickname']);
    const removals = await Promise.all(
      list.passkeys.map((item: { id: string }) => as({ method: 'DELETE', url: `/api/admin/mfa/passkeys/${item.id}` })),
    );
    expect(removals.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    const remaining = (await as({ url: '/api/admin/mfa/methods' })).json();
    expect(remaining.summary).toMatchObject({ passkeys: 1, app: false, emailCodes: false });
    expect((await as({ method: 'DELETE', url: `/api/admin/mfa/passkeys/${remaining.passkeys[0].id}` })).json().code).toBe('LAST_METHOD');
    const { rows } = await ctx.db.query<{ on: boolean }>('select mfa_enabled_at is not null as on from staff_users where id = $1', [staff.id]);
    expect(rows[0]!.on).toBe(true);
  });

  it('renames passkeys and audits identifiers and method names only', async () => {
    const { staff, session } = await staffWithPasskey();
    const as = req(session);
    const [passkey] = (await as({ url: '/api/admin/mfa/methods' })).json().passkeys;
    expect((await as({ method: 'PATCH', url: `/api/admin/mfa/passkeys/${passkey.id}`, payload: { nickname: '  Work\u0000 laptop ' } })).statusCode).toBe(200);
    expect((await as({ url: '/api/admin/mfa/methods' })).json().passkeys[0].nickname).toBe('Work laptop');
    expect((await as({ method: 'PATCH', url: `/api/admin/mfa/passkeys/${passkey.id}`, payload: { nickname: 'x'.repeat(61) } })).statusCode).toBe(400);
    const { rows } = await ctx.db.query<{ details: string }>(`select details::text from audit_events where target_id = $1`, [staff.id]);
    expect(rows.map((row) => row.details).join(' ')).not.toMatch(/laptop/i);
  });

  it('an owner’s reset clears every method and tells the staff member', async () => {
    const owner = await staffSignIn(ctx, await createStaff(ctx, { role: 'owner' }));
    const staff = await createStaff(ctx, { role: 'reviewer' });
    const session = await staffSignIn(ctx, staff);
    const as = req(session);
    const options = (await as({ method: 'POST', url: '/api/admin/mfa/passkeys/options' })).json();
    await as({ method: 'POST', url: '/api/admin/mfa/passkeys', payload: { passkey: soft.register(options).response } });
    await as({ method: 'POST', url: '/api/admin/mfa/email-codes/start' });
    await as({ method: 'POST', url: '/api/admin/mfa/email-codes/confirm', payload: { code: await emailedCode(staff.email) } });
    await backgroundIdle();
    ctx.outbox.messages.length = 0;

    expect((await req(owner)({ method: 'POST', url: `/api/admin/staff/${staff.id}/reset-mfa` })).json()).toEqual({ ok: true });
    const { rows } = await ctx.db.query<Record<string, unknown>>(
      `select mfa_enabled_at, mfa_secret_enc, email_codes_enabled_at, webauthn_user_id,
              (select count(*)::int from staff_passkeys where staff_id = $1) as passkeys,
              (select count(*)::int from staff_recovery_codes where staff_id = $1) as recovery
         from staff_users where id = $1`,
      [staff.id],
    );
    expect(rows[0]).toEqual({ mfa_enabled_at: null, mfa_secret_enc: null, email_codes_enabled_at: null, webauthn_user_id: null, passkeys: 0, recovery: 0 });
    expect((await as({ url: '/api/admin/session' })).statusCode).toBe(401); // signed out everywhere
    await backgroundIdle();
    expect(securityEmails(staff.email).map((item) => item.text)).toEqual([expect.stringMatching(/An owner reset/)]);
    expect((await login(staff.email, staff.password)).json().next).toBe('mfa_setup');
  });
});
