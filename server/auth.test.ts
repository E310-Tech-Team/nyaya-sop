import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validPayload } from '../src/shared/test-fixtures';
import { createStaffInvite } from './auth/staff-routes';
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
    expect((await as({ method: 'POST', url: '/api/admin/mfa/verify', payload: { code: totpCode(staff.totpSecret!) } })).statusCode).toBe(200);
    expect((await as({ url: '/api/admin/dashboard' })).statusCode).toBe(200);
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
    expect((await as({ url: '/api/admin/applicants' })).statusCode).toBe(200);

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
