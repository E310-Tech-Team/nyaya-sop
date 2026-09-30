import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StaffRole } from '../src/shared/permissions';
import { NOTIFICATION_CONSENT_VERSION } from '../src/shared/platform';
import { validPayload } from '../src/shared/test-fixtures';
import { parseCsv } from './csv';
import {
  applicantSignIn,
  asUser,
  cookieFrom,
  createStaff,
  createTestContext,
  fakeSubscription,
  nextVisitor,
  ORIGIN,
  staffSignIn,
  type Session,
  type TestContext,
} from './test-helpers';

let ctx: TestContext;
const sessions = {} as Record<StaffRole, Session>;
const staffIds = {} as Record<StaffRole, string>;
const roles: StaffRole[] = ['owner', 'programme_admin', 'reviewer', 'communications', 'read_only'];

beforeAll(async () => {
  ctx = await createTestContext();
  for (const role of roles) {
    const staff = await createStaff(ctx, { role });
    staffIds[role] = staff.id;
    sessions[role] = await staffSignIn(ctx, staff);
  }
});
afterAll(() => ctx?.close());

const as = (role: StaffRole) => asUser(ctx.app, sessions[role]);
const submit = async (email: string, extra: object = {}) =>
  (await ctx.app.inject({ method: 'POST', url: '/api/applications', payload: validPayload({ email, ...extra }) })).json().id as string;

describe('role permissions are enforced by the API', () => {
  const matrix: [string, string, StaffRole[]][] = [
    ['GET', '/api/admin/dashboard', ['owner', 'programme_admin', 'reviewer', 'communications', 'read_only']],
    ['GET', '/api/admin/applicants', ['owner', 'programme_admin', 'reviewer']],
    ['GET', '/api/admin/applicants/export.csv', ['owner', 'programme_admin']],
    ['GET', '/api/admin/accounts', ['owner', 'programme_admin']],
    ['GET', '/api/admin/campaigns', ['owner', 'programme_admin', 'communications']],
    ['GET', '/api/admin/announcements', ['owner', 'programme_admin', 'communications']],
    ['GET', '/api/admin/staff', ['owner']],
    ['GET', '/api/admin/settings', ['owner']],
    ['GET', '/api/admin/audit', ['owner', 'programme_admin']],
    // Parish directory, Parish review and Reports (docs/05 §6: decision D-32 for reports).
    ['GET', '/api/admin/directory/overview', ['owner', 'programme_admin']],
    ['GET', '/api/admin/directory/browse', ['owner', 'programme_admin']],
    ['GET', '/api/admin/directory/imports', ['owner', 'programme_admin']],
    ['GET', '/api/admin/directory/lineage', ['owner', 'programme_admin']],
    ['GET', '/api/admin/parish-review', ['owner', 'programme_admin']],
    ['GET', '/api/admin/parish-review/earlier/matches', ['owner', 'programme_admin']],
    ['GET', '/api/admin/reports/summary', ['owner', 'programme_admin']],
    ['GET', '/api/admin/reports/units', ['owner', 'programme_admin']],
    ['GET', '/api/admin/reports/units.csv', ['owner', 'programme_admin']],
    ['GET', '/api/admin/reports/trend', ['owner', 'programme_admin']],
    ['GET', '/api/admin/reports/cohorts', ['owner', 'programme_admin']],
    ['GET', '/api/admin/reports/overview', ['owner', 'programme_admin']],
  ];
  it.each(matrix)('%s %s', async (method, url, allowed) => {
    for (const role of roles) {
      const res = await as(role)({ method: method as 'GET', url });
      expect({ role, status: res.statusCode }).toEqual({ role, status: allowed.includes(role) ? 200 : 403 });
    }
  });

  it('rejects requests with no staff session at all', async () => {
    expect((await ctx.app.inject('/api/admin/applicants')).statusCode).toBe(401);
  });

  it.each([
    ['POST', '/api/admin/directory/parishes'],
    ['PATCH', `/api/admin/directory/parishes/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`],
    ['POST', `/api/admin/parish-review/reports/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/resolve`],
    ['POST', `/api/admin/applicants/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/parish`],
  ])('%s %s changes things only for owners and programme admins', async (method, url) => {
    for (const role of roles) {
      const res = await as(role)({ method: method as 'POST', url, payload: {} });
      expect({ role, forbidden: res.statusCode === 403 }).toEqual({ role, forbidden: !['owner', 'programme_admin'].includes(role) });
    }
  });
});

