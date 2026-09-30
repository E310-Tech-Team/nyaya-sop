import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validPayload } from '../src/shared/test-fixtures';
import { createStaffInvite } from './auth/staff-routes';
import { backgroundIdle } from './background';
import { sha256Hex } from './crypto';
import { clearSettingsCache, putSetting } from './settings';
import {
  applicantSignIn,
  asUser,
  cookieFrom,
  createStaff,
  createTestContext,
  nextVisitor,
  ORIGIN,
  staffSignIn,
  totpCode,
  type TestContext,
} from './test-helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx?.close());

const login = (email: string, password: string, remoteAddress = nextVisitor()) =>
  ctx.app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress, headers: { origin: ORIGIN }, payload: { email, password } });
const post = (url: string, payload: object) =>
  ctx.app.inject({ method: 'POST', url, remoteAddress: nextVisitor(), headers: { origin: ORIGIN }, payload });

const auditCount = async (action: string) =>
  (await ctx.db.query<{ n: number }>('select count(*)::int as n from audit_events where action = $1', [action])).rows[0]!.n;

describe('staff sign-in', () => {
  it('gives the same answer for unknown emails and wrong passwords', async () => {
    const staff = await createStaff(ctx, { role: 'reviewer' });
    const unknown = await login('nobody@example.org', 'whatever-password');
    const wrong = await login(staff.email, 'not the password');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const staff = await createStaff(ctx, { role: 'reviewer' });
    for (let i = 0; i < 5; i++) expect((await login(staff.email, `wrong ${i} password`)).statusCode).toBe(401);
    expect((await login(staff.email, staff.password)).statusCode).toBe(401);
    expect(await auditCount('staff.login_locked')).toBeGreaterThan(0);
  });

  it('requires the second factor before anything else works', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const res = await login(staff.email, staff.password);
    expect(res.json().next).toBe('mfa');
    const session = { cookie: cookieFrom(res), csrf: res.json().csrfToken };
    const as = asUser(ctx.app, session);
    expect((await as({ url: '/api/admin/dashboard' })).json().code).toBe('MFA_REQUIRED');
    expect((await as({ url: '/api/admin/session' })).json().mfa).toMatchObject({ enabled: true, verified: false });
    expect((await as({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code: '000000' } })).statusCode).toBe(401);
    const verified = await as({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code: totpCode(staff.totpSecret!) } });
    expect(verified.statusCode).toBe(200);
    const full = asUser(ctx.app, { cookie: cookieFrom(verified), csrf: verified.json().csrfToken });
    expect((await full({ url: '/api/admin/dashboard' })).statusCode).toBe(200);
  });

  it('never accepts the same code twice', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const code = totpCode(staff.totpSecret!);
    const first = await login(staff.email, staff.password);
    const a = asUser(ctx.app, { cookie: cookieFrom(first), csrf: first.json().csrfToken });
    expect((await a({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code } })).statusCode).toBe(200);
    const second = await login(staff.email, staff.password);
    const b = asUser(ctx.app, { cookie: cookieFrom(second), csrf: second.json().csrfToken });
    expect((await b({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code } })).statusCode).toBe(401);
  });

  it('locks after repeated wrong codes, even across fresh password sign-ins', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    let lastStatus = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await login(staff.email, staff.password);
      if (res.statusCode !== 200) {
        lastStatus = res.statusCode;
        break;
      }
      const as = asUser(ctx.app, { cookie: cookieFrom(res), csrf: res.json().csrfToken });
      await as({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code: '123456' } });
    }
    expect(lastStatus).toBe(401); // the password alone no longer gets a new session
  });

  it('makes staff without a second factor set one up (when required), then issues single-use recovery codes', async () => {
    const staff = await createStaff(ctx, { role: 'programme_admin', mfa: false });
    const res = await login(staff.email, staff.password);
    expect(res.json().next).toBe('mfa_setup');
    const as = asUser(ctx.app, { cookie: cookieFrom(res), csrf: res.json().csrfToken });
    expect((await as({ url: '/api/admin/applicants' })).json().code).toBe('MFA_SETUP_REQUIRED');
    const start = await as({ method: 'POST', url: '/api/admin/mfa/enrol/start' });
    expect(start.json().qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(start.json().otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const confirm = await as({ method: 'POST', url: '/api/admin/mfa/enrol/confirm', payload: { code: totpCode(start.json().secret) } });
    const codes = confirm.json().recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    // Enrolling starts a new session: the password-only one has ended.
    expect((await as({ url: '/api/admin/applicants' })).statusCode).toBe(401);
    const enrolled = asUser(ctx.app, { cookie: cookieFrom(confirm), csrf: confirm.json().csrfToken });
    expect((await enrolled({ url: '/api/admin/applicants' })).statusCode).toBe(200);

    // Next sign-in with a recovery code: works once.
    const again = await login(staff.email, staff.password);
    const b = asUser(ctx.app, { cookie: cookieFrom(again), csrf: again.json().csrfToken });
    const used = await b({ method: 'POST', url: '/api/admin/mfa/verify', payload: { recoveryCode: codes[0]!.toLowerCase() } });
    expect(used.json()).toMatchObject({ ok: true, recoveryCodesRemaining: 9 });
    const third = await login(staff.email, staff.password);
    const c = asUser(ctx.app, { cookie: cookieFrom(third), csrf: third.json().csrfToken });
    expect((await c({ method: 'POST', url: '/api/admin/mfa/verify', payload: { recoveryCode: codes[0] } })).statusCode).toBe(401);
  });

  it('rate-limits sign-in attempts from one network address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login('flood@example.org', 'whatever-password', '203.0.113.99')).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('refuses changes without the CSRF token or from another origin', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const session = await staffSignIn(ctx, staff);
    const noToken = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/me/sessions/revoke-others',
      headers: { origin: ORIGIN, cookie: session.cookie },
    });
    expect(noToken.statusCode).toBe(403);
    const foreign = await asUser(ctx.app, session)({
      method: 'POST',
      url: '/api/admin/me/sessions/revoke-others',
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.json().code).toBe('INVALID_ORIGIN');
    const ok = await asUser(ctx.app, session)({ method: 'POST', url: '/api/admin/me/sessions/revoke-others' });
    expect(ok.statusCode).toBe(200);
  });

  it('signs out a suspended staff member at once', async () => {
    const staff = await createStaff(ctx, { role: 'reviewer' });
    const session = await staffSignIn(ctx, staff);
    await ctx.db.query(`update staff_users set status = 'suspended', suspended_at = now() where id = $1`, [staff.id]);
    expect((await asUser(ctx.app, session)({ url: '/api/admin/session' })).statusCode).toBe(401);
  });
});

