import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { NOTIFICATION_CONSENT_VERSION } from '../src/shared/platform';
import { validPayload } from '../src/shared/test-fixtures';
import type { Queryable } from './db';
import { backoffMs, claimJobs, completeJob, enqueue, failJob } from './jobs/queue';
import { cleanup, scheduleMaintenance, Worker } from './jobs/worker';
import { deliverBatch, dispatchCampaign, MAX_DELIVERY_ATTEMPTS, notifyApplicationUpdate } from './notifications/dispatch';
import { applicantSignIn, asUser, createStaff, createTestContext, fakeSubscription, staffSignIn, type TestContext } from './test-helpers';

const contexts: TestContext[] = [];
afterEach(async () => {
  while (contexts.length) await contexts.pop()!.close();
});
async function context() {
  const ctx = await createTestContext();
  contexts.push(ctx);
  return ctx;
}

const quiet = { info() {}, warn() {}, error() {} };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs rounds of due jobs until none are left (retries scheduled for later stay queued). */
async function drain(worker: Worker) {
  for (let round = 0; round < 25; round++) if (!(await worker.runOnce())) return;
  throw new Error('queue did not drain');
}

const job = async (db: Queryable, id: string | null) =>
  (
    await db.query<{ status: string; attempts: number; run_at: Date; last_error: string | null; locked_by: string | null }>(
      'select status::text as status, attempts, run_at, last_error, locked_by from jobs where id = $1',
      [id],
    )
  ).rows[0]!;

describe('job queue', () => {
  it('creates a job only once per dedupe key', async () => {
    const { db } = await context();
    expect(await enqueue(db, { kind: 'test.noop', dedupeKey: 'once' })).toMatch(/^\d+$/);
    expect(await enqueue(db, { kind: 'test.noop', dedupeKey: 'once' })).toBeNull();
  });

  it('never gives one job to two workers, and leaves future jobs alone', async () => {
    const { db } = await context();
    for (let i = 0; i < 5; i++) await enqueue(db, { kind: 'test.noop' });
    await enqueue(db, { kind: 'test.noop', runAt: new Date(Date.now() + 60_000) });
    const [a, b] = await Promise.all([claimJobs(db, 'worker-a', 3, 60_000), claimJobs(db, 'worker-b', 10, 60_000)]);
    const ids = [...a, ...b].map((row) => row.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(await claimJobs(db, 'worker-c', 10, 60_000)).toEqual([]);
  });

  it('recovers a job whose worker died, and ignores the dead worker if it comes back', async () => {
    const { db } = await context();
    const id = await enqueue(db, { kind: 'test.noop' });
    await claimJobs(db, 'worker-a', 1, 1); // 1 ms lease, never renewed
    await sleep(20);
    const [again] = await claimJobs(db, 'worker-b', 1, 60_000);
    expect(again).toMatchObject({ id, attempts: 2 });
    await completeJob(db, id!, 'worker-a');
    expect((await job(db, id)).status).toBe('running');
    await completeJob(db, id!, 'worker-b');
    expect((await job(db, id)).status).toBe('succeeded');
  });

  it('retries with backoff up to the attempt limit, and fails permanent errors at once', async () => {
    const { db } = await context();
    const id = await enqueue(db, { kind: 'test.noop', maxAttempts: 2 });
    const [first] = await claimJobs(db, 'w', 1, 60_000);
    expect(await failJob(db, first!, 'w', 'boom')).toBe('retrying');
    const row = await job(db, id);
    expect(row.status).toBe('pending');
    const delay = new Date(row.run_at).getTime() - Date.now();
    expect(delay).toBeGreaterThan(20_000);
    expect(delay).toBeLessThan(40_000);
    await db.query('update jobs set run_at = now() where id = $1', [id]);
    const [second] = await claimJobs(db, 'w', 1, 60_000);
    expect(await failJob(db, second!, 'w', 'boom again')).toBe('failed');
    expect(await job(db, id)).toMatchObject({ status: 'failed', last_error: 'boom again' });

    const permanent = await enqueue(db, { kind: 'test.noop' });
    const [claimed] = await claimJobs(db, 'w', 1, 60_000);
    expect(await failJob(db, claimed!, 'w', 'bad input', { retryable: false })).toBe('failed');
    expect((await job(db, permanent)).status).toBe('failed');
  });

  it('backs off exponentially with jitter, caps the delay, and honours Retry-After', () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffMs(1)).toBeGreaterThanOrEqual(24_000);
      expect(backoffMs(1)).toBeLessThanOrEqual(36_000);
      expect(backoffMs(3)).toBeGreaterThanOrEqual(96_000);
      expect(backoffMs(3)).toBeLessThanOrEqual(144_000);
      expect(backoffMs(30)).toBeLessThanOrEqual(3_600_000 * 1.2);
    }
    expect(backoffMs(1, 600)).toBeGreaterThanOrEqual(600_000);
  });

  it('schedules the daily clean-up once, and the clean-up removes expired records', async () => {
    const { db } = await context();
    await scheduleMaintenance(db);
    await scheduleMaintenance(db);
    const { rows } = await db.query(`select count(*)::int as n from jobs where kind = 'maintenance.cleanup'`);
    expect(rows[0]).toEqual({ n: 1 });
    await db.query(
      `insert into auth_tokens (purpose, token_hash, email, created_at, expires_at)
       values ('applicant_sign_in', 'old', 'old@example.com', now() - interval '9 days', now() - interval '8 days'),
              ('applicant_sign_in', 'new', 'new@example.com', now(), now() + interval '15 minutes')`,
    );
    await cleanup(db);
    expect((await db.query('select token_hash from auth_tokens')).rows).toEqual([{ token_hash: 'new' }]);
  });
});