describe('staff accounts (security audit)', () => {
  it('keeps an active owner even when two owners demote or suspend each other at the same moment', async () => {
    const isolated = await createTestContext();
    try {
      const [a, b] = [await createStaff(isolated, { role: 'owner' }), await createStaff(isolated, { role: 'owner' })];
      const [asA, asB] = [asUser(isolated.app, await staffSignIn(isolated, a)), asUser(isolated.app, await staffSignIn(isolated, b))];
      // A little latency on every query, as a real database has, so the two requests really overlap.
      const query = isolated.db.query.bind(isolated.db);
      isolated.db.query = (async (text: string, params?: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return query(text, params);
      }) as typeof isolated.db.query;
      const results = await Promise.all([
        asA({ method: 'POST', url: `/api/admin/staff/${b.id}/role`, payload: { role: 'reviewer' } }),
        asB({ method: 'POST', url: `/api/admin/staff/${a.id}/role`, payload: { role: 'reviewer' } }),
      ]).finally(() => (isolated.db.query = query));
      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 409]);
      const owners = await isolated.db.query<{ n: number }>(`select count(*)::int as n from staff_users where role = 'owner' and status = 'active'`);
      expect(owners.rows[0]!.n).toBe(1);
    } finally {
      await isolated.close();
    }
  });

  it('ends a suspended person’s invitation and reset links, and lets owners lift a sign-in lock', async () => {
    const invited = await as('owner')({ method: 'POST', url: '/api/admin/staff', payload: { email: 'links.end@example.org', displayName: 'Links End', role: 'reviewer' } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest('links.end@example.org')!.text)![1]!;
    const check = () => ctx.app.inject({ method: 'POST', url: '/api/admin/setup/check', remoteAddress: nextVisitor(), headers: { origin: ORIGIN }, payload: { token } });
    expect((await check()).statusCode).toBe(200);
    const suspended = await as('owner')({ method: 'POST', url: `/api/admin/staff/${invited.json().id}/suspend` });
    expect({ status: suspended.statusCode, body: suspended.json() }).toEqual({ status: 200, body: { ok: true } });
    expect((await check()).json().code).toBe('INVALID_TOKEN');
    await as('owner')({ method: 'POST', url: `/api/admin/staff/${invited.json().id}/reactivate` });
    expect((await check()).json().code).toBe('INVALID_TOKEN'); // reactivating doesn't revive the old link

    const locked = await createStaff(ctx, { role: 'reviewer', mfa: false });
    const login = (password: string) =>
      ctx.app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: nextVisitor(), headers: { origin: ORIGIN }, payload: { email: locked.email, password } });
    for (let i = 0; i < 5; i++) await login(`wrong password ${i} here`);
    expect((await login(locked.password)).statusCode).toBe(401);
    for (const role of roles.filter((role) => role !== 'owner')) {
      expect((await as(role)({ method: 'POST', url: `/api/admin/staff/${locked.id}/unlock` })).statusCode).toBe(403);
    }
    expect((await as('owner')({ method: 'POST', url: `/api/admin/staff/${locked.id}/unlock` })).statusCode).toBe(200);
    expect((await as('owner')({ method: 'POST', url: `/api/admin/staff/${locked.id}/unlock` })).statusCode).toBe(409);
    const signedIn = await login(locked.password);
    expect(signedIn.statusCode).toBe(200);
    expect(cookieFrom(signedIn)).not.toBe('');
    const { rows } = await ctx.db.query(`select count(*)::int as n from audit_events where action = 'staff.unlocked' and target_id = $1`, [locked.id]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('reads odd query strings without failing: repeated keys, built-in names, impossible dates (security audit)', async () => {
    for (const url of [
      '/api/admin/applicants?q=a&q=b',
      '/api/admin/applicants?sort=constructor',
      '/api/admin/applicants?sort=__proto__',
      '/api/admin/applicants?to=2026-02-30',
      '/api/admin/reports/summary?from=2026-02-30',
      '/api/admin/reports/trend?from=0000-01-01',
      '/api/admin/reports/units?level=province&q=a&q=b',
      '/api/admin/directory/search?q=lagos&q=b',
      '/api/admin/accounts?q=a&q=b',
    ]) {
      expect((await as('owner')({ url })).statusCode, url).toBe(200);
    }
    const unknownCohort = await as('owner')({
      method: 'POST',
      url: '/api/admin/announcements',
      payload: { title: 'Hello', body: 'Welcome', audience: 'applicants', cohortId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(unknownCohort.statusCode).toBe(400);
    expect(unknownCohort.json().fieldErrors.cohortId).toBeDefined();
  });

  it('shows raw job errors on the dashboard only to staff who look after the platform', async () => {
    await ctx.db.query(`insert into jobs (kind, status, last_error) values ('probe.failed', 'failed', 'Push service said 400 for probe')`);
    const failures = async (role: StaffRole) => ((await as(role)({ url: '/api/admin/dashboard' })).json().queue.recentFailures as { kind: string; last_error: string | null }[]).find((row) => row.kind === 'probe.failed');
    expect(await failures('owner')).toMatchObject({ last_error: 'Push service said 400 for probe' });
    expect(await failures('read_only')).toMatchObject({ last_error: null });
    expect(await failures('reviewer')).toMatchObject({ last_error: null });
  });
});

describe('applicant review', () => {
  it('limits reviewers to the applications assigned to them', async () => {
    const mine = await submit('assigned@example.com');
    const other = await submit('unassigned@example.com');
    await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${mine}/assign`, payload: { reviewerId: staffIds.reviewer } });
    const list = (await as('reviewer')({ url: '/api/admin/applicants' })).json();
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([mine]);
    expect((await as('reviewer')({ url: `/api/admin/applicants/${other}` })).statusCode).toBe(404);
    expect((await as('reviewer')({ url: `/api/admin/applicants/${mine}` })).statusCode).toBe(200);
    expect((await as('reviewer')({ method: 'POST', url: `/api/admin/applicants/${mine}/publish`, payload: { expectedStatus: 'submitted' } })).statusCode).toBe(403);
  });

  it('searches, filters and pages on the server', async () => {
    await submit('searchable.person@example.com', { fullName: 'Zainab Searchable' });
    const res = (await as('owner')({ url: '/api/admin/applicants?q=searchable&pageSize=1' })).json();
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].fullName).toBe('Zainab Searchable');
    const byRef = (await as('owner')({ url: `/api/admin/applicants?q=${res.items[0].reference}` })).json();
    expect(byRef.items[0].id).toBe(res.items[0].id);
  });

  it('only allows defined status changes, audits them, and refuses stale publication', async () => {
    const id = await submit('workflow@example.com');
    const change = (status: string) => as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/status`, payload: { status } });
    expect((await change('invited')).statusCode).toBe(400); // not from "submitted"
    expect((await change('under_review')).statusCode).toBe(200);
    expect((await change('shortlisted')).statusCode).toBe(200);
    const stale = await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/publish`, payload: { expectedStatus: 'under_review' } });
    expect(stale.statusCode).toBe(409);
    const detail = (await as('programme_admin')({ url: `/api/admin/applicants/${id}` })).json();
    expect(detail.history.map((event: { to_status: string }) => event.to_status)).toEqual(['under_review', 'shortlisted']);
    const { rows } = await ctx.db.query(`select count(*)::int as n from audit_events where action = 'application.status_changed' and target_id = $1`, [id]);
    expect(rows[0]).toEqual({ n: 2 });
  });

  it('publishes only the status the publisher saw, even when it changes at the same moment', async () => {
    const id = await submit('publish.race@example.com');
    // Another reviewer's change lands between this request's check and its update.
    const query = ctx.db.query.bind(ctx.db);
    let raced = false;
    ctx.db.query = (async (text: string, params?: unknown[]) => {
      if (!raced && text.includes('set published_status = status')) {
        raced = true;
        await query(`update applications set status = 'under_review' where id = $1`, [id]);
      }
      return query(text, params);
    }) as typeof ctx.db.query;
    const publish = await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/publish`, payload: { expectedStatus: 'submitted' } });
    ctx.db.query = query;
    expect(raced).toBe(true);
    expect(publish.statusCode).toBe(409);
    const { rows } = await ctx.db.query(`select published_status::text as published, published_at from applications where id = $1`, [id]);
    expect(rows[0]).toEqual({ published: 'submitted', published_at: null });
  });

  it('publishes a decision explicitly, with an inbox entry and a neutral push to the applicant’s device', async () => {
    const id = await submit('published@example.com');
    const applicantSession = await applicantSignIn(ctx, 'published@example.com');
    const applicant = asUser(ctx.app, applicantSession);
    await applicant({ method: 'POST', url: `/api/account/applications/${id}/claim` });
    await applicant({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { subscription: fakeSubscription(), topics: ['general', 'application'], consentVersion: NOTIFICATION_CONSENT_VERSION },
    });
    await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/status`, payload: { status: 'under_review' } });
    // Not published yet: the applicant still sees "Received".
    expect((await applicant({ url: '/api/account/applications' })).json().claimed[0].status).toBe('submitted');
    const publish = await as('programme_admin')({
      method: 'POST',
      url: `/api/admin/applicants/${id}/publish`,
      payload: { expectedStatus: 'under_review', message: 'We are reviewing applications in order.' },
    });
    expect(publish.json()).toEqual({ ok: true, notified: true });
    const claimed = (await applicant({ url: '/api/account/applications' })).json().claimed[0];
    expect(claimed).toMatchObject({ status: 'under_review', message: 'We are reviewing applications in order.' });
    const inbox = (await applicant({ url: '/api/account/inbox' })).json();
    expect(inbox.items[0]).toMatchObject({ kind: 'application_update', linkPath: '/account/application' });
    const { rows } = await ctx.db.query<{ body: string }>(
      `select m.body from notification_messages m join notification_deliveries d on d.message_id = m.id where m.origin = 'application_update'`,
    );
    expect(rows[0]!.body).toBe('There is an update to your application. Open School of Purpose to view it.');
    expect(rows[0]!.body).not.toMatch(/review|select|shortlist/i);
  });

  it('keeps notes internal and records who wrote them', async () => {
    const id = await submit('noted@example.com');
    await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/notes`, payload: { body: 'Strong purpose statement.' } });
    const detail = (await as('programme_admin')({ url: `/api/admin/applicants/${id}` })).json();
    expect(detail.notes[0]).toMatchObject({ body: 'Strong purpose statement.', author: 'Test programme_admin' });
  });

  it('answers 400, not 500, when the database refuses a value, and logs nothing of it (security audit)', async () => {
    const id = await submit('nul.note@example.com');
    const before = ctx.logs.length;
    const res = await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/notes`, payload: { body: 'Call back\u0000 tomorrow' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_REQUEST');
    expect(ctx.logs.slice(before).join('')).not.toContain('Call back');
  });

  it('exports a spreadsheet-safe CSV only with export permission, and audits it', async () => {
    await submit('csv@example.com', { fullName: '=HYPERLINK("http://evil.example","Click")' });
    expect((await as('communications')({ url: '/api/admin/applicants/export.csv' })).statusCode).toBe(403);
    const res = await as('programme_admin')({ url: '/api/admin/applicants/export.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    const [header] = parseCsv(res.body);
    expect(header!.join(',')).toMatch(/^Reference,Submitted \(WAT\),Cohort,Review status,Published status,Full name,Email,Phone,/);
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    const { rows } = await ctx.db.query(`select details from audit_events where action = 'applications.exported' order by id desc limit 1`);
    expect((rows[0] as { details: { rows: number } }).details.rows).toBeGreaterThan(0);
    // The old URL can't bypass the permission: it only redirects signed-in exporters.
    expect((await as('communications')({ url: '/api/admin/applications.csv' })).statusCode).toBe(403);
    const legacy = await as('programme_admin')({ url: '/api/admin/applications.csv' });
    expect(legacy.statusCode).toBe(303);
    expect(legacy.headers.location).toBe('/api/admin/applicants/export.csv');
  });

  it('corrects details with the form’s validation, and deletes only with the reference typed back', async () => {
    const id = await submit('typo@example.com');
    const bad = await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/correct`, payload: { phone: 'not a phone' } });
    expect(bad.json().fieldErrors).toHaveProperty('phone');
    const good = await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/correct`, payload: { city: 'Ibadan' } });
    expect(good.json()).toEqual({ ok: true, changed: ['city'] });
    const reference = (await as('programme_admin')({ url: `/api/admin/applicants/${id}` })).json().reference;
    expect((await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/delete`, payload: { confirm: 'nope' } })).statusCode).toBe(400);
    expect((await as('programme_admin')({ method: 'POST', url: `/api/admin/applicants/${id}/delete`, payload: { confirm: reference } })).statusCode).toBe(200);
    expect((await as('programme_admin')({ url: `/api/admin/applicants/${id}` })).statusCode).toBe(404);
  });
});