describe('staff invitation and password reset', () => {
  it('sets a first password through a single-use invitation link', async () => {
    const invite = await createStaffInvite(ctx.services, { email: 'new.person@example.org', displayName: 'New Person', role: 'reviewer', invitedBy: null });
    if (invite === 'exists') throw new Error('unexpected');
    expect(invite.emailed).toBe(true);
    const token = new URL(invite.url).searchParams.get('token')!;
    const check = await post('/api/admin/setup/check', { token });
    expect(check.json()).toEqual({ email: 'new.person@example.org', displayName: 'New Person' });
    const weak = await post('/api/admin/setup/complete', { token, password: 'short' });
    expect(weak.statusCode).toBe(400);
    const done = await post('/api/admin/setup/complete', { token, password: 'a long enough passphrase here' });
    expect(done.json().next).toBe('mfa_setup');
    const reuse = await post('/api/admin/setup/complete', { token, password: 'another long passphrase here' });
    expect(reuse.json().code).toBe('INVALID_TOKEN');
  });

  it('answers password-reset requests generically, and needs the second factor to reset', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const session = await staffSignIn(ctx, staff);
    const forgot = (email: string) => post('/api/admin/password/forgot', { email });
    const unknown = await forgot('missing@example.org');
    const known = await forgot(staff.email);
    expect(unknown.statusCode).toBe(202);
    expect(known.json().message).toBe(unknown.json().message);
    await backgroundIdle(); // the link is prepared after the answer
    expect(ctx.outbox.latest('missing@example.org')).toBeNull();
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(staff.email)!.text)![1]!;
    const reset = (payload: object) => post('/api/admin/password/reset', { token, password: 'brand new passphrase 2026', ...payload });
    expect((await reset({})).json().code).toBe('MFA_REQUIRED'); // the emailed link alone isn't enough
    expect((await reset({ code: totpCode(staff.totpSecret!, 1) })).statusCode).toBe(200);
    expect((await reset({ code: totpCode(staff.totpSecret!, 1) })).statusCode).toBe(400); // single use
    expect((await asUser(ctx.app, session)({ url: '/api/admin/session' })).statusCode).toBe(401); // old sessions revoked
    expect((await login(staff.email, 'brand new passphrase 2026')).statusCode).toBe(200);
  });
});