describe('worker', () => {
  it('runs due jobs, keeps failures for retry, and refuses unknown kinds', async () => {
    const ctx = await context();
    const worker = new Worker(ctx.services, { pollMs: 1000, log: quiet });
    let ran = 0;
    worker.handlers['test.count'] = async () => void ran++;
    worker.handlers['test.fail'] = async () => {
      throw new Error('temporary outage');
    };
    const ok = await enqueue(ctx.db, { kind: 'test.count' });
    const failing = await enqueue(ctx.db, { kind: 'test.fail' });
    const unknown = await enqueue(ctx.db, { kind: 'test.unknown' });
    await drain(worker);
    expect(ran).toBe(1);
    expect((await job(ctx.db, ok)).status).toBe('succeeded');
    expect(await job(ctx.db, failing)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'temporary outage' });
    expect((await job(ctx.db, unknown)).status).toBe('failed');
  });

  it('hands unfinished work back on shutdown without counting the attempt', async () => {
    const ctx = await context();
    const worker = new Worker(ctx.services, { pollMs: 1000, log: quiet });
    let finish: (() => void) | null = null;
    worker.handlers['test.slow'] = () => new Promise<void>((resolve) => void (finish = resolve));
    const id = await enqueue(ctx.db, { kind: 'test.slow' });
    const running = worker.runOnce();
    while (!finish) await sleep(5);
    await worker.stop(20);
    expect(await job(ctx.db, id)).toMatchObject({ status: 'pending', attempts: 0, locked_by: null });
    (finish as () => void)();
    await running;
    expect((await job(ctx.db, id)).status).toBe('pending'); // the stopped worker can't mark it done
  });
});

// ── Campaigns end to end (fake push transport; nothing leaves the process) ──────

async function scenario() {
  const ctx = await context();
  const staff = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'communications' })));
  const subscribe = (session: ReturnType<typeof asUser>, subscription: object, topics: string[]) =>
    session({ method: 'POST', url: '/api/push/subscribe', payload: { subscription, topics, consentVersion: NOTIFICATION_CONSENT_VERSION } });

  // An applicant with a claimed application and a phone that wants announcements and application updates.
  const submitted = await ctx.app.inject({ method: 'POST', url: '/api/applications', payload: validPayload({ email: 'reach@example.com' }) });
  const applicationId = submitted.json().id as string;
  const applicant = asUser(ctx.app, await applicantSignIn(ctx, 'reach@example.com'));
  await applicant({ method: 'POST', url: `/api/account/applications/${applicationId}/claim` });
  const applicantDevice = fakeSubscription();
  await subscribe(applicant, applicantDevice, ['general', 'application']);
  // Someone without an account who only wants announcements.
  const publicDevice = fakeSubscription('updates.push.services.mozilla.com');
  await subscribe(asUser(ctx.app, null), publicDevice, ['general']);
  // The communications officer's own test device.
  const testDevice = fakeSubscription('web.push.apple.com');
  expect((await staff({ method: 'POST', url: '/api/admin/test-devices', payload: { subscription: testDevice } })).statusCode).toBe(201);

  const { rows } = await ctx.db.query<{ cohort_id: string; account_id: string }>('select cohort_id, account_id from applications where id = $1', [
    applicationId,
  ]);
  const worker = new Worker(ctx.services, { pollMs: 1000, log: quiet });
  return { ctx, staff, applicant, applicationId, accountId: rows[0]!.account_id, cohortId: rows[0]!.cohort_id, applicantDevice, publicDevice, testDevice, worker };
}
type Scenario = Awaited<ReturnType<typeof scenario>>;
type Caller = (options: InjectOptions) => Promise<LightMyRequestResponse>;