describe('staff management safeguards', () => {
  it('stops self-elevation, self-suspension and removing the last owner', async () => {
    const owner = as('owner');
    expect((await owner({ method: 'POST', url: `/api/admin/staff/${staffIds.owner}/role`, payload: { role: 'read_only' } })).statusCode).toBe(403);
    expect((await owner({ method: 'POST', url: `/api/admin/staff/${staffIds.owner}/suspend` })).statusCode).toBe(403);
    // A programme admin can't manage staff at all (so can't promote themselves).
    expect((await as('programme_admin')({ method: 'POST', url: `/api/admin/staff/${staffIds.programme_admin}/role`, payload: { role: 'owner' } })).statusCode).toBe(403);
    const invite = await owner({ method: 'POST', url: '/api/admin/staff', payload: { email: 'colleague@example.org', displayName: 'Colleague', role: 'reviewer' } });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().emailed).toBe(true);
    expect(invite.json().inviteUrl).toBeNull(); // emailed, so not shown
  });

  it('signs a staff member out everywhere when their role changes', async () => {
    const staff = await createStaff(ctx, { role: 'read_only' });
    const session = await staffSignIn(ctx, staff);
    await as('owner')({ method: 'POST', url: `/api/admin/staff/${staff.id}/role`, payload: { role: 'communications' } });
    expect((await asUser(ctx.app, session)({ url: '/api/admin/session' })).statusCode).toBe(401);
  });
});