describe('attack resistance (security audit)', () => {
  const staffRow = async (id: string) =>
    (await ctx.db.query<{ failed_login_count: number; locked: boolean }>(
      `select failed_login_count, coalesce(locked_until > now(), false) as locked from staff_users where id = $1`,
      [id],
    )).rows[0]!;
  const auditFor = async (action: string, id: string) =>
    (await ctx.db.query<{ n: number }>('select count(*)::int as n from audit_events where action = $1 and target_id = $2', [action, id])).rows[0]!.n;

  it('counts every wrong password, even when they arrive at the same moment', async () => {
    const staff = await createStaff(ctx, { role: 'reviewer' });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => login(staff.email, `wrong guess ${i} here`)));
    expect(results.every((res) => res.statusCode === 401)).toBe(true);
    // Only the budget's five were checked at all; the rest were refused as locked.
    expect(await auditFor('staff.login_failed', staff.id)).toBe(5);
    expect(await staffRow(staff.id)).toEqual({ failed_login_count: 5, locked: true });
    expect((await login(staff.email, staff.password)).statusCode).toBe(401);
  });

  it('checks at most five codes per sign-in, even when they arrive at the same moment', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const res = await login(staff.email, staff.password);
    const as = asUser(ctx.app, { cookie: cookieFrom(res), csrf: res.json().csrfToken });
    // A little latency on every query, as a real database has, so the requests really overlap.
    const query = ctx.db.query.bind(ctx.db);
    ctx.db.query = (async (text: string, params?: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      return query(text, params);
    }) as typeof ctx.db.query;
    const codes = await Promise.all(Array.from({ length: 10 }, () => as({ method: 'POST', url: '/api/admin/mfa/verify', remoteAddress: nextVisitor(), payload: { code: '000000' } }))).finally(
      () => (ctx.db.query = query),
    );
    expect(codes.every((code) => code.statusCode === 401)).toBe(true);
    expect(await auditFor('staff.mfa_failed', staff.id)).toBe(5);
    expect(await staffRow(staff.id)).toEqual({ failed_login_count: 5, locked: true });
    // The right code no longer helps: the session is over and the account is locked.
    expect((await as({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code: totpCode(staff.totpSecret!) } })).statusCode).toBe(401);
  });

  it('counts wrong codes on a password reset against the same lock', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    await post('/api/admin/password/forgot', { email: staff.email });
    await backgroundIdle();
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(staff.email)!.text)![1]!;
    const reset = (payload: object) => post('/api/admin/password/reset', { token, password: 'a fresh passphrase 2026', ...payload });
    for (let i = 0; i < 5; i++) expect((await reset({ code: '000000' })).json().code).toBe('MFA_REQUIRED');
    expect(await staffRow(staff.id)).toEqual({ failed_login_count: 5, locked: true });
    // Locked: even the right code is refused, and the link stays unused.
    const locked = await reset({ code: totpCode(staff.totpSecret!) });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().code).toBe('UNAUTHORIZED');
    // Once the lock runs out, one attempt at a time gets through, and the right code works.
    await ctx.db.query(`update staff_users set locked_until = now() - interval '1 second' where id = $1`, [staff.id]);
    expect((await reset({ code: totpCode(staff.totpSecret!, 1) })).statusCode).toBe(200);
    expect(await staffRow(staff.id)).toEqual({ failed_login_count: 0, locked: false });
  });

  it('lets one attempt at a time through after a lock runs out, and locks for longer after another failure', async () => {
    const staff = await createStaff(ctx, { role: 'reviewer', mfa: false });
    for (let i = 0; i < 5; i++) await login(staff.email, `wrong ${i} password`);
    await ctx.db.query(`update staff_users set locked_until = now() - interval '1 second' where id = $1`, [staff.id]);
    const burst = await Promise.all(Array.from({ length: 4 }, (_, i) => login(staff.email, `still wrong ${i}`)));
    expect(burst.every((res) => res.statusCode === 401)).toBe(true);
    expect(await auditFor('staff.login_failed', staff.id)).toBe(6); // five, then just one more
    const { rows } = await ctx.db.query<{ minutes: number }>(`select (extract(epoch from locked_until - now()) / 60)::float8 as minutes from staff_users where id = $1`, [staff.id]);
    expect(rows[0]!.minutes).toBeGreaterThan(25); // 30 minutes this time
    // A correct password once the lock runs out signs in (no second factor on this account).
    await ctx.db.query(`update staff_users set locked_until = now() - interval '1 second' where id = $1`, [staff.id]);
    expect((await login(staff.email, staff.password)).statusCode).toBe(200);
    expect(await staffRow(staff.id)).toEqual({ failed_login_count: 0, locked: false });
  });

  it('starts a new session once the second factor is passed', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const res = await login(staff.email, staff.password);
    const pending = { cookie: cookieFrom(res), csrf: res.json().csrfToken };
    const verify = await asUser(ctx.app, pending)({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code: totpCode(staff.totpSecret!) } });
    expect(verify.statusCode).toBe(200);
    const full = { cookie: cookieFrom(verify), csrf: verify.json().csrfToken };
    expect(full.cookie).not.toBe(pending.cookie);
    expect((await asUser(ctx.app, pending)({ url: '/api/admin/session' })).statusCode).toBe(401);
    expect((await asUser(ctx.app, full)({ url: '/api/admin/dashboard' })).statusCode).toBe(200);
  });

  it('keeps only the newest reset link, and none once the password changes', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const linkFor = async () => {
      await post('/api/admin/password/forgot', { email: staff.email });
      await backgroundIdle();
      return /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(staff.email)!.text)![1]!;
    };
    const first = await linkFor();
    const second = await linkFor();
    const reset = (token: string) => post('/api/admin/password/reset', { token, password: 'yet another passphrase 26', code: totpCode(staff.totpSecret!) });
    expect((await reset(first)).json().code).toBe('INVALID_TOKEN');
    // A password change (while signed in) makes the remaining link useless too.
    const session = await staffSignIn(ctx, staff);
    const change = await asUser(ctx.app, session)({
      method: 'POST',
      url: '/api/admin/me/password',
      payload: { currentPassword: staff.password, newPassword: 'changed while signed in 26' },
    });
    expect(change.statusCode).toBe(200);
    expect((await reset(second)).json().code).toBe('INVALID_TOKEN');
  });

  it('answers a reset request for a real account without waiting for the email', async () => {
    const staff = await createStaff(ctx, { role: 'owner' });
    const send = ctx.services.email.send.bind(ctx.services.email);
    ctx.services.email.send = async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return send(message);
    };
    try {
      const started = Date.now();
      const res = await post('/api/admin/password/forgot', { email: staff.email });
      expect(res.statusCode).toBe(202);
      expect(Date.now() - started).toBeLessThan(300);
      await backgroundIdle();
      expect(ctx.outbox.latest(staff.email)).not.toBeNull();
    } finally {
      ctx.services.email.send = send;
    }
  });

  it('stores recovery codes keyed to the server, and still accepts codes stored the old way', async () => {
    const staff = await createStaff(ctx, { role: 'programme_admin', mfa: false });
    const res = await login(staff.email, staff.password);
    const as = asUser(ctx.app, { cookie: cookieFrom(res), csrf: res.json().csrfToken });
    const start = await as({ method: 'POST', url: '/api/admin/mfa/enrol/start' });
    const confirm = await as({ method: 'POST', url: '/api/admin/mfa/enrol/confirm', payload: { code: totpCode(start.json().secret) } });
    const codes = confirm.json().recoveryCodes as string[];
    const stored = await ctx.db.query<{ code_hash: string }>('select code_hash from staff_recovery_codes where staff_id = $1', [staff.id]);
    const plain = codes.map((code) => sha256Hex(code.replace('-', '')));
    expect(stored.rows.some((row) => plain.includes(row.code_hash))).toBe(false);
    // A code saved before the change (plain SHA-256) still signs in, once.
    await ctx.db.query(`insert into staff_recovery_codes (staff_id, code_hash) values ($1, $2)`, [staff.id, sha256Hex('ABCDEFGHJK')]);
    const again = await login(staff.email, staff.password);
    const b = asUser(ctx.app, { cookie: cookieFrom(again), csrf: again.json().csrfToken });
    expect((await b({ method: 'POST', url: '/api/admin/mfa/verify', payload: { recoveryCode: 'abcde-fghjk' } })).statusCode).toBe(200);
  });

  it('shows the local test outbox (which holds sign-in links) only to this computer, never through a proxy', async () => {
    const outbox = (options: { headers?: Record<string, string>; remoteAddress?: string } = {}) => ctx.app.inject({ method: 'GET', url: '/api/dev/outbox', ...options });
    expect((await outbox()).statusCode).toBe(200);
    expect((await outbox({ remoteAddress: '::ffff:127.0.0.1' })).statusCode).toBe(200);
    expect((await outbox({ remoteAddress: '203.0.113.7' })).statusCode).toBe(404);
    for (const [name, value] of [['x-forwarded-for', '203.0.113.7'], ['x-real-ip', '203.0.113.7'], ['forwarded', 'for=203.0.113.7'], ['via', '1.1 proxy']]) {
      expect((await outbox({ headers: { [name]: value } })).statusCode).toBe(404);
    }
  });
});

