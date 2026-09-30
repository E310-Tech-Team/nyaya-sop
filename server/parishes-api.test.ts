import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ParishSearchResponse } from '../src/shared/directory';
import { validPayload } from '../src/shared/test-fixtures';
import { MESSAGES } from '../src/shared/validation';
import { runDirectorySync, scheduleDirectorySync } from './directory/api-jobs';
import { syncDirectory } from './directory/api-sync';
import { API_MANAGED } from './directory/edits';
import { planImport } from './directory/plan';
import type { SourceRow } from './directory/source';
import { applyPlan, loadSnapshot } from './directory/store';
import { BASE_RELEASE, FIXTURE, fakeDirectoryApi, SECOND_RELEASE, type FakeDirectoryApi } from './directory/test-api';
import { PARISH_ERRORS } from './parishes';
import { clearSettingsCache } from './settings';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type TestContext } from './test-helpers';

const KEY = 'fake-app-key-0123456789-SECRET-KEY';
let ctx: TestContext;
let fake: FakeDirectoryApi;

beforeEach(async () => {
  fake = fakeDirectoryApi({ key: KEY, releases: [BASE_RELEASE] });
  ctx = await createTestContext(
    { DIRECTORY_API_ENV: 'sandbox', DIRECTORY_API_KEY: KEY, LOG_LEVEL: 'info' },
    { directoryFetch: (input, init) => fake.fetch(input, init) },
  );
});
afterEach(async () => {
  await ctx.close();
});

async function switchOn() {
  await ctx.db.query(
    `insert into app_settings (key, value) values ('parish_directory_enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value`,
  );
  clearSettingsCache();
}
const sync = () => syncDirectory(ctx.db, ctx.services.directory!);
const localId = async (uuid: string) => (await ctx.db.query<{ id: string }>(`select id from parishes where external_uuid = $1`, [uuid])).rows[0]!.id;
const search = async (q: string) => {
  const response = await ctx.app.inject({ url: `/api/parishes/search?q=${encodeURIComponent(q)}`, remoteAddress: nextVisitor() });
  return { status: response.statusCode, body: response.json() as ParishSearchResponse };
};
let applicant = 0;
const submit = (parish: unknown) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email: `api.applicant${++applicant}@example.org` }), parish },
  });
const listed = (id: string) => ({ kind: 'listed', id, confirmed: true });
const makeStale = () => ctx.db.query(`update directory_sync set checked_at = now() - interval '48 hours'`);
const stored = async () => (await ctx.db.query<{ n: number }>(`select count(*)::int as n from applications`)).rows[0]!.n;