describe('accounts and cohorts', () => {
  it('suspends an account: sessions end and its devices stop receiving', async () => {
    const applicant = await applicantSignIn(ctx, 'suspend.me@example.com');
    const device = await asUser(ctx.app, applicant)({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { subscription: fakeSubscription(), topics: ['general', 'application'], consentVersion: NOTIFICATION_CONSENT_VERSION },
    });
    const { rows } = await ctx.db.query<{ id: string }>(`select id from applicant_accounts where email = 'suspend.me@example.com'`);
    await as('programme_admin')({ method: 'POST', url: `/api/admin/accounts/${rows[0]!.id}/suspend` });
    expect((await asUser(ctx.app, applicant)({ url: '/api/account/me' })).statusCode).toBeGreaterThanOrEqual(401);
    // The device stops, and forgets the account (reactivating the account doesn't bring it back).
    const devices = await ctx.db.query(`select status::text as status, account_id, topics from push_subscriptions where id = $1`, [device.json().id]);
    expect(devices.rows).toEqual([{ status: 'revoked', account_id: null, topics: ['general'] }]);
  });

  it.each(['staff', 'applicant'] as const)('deletes an account (by %s) whose device had application updates, keeping the application', async (by) => {
    const email = `delete.by.${by}@example.com`;
    const id = await submit(email);
    const applicant = asUser(ctx.app, await applicantSignIn(ctx, email));
    await applicant({ method: 'POST', url: `/api/account/applications/${id}/claim` });
    await applicant({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { subscription: fakeSubscription(), topics: ['general', 'application'], consentVersion: NOTIFICATION_CONSENT_VERSION },
    });
    const { rows } = await ctx.db.query<{ id: string }>('select id from applicant_accounts where email = $1', [email]);
    const accountId = rows[0]!.id;
    const device = (await ctx.db.query<{ id: string }>('select id from push_subscriptions where account_id = $1', [accountId])).rows[0]!.id;
    const res =
      by === 'staff'
        ? await as('programme_admin')({ method: 'POST', url: `/api/admin/accounts/${accountId}/delete`, payload: { confirm: email } })
        : await applicant({ method: 'POST', url: '/api/account/delete', payload: { confirm: email } });
    expect(res.statusCode).toBe(200);
    expect((await ctx.db.query('select 1 from applicant_accounts where id = $1', [accountId])).rows).toEqual([]);
    const devices = await ctx.db.query(
      `select s.account_id, s.status::text as status, s.topics from push_subscriptions s
         join notification_consent_events e on e.subscription_id = s.id where e.account_id is null and s.deactivated_reason = 'account_deleted'`,
    );
    expect(devices.rows).toContainEqual({ account_id: null, status: 'revoked', topics: ['general'] });
    // Nothing is left that would single out the browser (security audit).
    const erased = await ctx.db.query(
      `select endpoint_enc, keys_enc, endpoint_hash = 'erased:' || id::text as hash_erased, auth_hash = 'erased:' || id::text as auth_erased, device_label
         from push_subscriptions where id = $1`,
      [device],
    );
    expect(erased.rows).toEqual([{ endpoint_enc: '', keys_enc: '', hash_erased: true, auth_erased: true, device_label: null }]);
    const application = (await as('programme_admin')({ url: `/api/admin/applicants/${id}` })).json();
    expect(application).toMatchObject({ id, account: null });
  });

  it('creates cohorts with dates entered in Lagos time', async () => {
    const res = await as('programme_admin')({
      method: 'POST',
      url: '/api/admin/cohorts',
      payload: { slug: 'called-generation-2', name: 'Second cohort', edition: 2, opensAt: '2027-01-10T09:00', closesAt: '2027-02-10T17:00', timeZone: 'Africa/Lagos' },
    });
    expect(res.statusCode).toBe(201);
    const { rows } = await ctx.db.query<{ applications_open_at: Date }>('select applications_open_at from cohorts where slug = $1', ['called-generation-2']);
    expect(new Date(rows[0]!.applications_open_at).toISOString()).toBe('2027-01-10T08:00:00.000Z');
    const clash = await as('programme_admin')({ method: 'POST', url: '/api/admin/cohorts', payload: { slug: 'called-generation-2', name: 'Again', edition: 3 } });
    expect(clash.statusCode).toBe(409);
  });
});
