import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ParishDetailsResponse, ParishSearchResponse } from '../src/shared/directory';
import { validPayload } from '../src/shared/test-fixtures';
import { syncDirectory } from './directory/api-sync';
import { planImport } from './directory/plan';
import type { SourceRow } from './directory/source';
import { applyPlan, loadSnapshot } from './directory/store';
import { BASE_RELEASE, FIXTURE, fakeDirectoryApi, type FakeDirectoryApi } from './directory/test-api';
import { clearSettingsCache } from './settings';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type TestContext } from './test-helpers';

// Look-alikes (D-55): same-named parishes in one unit, which the RCCG directory API lists with
// separate codes and nothing to tell them apart. The sandbox fixture has two Jesus House parishes
// in Lagos Province 3 (SANDBOX-1002 and SANDBOX-1003).
const KEY = 'fake-lookalike-key-0123456789';
let ctx: TestContext;
let fake: FakeDirectoryApi;

async function switchOn(context: TestContext) {
  await context.db.query(
    `insert into app_settings (key, value) values ('parish_directory_enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value`,
  );
  clearSettingsCache();
}

beforeEach(async () => {
  fake = fakeDirectoryApi({ key: KEY, releases: [BASE_RELEASE] });
  ctx = await createTestContext({ DIRECTORY_API_ENV: 'sandbox', DIRECTORY_API_KEY: KEY }, { directoryFetch: (input, init) => fake.fetch(input, init) });
  expect(await syncDirectory(ctx.db, ctx.services.directory!)).toMatchObject({ status: 'applied' });
  await switchOn(ctx);
});
afterEach(async () => {
  await ctx.close();
});

const localId = async (uuid: string) => (await ctx.db.query<{ id: string }>(`select id from parishes where external_uuid = $1`, [uuid])).rows[0]!.id;
const search = async (q: string) =>
  (await ctx.app.inject({ url: `/api/parishes/search?q=${encodeURIComponent(q)}&state=Lagos`, remoteAddress: nextVisitor() })).json() as ParishSearchResponse;
const details = async (id: string) => (await ctx.app.inject({ url: `/api/parishes/${id}`, remoteAddress: nextVisitor() })).json() as ParishDetailsResponse;
let applicant = 0;
const submit = async (parish: unknown) => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email: `lookalike.applicant${++applicant}@example.org` }), parish },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
};
const stored = async (id: string) =>
  (
    await ctx.db.query<{ parish_id: string | null; parish_status: string; parish_snapshot: Record<string, unknown> | null }>(
      `select parish_id, parish_status::text as parish_status, parish_snapshot from applications where id = $1`,
      [id],
    )
  ).rows[0]!;
const reportsOf = async (id: string) =>
  (await ctx.db.query(`select kind::text as kind, parish_id, status::text as status from parish_reports where application_id = $1 order by kind`, [id])).rows;
const pair = async () => ({ first: await localId(FIXTURE.jesusLagos3A), second: await localId(FIXTURE.jesusLagos3B) });