describe('applicant accounts (security audit)', () => {
  it('closes open sessions when applicant accounts are switched off, and refuses links meanwhile', async () => {
    const session = await applicantSignIn(ctx, 'switched.off@example.com');
    const me = () => asUser(ctx.app, session)({ url: '/api/account/me' });
    expect((await me()).statusCode).toBe(200);
    await post('/api/account/sign-in', { email: 'switched.off@example.com' });
    const pending = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest('switched.off@example.com')!.text)![1]!;
    const owner = await createStaff(ctx, { role: 'owner' });
    await putSetting(ctx.db, 'applicant_accounts_enabled', false, owner.id);
    clearSettingsCache();
    try {
      expect((await me()).json().code).toBe('ACCOUNTS_UNAVAILABLE');
      expect((await post('/api/account/verify', { token: pending })).json().code).toBe('ACCOUNTS_UNAVAILABLE');
    } finally {
      await putSetting(ctx.db, 'applicant_accounts_enabled', true, owner.id);
      clearSettingsCache();
    }
    expect((await me()).statusCode).toBe(200);
  });

  it('stops every other sign-in link for an address once one is used', async () => {
    const email = 'two.links@example.com';
    await post('/api/account/sign-in', { email });
    const first = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(email)!.text)![1]!;
    await post('/api/account/sign-in', { email });
    const second = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(email)!.text)![1]!;
    expect(second).not.toBe(first);
    expect((await post('/api/account/verify', { token: second })).statusCode).toBe(200);
    expect((await post('/api/account/verify', { token: first })).json().code).toBe('INVALID_TOKEN');
  });
});