describe('the parish question with the RCCG directory API', () => {
  it('offers only the API’s entries once it supplies the directory, and says how current they are', async () => {
    // The old list first, as a site that imported the spreadsheet would have it.
    const row = (parish: string): SourceRow => ({ line: 2, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish });
    await applyPlan(ctx.db, planImport([row('JESUS HOUSE')], await loadSnapshot(ctx.db)), { source: 'spreadsheet', label: 'old.xlsx', checksum: null, structureAsAt: null, via: 'cli' });
    await switchOn();
    // Configured but not synced yet: the old list isn't used, so the question waits for the sync.
    expect((await ctx.app.inject({ url: '/api/config' })).json().parishDirectory).toEqual({ enabled: false });
    expect((await search('jesus')).status).toBe(404);

    expect(await sync()).toMatchObject({ status: 'applied' });
    expect((await ctx.app.inject({ url: '/api/config' })).json().parishDirectory).toEqual({ enabled: true });
    const { status, body } = await search('jesus house');
    expect(status).toBe(200);
    // The two Jesus House parishes in Lagos Province 3 look alike (D-55): offered once, as the one
    // with the lower code, saying there are two.
    const apiIds = await Promise.all([FIXTURE.jesusLagos3A, FIXTURE.jesusLagos2, FIXTURE.jesusRivers].map(localId));
    expect(body.results.map((result) => result.id).sort()).toEqual(apiIds.sort());
    expect(body.total).toBe(3);
    // Same-named parishes in different units carry their units, so applicants can tell them apart.
    expect(body.results.map((result) => [result.chain.province?.name, result.lookalikes ?? 1]).sort()).toEqual([
      ['Lagos Province 2', 1],
      ['Lagos Province 3', 2],
      ['Rivers Province 4', 1],
    ]);
    expect(body.directory).toEqual({ source: 'api', release: 'SANDBOX.1', checkedAt: expect.any(String), stale: false });

    await makeStale();
    expect((await search('jesus house')).body.directory).toMatchObject({ stale: true });
  });

  it('accepts a parish from a copy the provider confirmed recently, keeping its code in the snapshot', async () => {
    await sync();
    await switchOn();
    fake.calls.length = 0;
    const response = await submit(listed(await localId(FIXTURE.grace)));
    expect(response.statusCode).toBe(201);
    expect(fake.calls).toEqual([]); // fresh: no call to the provider while someone waits
    const { rows } = await ctx.db.query(`select parish_status::text as status, parish_snapshot from applications where id = $1`, [response.json().id]);
    expect(rows[0]).toMatchObject({
      status: 'listed',
      parish_snapshot: { externalId: 'rccg-org:sandbox:SANDBOX-1004', province: { name: 'Lagos Province 3' }, region: { name: 'Region 54' }, continent: { name: 'Continent 3' } },
    });
  });

  it('checks the parish live when the copy is stale, and never stores one it can’t confirm', async () => {
    await sync();
    await switchOn();
    await makeStale();
    const grace = await localId(FIXTURE.grace);
    const rivers = await localId(FIXTURE.jesusRivers);

    fake.calls.length = 0;
    expect((await submit(listed(grace))).statusCode).toBe(201);
    expect(fake.calls).toEqual(['/parishes/SANDBOX-1004']);

    // The provider can't answer: nothing is stored, and the applicant is told to try again.
    fake.failures.push({ status: 503 }, { status: 503 });
    const before = await stored();
    const unavailable = await submit(listed(grace));
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' });
    expect(await stored()).toBe(before);

    // A newer release moved Grace Chapel and retired Jesus House (Rivers): ask again, and sync.
    fake.releases.push(SECOND_RELEASE);
    fake.latest = 'SANDBOX.2';
    expect((await submit(listed(grace))).json().fieldErrors).toEqual({ parishName: PARISH_ERRORS.merged });
    expect((await submit(listed(rivers))).json().fieldErrors).toEqual({ parishName: PARISH_ERRORS.inactive });
    expect((await ctx.db.query(`select count(*)::int as n from jobs where kind = 'directory.sync'`)).rows[0]).toEqual({ n: 1 });
    expect(await stored()).toBe(before);
  });

  it('refuses an answer from the old list, typed text, or no answer at all', async () => {
    const row: SourceRow = { line: 2, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish: 'GRACE CHAPEL' };
    await applyPlan(ctx.db, planImport([row], await loadSnapshot(ctx.db)), { source: 'spreadsheet', label: 'old.xlsx', checksum: null, structureAsAt: null, via: 'cli' });
    const old = (await ctx.db.query<{ id: string }>(`select id from parishes where external_id is null`)).rows[0]!.id;
    await sync();
    await switchOn();
    expect((await submit(listed(old))).json().fieldErrors).toEqual({ parishName: PARISH_ERRORS.inactive });
    for (const body of [{ parish: undefined }, { parish: null }, { parish: 'Grace Chapel' }]) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/applications',
        remoteAddress: nextVisitor(),
        payload: { ...validPayload({ email: `typed${++applicant}@example.org` }), ...body },
      });
      expect(response.json().fieldErrors).toEqual({ parishName: MESSAGES.parishRequired });
    }
  });

  it('shows staff where the directory stands, without the key, and closes it to local corrections', async () => {
    await sync();
    const owner = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'owner' })));
    const overview = await owner({ url: '/api/admin/directory/overview' });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      parishes: { active: 8 },
      latestImport: { source: 'api' },
      api: { env: 'sandbox', release: 'SANDBOX.1', releaseName: 'Sandbox base list', fresh: true, failures: 0, lastError: null, oldList: { matched: 0, ambiguous: 0, unmatched: 0 } },
    });
    const settings = await owner({ url: '/api/admin/settings' });
    expect(settings.json().directory.api).toMatchObject({ env: 'sandbox', fresh: true });
    for (const response of [overview, settings]) expect(response.body).not.toContain(KEY);

    // "Check for updates now" queues a sync for the worker; only staff who manage the directory can.
    expect((await owner({ method: 'POST', url: '/api/admin/directory/sync' })).statusCode).toBe(202);
    expect((await ctx.db.query(`select count(*)::int as n from jobs where kind = 'directory.sync'`)).rows[0]).toEqual({ n: 1 });
    const readOnly = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'read_only' })));
    expect((await readOnly({ method: 'POST', url: '/api/admin/directory/sync' })).statusCode).toBe(403);

    // Entries change at the provider, not here.
    const entry = await owner({ url: `/api/admin/directory/parishes/${await localId(FIXTURE.grace)}` });
    expect(entry.json()).toMatchObject({ apiManaged: true, parish: { externalId: 'rccg-org:sandbox:SANDBOX-1004' } });
    const rename = await owner({ method: 'PATCH', url: `/api/admin/directory/parishes/${await localId(FIXTURE.grace)}`, payload: { displayName: 'Something Else' } });
    expect(rename.statusCode).toBeGreaterThanOrEqual(400);
    expect(rename.json().message).toBe(API_MANAGED);
  });

  it('syncs from the worker on a schedule, logging figures and codes only, never the key', async () => {
    const log = { lines: [] as string[], info: (line: string) => void log.lines.push(line), warn: (line: string) => void log.lines.push(line) };
    await scheduleDirectorySync(ctx.db, ctx.services.config, new Date(), { now: true });
    await scheduleDirectorySync(ctx.db, ctx.services.config, new Date(), { now: true }); // the same slot: queued once
    expect((await ctx.db.query(`select count(*)::int as n from jobs where kind = 'directory.sync'`)).rows[0]).toEqual({ n: 1 });

    await runDirectorySync(ctx.services, log);
    fake.failures.push({ status: 401 });
    await runDirectorySync(ctx.services, log);
    expect(log.lines[0]).toMatch(/^Directory synced to release SANDBOX\.1: parishes \+8/);
    expect(log.lines[1]).toBe('Directory sync failed (api_unauthorized); the last good state stays in use');
    // Each run queues the next interval's (deduplicated).
    expect((await ctx.db.query(`select count(*)::int as n from jobs where kind = 'directory.sync'`)).rows[0]).toEqual({ n: 2 });

    // Searches and submissions write request logs: none of them carries the key, nor does anything else.
    await switchOn();
    await search('grace');
    await submit(listed(await localId(FIXTURE.grace)));
    expect([...ctx.logs, ...log.lines].join('\n')).not.toContain(KEY);
  });
});