describe('same-named parishes in one unit (look-alikes, D-55)', () => {
  it('offers a group once, as its first parish by code, saying how many it stands for', async () => {
    const { first, second } = await pair();
    const found = await search('jesus house');
    expect(found.results.filter((result) => result.chain.province?.name === 'Lagos Province 3')).toEqual([
      expect.objectContaining({ id: first, name: 'Jesus House', lookalikes: 2 }),
    ]);
    // Choices, not rows: the pair counts once.
    expect(found.total).toBe(found.results.length);
    // A parish with no look-alike carries no count.
    expect(found.results.find((result) => result.chain.province?.name === 'Lagos Province 2')).not.toHaveProperty('lookalikes');
    // Closest spellings are grouped the same way.
    const close = await search('jesuss house');
    expect(close.fuzzy).toBe(true);
    expect(close.results.filter((result) => result.chain.province?.name === 'Lagos Province 3')).toEqual([expect.objectContaining({ id: first, lookalikes: 2 })]);
    // Looking either one up (a draft's re-check) says the same.
    expect(await details(first)).toMatchObject({ status: 'active', lookalikes: 2 });
    expect(await details(second)).toMatchObject({ status: 'active', lookalikes: 2 });
    expect(await details(await localId(FIXTURE.grace))).not.toHaveProperty('lookalikes');
  });

  it('links the choice to the group’s first parish, keeps the group as the answer, and asks staff which it is', async () => {
    const { first, second } = await pair();
    // A draft may hold the other one (chosen before, or from an older list): it means the same group.
    const id = await submit({ kind: 'listed', id: second, confirmed: true });
    expect(await stored(id)).toMatchObject({ parish_id: first, parish_status: 'listed' });
    expect((await stored(id)).parish_snapshot).toMatchObject({
      parish: { id: first, name: 'Jesus House' },
      externalId: 'rccg-org:sandbox:SANDBOX-1002',
      lookalikes: [first, second],
      province: { name: 'Lagos Province 3' },
    });
    expect(await reportsOf(id)).toEqual([{ kind: 'lookalike', parish_id: first, status: 'pending' }]);

    // "Details look wrong" as well: both reports, about the same parish.
    const flagged = await submit({ kind: 'listed', id: first, confirmed: true, detailsWrong: true });
    expect(await reportsOf(flagged)).toEqual([
      { kind: 'details_wrong', parish_id: first, status: 'pending' },
      { kind: 'lookalike', parish_id: first, status: 'pending' },
    ]);

    // A parish with no look-alike raises nothing and keeps the snapshot as before.
    const single = await submit({ kind: 'listed', id: await localId(FIXTURE.grace), confirmed: true });
    expect(await reportsOf(single)).toEqual([]);
    expect((await stored(single)).parish_snapshot).not.toHaveProperty('lookalikes');
  });

  it('shows staff the candidates in Parish review, and moves the application to the one they choose', async () => {
    const { first, second } = await pair();
    const id = await submit({ kind: 'listed', id: first, confirmed: true });
    const owner = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'owner' })));

    const queue = await owner({ url: '/api/admin/parish-review?kind=lookalike' });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().counts).toMatchObject({ lookalike: 1, details_wrong: 0 });
    const [item] = queue.json().items;
    expect(item).toMatchObject({ kind: 'lookalike', parish: { id: first }, application: { id } });
    expect(item.candidates).toEqual([
      { id: first, name: 'Jesus House', code: 'SANDBOX-1002', applications: 1, linked: true },
      { id: second, name: 'Jesus House', code: 'SANDBOX-1003', applications: 0, linked: false },
    ]);
    expect((await owner({ url: '/api/admin/reports/summary' })).json().waiting).toMatchObject({ lookalike: 1 });

    const resolved = await owner({ method: 'POST', url: `/api/admin/parish-review/reports/${item.id}/resolve`, payload: { action: 'link', parishId: second } });
    expect(resolved.statusCode).toBe(200);
    expect((await stored(id)).parish_id).toBe(second);
    expect(await reportsOf(id)).toEqual([{ kind: 'lookalike', parish_id: first, status: 'linked' }]);
    // The applicant's answer stays as they gave it.
    expect((await stored(id)).parish_snapshot).toMatchObject({ parish: { id: first }, lookalikes: [first, second] });
    const detail = (await owner({ url: `/api/admin/applicants/${id}` })).json();
    expect(detail.parish.submitted).toMatchObject({ lookalikes: 2 });
    expect(detail.parish.reports).toEqual([expect.objectContaining({ kind: 'lookalike', status: 'linked' })]);
    expect((await owner({ url: '/api/admin/parish-review?kind=lookalike' })).json().counts.lookalike).toBe(0);
  });

  it('settles the report when staff keep the parish the application is already linked to', async () => {
    const { first } = await pair();
    const id = await submit({ kind: 'listed', id: first, confirmed: true });
    const owner = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'owner' })));
    const [item] = (await owner({ url: '/api/admin/parish-review?kind=lookalike' })).json().items;
    const kept = await owner({ method: 'POST', url: `/api/admin/parish-review/reports/${item.id}/resolve`, payload: { action: 'link', parishId: first } });
    expect(kept.statusCode).toBe(200);
    expect((await stored(id)).parish_id).toBe(first);
    expect(await reportsOf(id)).toEqual([{ kind: 'lookalike', parish_id: first, status: 'linked' }]);
  });

  it('never stores a “which parish?” report without its parish (migration 0012)', async () => {
    const id = await submit({ kind: 'listed', id: await localId(FIXTURE.grace), confirmed: true });
    await expect(ctx.db.query(`insert into parish_reports (application_id, kind) values ($1, 'lookalike')`, [id])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('look-alikes and the spreadsheet directory', () => {
  it('finds none: an import lists same-named rows in one unit once', async () => {
    const plain = await createTestContext();
    try {
      const row = (line: number): SourceRow => ({ line, continent: 'CONTINENT 3', region: 'REGION 54', province: 'LAGOS PROVINCE 3', parish: 'JESUS HOUSE' });
      await applyPlan(plain.db, planImport([row(2), row(3)], await loadSnapshot(plain.db)), { source: 'spreadsheet', label: 'list.xlsx', checksum: null, structureAsAt: null, via: 'cli' });
      await switchOn(plain);
      const found = (await plain.app.inject({ url: '/api/parishes/search?q=jesus', remoteAddress: nextVisitor() })).json() as ParishSearchResponse;
      expect(found.results).toHaveLength(1);
      expect(found.results[0]).not.toHaveProperty('lookalikes');
    } finally {
      await plain.close();
    }
  });
});