describe('applicant accounts', () => {
  it('sends a link without revealing whether an account exists, and each link works once', async () => {
    const start = (email: string) => post('/api/account/sign-in', { email });
    const res = await start('someone@example.com');
    expect(res.statusCode).toBe(202);
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest('someone@example.com')!.text)![1]!;
    const verify = () => post('/api/account/verify', { token });
    const first = await verify();
    expect(first.statusCode).toBe(200);
    expect((await verify()).json().code).toBe('INVALID_TOKEN');
    const again = await start('someone@example.com');
    expect(again.json().message).toBe(res.json().message);
  });

  it('refuses expired links', async () => {
    await post('/api/account/sign-in', { email: 'late@example.com' });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest('late@example.com')!.text)![1]!;
    await ctx.db.query(`update auth_tokens set expires_at = now() - interval '1 second' where email = 'late@example.com'`);
    const res = await post('/api/account/verify', { token });
    expect(res.json().code).toBe('INVALID_TOKEN');
  });

  it('turns sign-in off when email can’t be sent', async () => {
    const noEmail = await createTestContext({ EMAIL_TRANSPORT: 'none' });
    try {
      const res = await noEmail.app.inject({ method: 'POST', url: '/api/account/sign-in', headers: { origin: ORIGIN }, payload: { email: 'a@example.com' } });
      expect(res.json().code).toBe('ACCOUNTS_UNAVAILABLE');
      expect((await noEmail.app.inject('/api/config')).json().accounts.enabled).toBe(false);
    } finally {
      await noEmail.close();
    }
  });

  it('links an application only to the account with the verified matching email', async () => {
    const submitted = await ctx.app.inject({ method: 'POST', url: '/api/applications', payload: validPayload({ email: 'owner@example.com' }) });
    const applicationId = submitted.json().id as string;
    const owner = asUser(ctx.app, await applicantSignIn(ctx, 'owner@example.com'));
    const other = asUser(ctx.app, await applicantSignIn(ctx, 'other@example.com'));
    expect((await other({ url: '/api/account/applications' })).json().claimable).toEqual([]);
    expect((await other({ method: 'POST', url: `/api/account/applications/${applicationId}/claim` })).statusCode).toBe(404);
    const mine = (await owner({ url: '/api/account/applications' })).json();
    expect(mine.claimable.map((a: { id: string }) => a.id)).toEqual([applicationId]);
    expect((await owner({ method: 'POST', url: `/api/account/applications/${applicationId}/claim` })).statusCode).toBe(200);
    const after = (await owner({ url: '/api/account/applications' })).json();
    expect(after.claimed[0]).toMatchObject({ id: applicationId, status: 'submitted', statusLabel: 'Received', message: null });
  });

  it('never shows internal notes or unpublished decisions to the applicant', async () => {
    const submitted = await ctx.app.inject({ method: 'POST', url: '/api/applications', payload: validPayload({ email: 'private@example.com' }) });
    const id = submitted.json().id as string;
    const applicant = asUser(ctx.app, await applicantSignIn(ctx, 'private@example.com'));
    await applicant({ method: 'POST', url: `/api/account/applications/${id}/claim` });
    await ctx.db.query(`update applications set status = 'not_selected' where id = $1`, [id]);
    await ctx.db.query(`insert into application_notes (application_id, body) values ($1, 'SECRET REVIEW NOTE')`, [id]);
    const res = await applicant({ url: '/api/account/applications' });
    expect(res.body).not.toContain('SECRET REVIEW NOTE');
    expect(res.body).not.toContain('not_selected');
    expect(res.json().claimed[0].status).toBe('submitted');
  });

  it('blocks a suspended account, and needs the email typed back to delete one', async () => {
    const session = await applicantSignIn(ctx, 'leaving@example.com');
    const as = asUser(ctx.app, session);
    expect((await as({ method: 'POST', url: '/api/account/delete', payload: { confirm: 'wrong@example.com' } })).statusCode).toBe(400);
    expect((await as({ method: 'POST', url: '/api/account/delete', payload: { confirm: 'leaving@example.com' } })).statusCode).toBe(200);
    expect((await as({ url: '/api/account/me' })).statusCode).toBe(401);

    const suspended = await applicantSignIn(ctx, 'suspended@example.com');
    await ctx.db.query(`update applicant_accounts set status = 'suspended', suspended_at = now() where email = 'suspended@example.com'`);
    expect((await asUser(ctx.app, suspended)({ url: '/api/account/me' })).json().code).toBe('ACCOUNT_SUSPENDED');
  });
});