let keys = 0;
async function createCampaign(staff: Caller, overrides: Record<string, unknown> = {}) {
  const res = await staff({
    method: 'POST',
    url: '/api/admin/campaigns',
    payload: {
      idempotencyKey: `test-campaign-${++keys}`,
      title: 'Boot camp dates',
      body: 'The dates for Purpose Boot Camp are now on the website.',
      linkPath: '/programme',
      topic: 'general',
      ttlHours: 24,
      alsoInbox: false,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/** Schedules for now, confirming the numbers the editor showed. */
async function sendNow(staff: Caller, id: string) {
  const { campaign, audience } = (await staff({ url: `/api/admin/campaigns/${id}` })).json();
  return staff({
    method: 'POST',
    url: `/api/admin/campaigns/${id}/schedule`,
    payload: { when: 'now', confirmDevices: audience.devices, confirmInbox: campaign.alsoInbox ? audience.inboxAccounts : 0 },
  });
}

const stats = async (s: Scenario, id: string) => (await s.staff({ url: `/api/admin/campaigns/${id}` })).json();
const sentTo = (s: Scenario) => s.ctx.push.sent.map((request) => request.endpoint).sort();

describe('campaigns', () => {
  it('previews reach with devices and people counted separately, never counting staff test devices', async () => {
    const s = await scenario();
    const preview = async (body: object) => (await s.staff({ method: 'POST', url: '/api/admin/campaigns/audience-preview', payload: body })).json();
    expect(await preview({ topic: 'general' })).toEqual({ devices: 2, linkedDevices: 1, anonymousDevices: 1, accountsWithDevices: 1, inboxAccounts: 1 });
    expect((await preview({ topic: 'application' })).devices).toBe(1);
    expect((await preview({ topic: 'training' })).devices).toBe(0);
    // Cohort and status filters only reach people with an account.
    expect(await preview({ topic: 'general', audience: { cohortIds: [s.cohortId] } })).toMatchObject({ devices: 1, anonymousDevices: 0, inboxAccounts: 1 });
    expect(await preview({ topic: 'general', audience: { publishedStatuses: ['invited'] } })).toMatchObject({ devices: 0, inboxAccounts: 0 });
  });

  it('creates idempotently, and freezes content once scheduled', async () => {
    const s = await scenario();
    const body = { idempotencyKey: 'double-click-key', title: 'Hello', body: 'Welcome to the programme.', linkPath: '/', topic: 'general' };
    const first = await s.staff({ method: 'POST', url: '/api/admin/campaigns', payload: body });
    const retry = await s.staff({ method: 'POST', url: '/api/admin/campaigns', payload: body });
    expect(first.statusCode).toBe(201);
    expect(retry.json()).toEqual({ id: first.json().id, duplicate: true });
    await sendNow(s.staff, first.json().id);
    const edit = await s.staff({ method: 'PATCH', url: `/api/admin/campaigns/${first.json().id}`, payload: { ...body, title: 'Changed' } });
    expect(edit.statusCode).toBe(409);
  });

  it('refuses links outside the allowlist and over-long text', async () => {
    const s = await scenario();
    const bad = await s.staff({
      method: 'POST',
      url: '/api/admin/campaigns',
      payload: { idempotencyKey: 'bad-campaign-1', title: 'x'.repeat(66), body: 'Hi', linkPath: 'https://evil.example', topic: 'general' },
    });
    expect(Object.keys(bad.json().fieldErrors).sort()).toEqual(['linkPath', 'title']);
  });

  it('asks again when the audience changed since the sender saw it', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff);
    const stale = await s.staff({ method: 'POST', url: `/api/admin/campaigns/${id}/schedule`, payload: { when: 'now', confirmDevices: 1, confirmInbox: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().audience.devices).toBe(2);
    expect((await sendNow(s.staff, id)).statusCode).toBe(200);
  });

  it('sends once to each eligible device, even if dispatch runs more than once, and reports what happened', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff, { alsoInbox: true });
    expect((await sendNow(s.staff, id)).statusCode).toBe(200);
    // A crashed worker's retry, or a duplicate job, must not double-send.
    await dispatchCampaign(s.ctx.services, id);
    await dispatchCampaign(s.ctx.services, id);
    await drain(s.worker);
    expect(sentTo(s)).toEqual([s.applicantDevice.endpoint, s.publicDevice.endpoint].sort());
    const detail = await stats(s, id);
    expect(detail.campaign.status).toBe('sent');
    expect(detail.stats).toEqual({
      devices: 2,
      queued: 0,
      attempted: 2,
      acceptedByPushService: 2,
      failed: 0,
      expired: 0,
      skipped: 0,
      inboxEntries: 1,
      recordedClicks: 0,
    });
    const inbox = (await s.applicant({ url: '/api/account/inbox' })).json().items;
    expect(inbox[0]).toMatchObject({ kind: 'message', title: 'Boot camp dates', linkPath: '/programme' });
  });

  it('re-checks consent and account status right before sending', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff);
    await sendNow(s.staff, id);
    await s.worker.runOnce(); // dispatch: deliveries created, nothing sent yet
    expect(s.ctx.push.sent).toHaveLength(0);
    await asUser(s.ctx.app, null)({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: s.publicDevice.endpoint, auth: s.publicDevice.keys.auth } });
    await s.ctx.db.query(`update applicant_accounts set status = 'suspended', suspended_at = now() where id = $1`, [s.accountId]);
    await drain(s.worker);
    expect(s.ctx.push.sent).toHaveLength(0);
    expect((await stats(s, id)).stats).toMatchObject({ devices: 2, skipped: 2, acceptedByPushService: 0 });
  });

  it('turns off devices the push service says are gone, and retries rate-limited ones later', async () => {
    const s = await scenario();
    s.ctx.push.respond = (request) =>
      request.endpoint === s.publicDevice.endpoint ? { status: 410, retryAfterSeconds: null } : { status: 429, retryAfterSeconds: 120 };
    const id = await createCampaign(s.staff);
    await sendNow(s.staff, id);
    await drain(s.worker);
    const { rows: gone } = await s.ctx.db.query(`select status::text as status, deactivated_reason from push_subscriptions where push_host like '%mozilla%'`);
    expect(gone).toEqual([{ status: 'expired', deactivated_reason: 'expired' }]);
    expect((await stats(s, id)).campaign.status).toBe('sending');
    const { rows: retry } = await s.ctx.db.query<{ run_at: Date }>(`select run_at from jobs where kind = 'push.deliver' and status = 'pending'`);
    expect(retry).toHaveLength(1);
    expect(new Date(retry[0]!.run_at).getTime() - Date.now()).toBeGreaterThan(115_000); // honours Retry-After: 120

    s.ctx.push.respond = () => ({ status: 201, retryAfterSeconds: null });
    await s.ctx.db.query(`update jobs set run_at = now() where kind = 'push.deliver' and status = 'pending'`);
    await drain(s.worker);
    const done = await stats(s, id);
    expect(done.campaign.status).toBe('sent');
    expect(done.stats).toMatchObject({ acceptedByPushService: 1, failed: 1, attempted: 2 });
  });

  it('gives up after the last attempt and says so', async () => {
    const s = await scenario();
    s.ctx.push.respond = () => ({ status: 503, retryAfterSeconds: null });
    const id = await createCampaign(s.staff);
    await sendNow(s.staff, id);
    await drain(s.worker);
    for (let attempt = 2; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      await s.ctx.db.query(`update jobs set run_at = now() where kind = 'push.deliver' and status = 'pending'`);
      await drain(s.worker);
    }
    expect(s.ctx.push.sent).toHaveLength(2 * MAX_DELIVERY_ATTEMPTS);
    const { rows } = await s.ctx.db.query(`select distinct status::text as status, last_error from notification_deliveries`);
    expect(rows).toEqual([{ status: 'failed', last_error: 'retries_exhausted' }]);
    expect((await stats(s, id)).campaign.status).toBe('sent');
  });

  it('lets a message expire rather than arrive late', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff, { ttlHours: 1 });
    await sendNow(s.staff, id);
    await s.worker.runOnce();
    await s.ctx.db.query(`update notification_messages set expires_at = now() - interval '1 second' where campaign_id = $1`, [id]);
    await drain(s.worker);
    expect(s.ctx.push.sent).toHaveLength(0);
    expect((await stats(s, id)).stats).toMatchObject({ expired: 2, acceptedByPushService: 0 });
  });

  it('cancels a scheduled campaign before it goes out, and stops one that is sending', async () => {
    const s = await scenario();
    const later = await createCampaign(s.staff);
    const { audience } = (await s.staff({ url: `/api/admin/campaigns/${later}` })).json();
    const inTwoHours = new Date(Date.now() + 2 * 3600_000 + 3600_000).toISOString().slice(0, 16); // Lagos is UTC+1
    const scheduled = await s.staff({
      method: 'POST',
      url: `/api/admin/campaigns/${later}/schedule`,
      payload: { when: 'later', localTime: inTwoHours, timeZone: 'Africa/Lagos', confirmDevices: audience.devices, confirmInbox: 0 },
    });
    expect(scheduled.statusCode).toBe(200);
    expect((await s.staff({ method: 'POST', url: `/api/admin/campaigns/${later}/cancel` })).statusCode).toBe(200);
    await s.ctx.db.query(`update jobs set run_at = now()`); // even if it were due…
    await drain(s.worker);
    expect(s.ctx.push.sent).toHaveLength(0); // …nothing goes out

    const sending = await createCampaign(s.staff);
    await sendNow(s.staff, sending);
    await s.worker.runOnce(); // dispatched, not yet delivered
    await s.staff({ method: 'POST', url: `/api/admin/campaigns/${sending}/cancel` });
    await drain(s.worker);
    expect(s.ctx.push.sent).toHaveLength(0);
    expect((await stats(s, sending)).stats).toMatchObject({ skipped: 2, acceptedByPushService: 0 });
  });

  it('does not send a batch whose campaign was cancelled after the batch was queued', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff);
    await sendNow(s.staff, id);
    await s.worker.runOnce();
    const { rows } = await s.ctx.db.query<{ message_id: string; id: string }>(
      `select d.message_id, d.id from notification_deliveries d join notification_messages m on m.id = d.message_id where m.campaign_id = $1`,
      [id],
    );
    // A cancellation that landed while the batch was already claimed by a worker.
    await s.ctx.db.query(`update campaigns set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
    await deliverBatch(s.ctx.services, { messageId: rows[0]!.message_id, deliveryIds: rows.map((row) => row.id), attempt: 1 });
    expect(s.ctx.push.sent).toHaveLength(0);
  });

  it('schedules in the chosen time zone and stores UTC', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff);
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const schedule = (localTime: string, timeZone = 'Africa/Lagos') =>
      s.staff({ method: 'POST', url: `/api/admin/campaigns/${id}/schedule`, payload: { when: 'later', localTime, timeZone, confirmDevices: 2, confirmInbox: 0 } });
    expect((await schedule('2020-01-01T09:00')).statusCode).toBe(400); // in the past
    expect((await schedule(new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 16))).statusCode).toBe(400); // too far ahead
    const res = await schedule(`${day}T09:00`);
    expect(res.json()).toEqual({ ok: true, scheduledFor: `${day}T08:00:00.000Z` });
    const { rows } = await s.ctx.db.query<{ run_at: Date }>(`select run_at from jobs where kind = 'campaign.dispatch'`);
    expect(new Date(rows[0]!.run_at).toISOString()).toBe(`${day}T08:00:00.000Z`);
    await drain(s.worker);
    expect(s.ctx.push.sent).toHaveLength(0); // not due yet
  });

  it('sends test messages only to the sender’s own test devices', async () => {
    const s = await scenario();
    const id = await createCampaign(s.staff);
    expect((await s.staff({ method: 'POST', url: `/api/admin/campaigns/${id}/test` })).json()).toEqual({ devices: 1 });
    await drain(s.worker);
    expect(sentTo(s)).toEqual([s.testDevice.endpoint]);
    const colleague = asUser(s.ctx.app, await staffSignIn(s.ctx, await createStaff(s.ctx, { role: 'communications' })));
    expect((await colleague({ method: 'POST', url: `/api/admin/campaigns/${id}/test` })).statusCode).toBe(400);
    expect((await stats(s, id)).campaign.status).toBe('draft');
  });

  it('sends a published application update only to that applicant’s devices, marked urgent', async () => {
    const s = await scenario();
    await notifyApplicationUpdate(s.ctx.services, s.applicationId, s.accountId);
    await drain(s.worker);
    expect(sentTo(s)).toEqual([s.applicantDevice.endpoint]);
    expect(s.ctx.push.sent[0]!.headers.Urgency).toBe('high');
  });
});
