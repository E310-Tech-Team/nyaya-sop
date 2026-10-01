import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ParishSearchResponse, UnitDetails, UnitSearchResponse } from '../src/shared/directory';
import { validPayload } from '../src/shared/test-fixtures';
import { MESSAGES } from '../src/shared/validation';
import { syncDirectory } from './directory/api-sync';
import { planImport } from './directory/plan';
import type { SourceRow } from './directory/source';
import { applyPlan, loadSnapshot } from './directory/store';
import { BASE_RELEASE, FIXTURE, fakeDirectoryApi, type FakeDirectoryApi, type FakeRelease } from './directory/test-api';
import { PARISH_ERRORS } from './parishes';
import { clearSettingsCache } from './settings';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type TestContext } from './test-helpers';

// The parish question in two steps (D-59): the province first (or the region or continent some
// parishes sit directly under), then a parish in it. The sandbox fixture: Lagos Province 3 (Jesus
// House twice, Grace Chapel, House of Prayer), Lagos Province 2 (Jesus House), Rivers Province 4
// (Jesus House), Region 14 (Abundance Mega, in no province) and Continent 2 (RCCG Central Parish,
// in no region). This release adds a big province, an empty one, one in another state, and zones
// (the API's contract has them; release 2026.1 doesn't use them yet).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLACES = {
  ogun9: id(709),
  oyo1: id(601),
  fountain: id(2001),
  zion: (n: number) => id(3000 + n),
  oyoZone: id(611),
  glory: id(2002),
  regionZone: id(141),
  assembly: id(2003),
};
const PLACES_RELEASE: FakeRelease = {
  id: id(9101),
  versionCode: 'SANDBOX.1-PLACES',
  name: 'Sandbox places',
  base: 'SANDBOX.1',
  effectiveFrom: '2026-08-20T23:00:00Z',
  changes: [
    { type: 'created', id: PLACES.ogun9, code: 'PLACES-P709', level: 'province', name: 'OGUN PROVINCE 9', parentId: FIXTURE.region19 },
    { type: 'created', id: PLACES.oyo1, code: 'PLACES-P601', level: 'province', name: 'OYO PROVINCE 1', parentId: FIXTURE.region5 },
    { type: 'created', id: PLACES.fountain, code: 'PLACES-2001', level: 'parish', name: 'FOUNTAIN OF LIFE', parentId: PLACES.oyo1 },
    // A zone in a province: its parishes are the province's.
    { type: 'created', id: PLACES.oyoZone, code: 'PLACES-Z611', level: 'zone', name: 'ZONE 1', parentId: PLACES.oyo1 },
    { type: 'created', id: PLACES.glory, code: 'PLACES-2002', level: 'parish', name: 'GLORY CHAPEL', parentId: PLACES.oyoZone },
    // A zone directly under a region: its parishes are in no province, so they're the region's.
    { type: 'created', id: PLACES.regionZone, code: 'PLACES-Z141', level: 'zone', name: 'ZONE 9', parentId: FIXTURE.region14 },
    { type: 'created', id: PLACES.assembly, code: 'PLACES-2003', level: 'parish', name: 'ZION ASSEMBLY', parentId: PLACES.regionZone },
    ...Array.from({ length: 23 }, (_, index): FakeRelease['changes'][number] => ({
      type: 'created',
      id: PLACES.zion(index + 1),
      code: `PLACES-${3001 + index}`,
      level: 'parish',
      name: `MOUNT ZION ${index + 1}`,
      parentId: FIXTURE.lagos2,
    })),
  ],
};
/** Retires Rivers Province 4 with its parish. */
const RETIRE_RELEASE: FakeRelease = {
  id: id(9102),
  versionCode: 'SANDBOX.1-RETIRE',
  name: 'Sandbox retirement',
  base: 'SANDBOX.1-PLACES',
  effectiveFrom: '2026-08-25T23:00:00Z',
  changes: [
    { type: 'retired', id: FIXTURE.jesusRivers },
    { type: 'retired', id: FIXTURE.rivers4 },
  ],
};

const KEY = 'fake-places-key-0123456789';
let ctx: TestContext;
let fake: FakeDirectoryApi;

async function setDirectory(context: TestContext, on: boolean) {
  await context.db.query(
    `insert into app_settings (key, value) values ('parish_directory_enabled', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(on)],
  );
  clearSettingsCache();
}

beforeEach(async () => {
  fake = fakeDirectoryApi({ key: KEY, releases: [BASE_RELEASE, PLACES_RELEASE] });
  ctx = await createTestContext({ DIRECTORY_API_ENV: 'sandbox', DIRECTORY_API_KEY: KEY }, { directoryFetch: (input, init) => fake.fetch(input, init) });
  // The old list first, as a site that imported the spreadsheet would have it: never offered once the API supplies the directory.
  const row: SourceRow = { line: 2, continent: 'CONTINENT 9', region: 'REGION 99', province: 'OGUN PROVINCE 7', parish: 'MERCY SEAT' };
  await applyPlan(ctx.db, planImport([row], await loadSnapshot(ctx.db)), { source: 'spreadsheet', label: 'old.xlsx', checksum: null, structureAsAt: null, via: 'cli' });
  expect(await syncDirectory(ctx.db, ctx.services.directory!)).toMatchObject({ status: 'applied', release: 'SANDBOX.1-PLACES' });
  await setDirectory(ctx, true);
});
afterEach(async () => {
  await ctx.close();
});

const unitId = async (uuid: string) => (await ctx.db.query<{ id: string }>(`select id from church_units where external_uuid = $1`, [uuid])).rows[0]!.id;
const parishId = async (uuid: string) => (await ctx.db.query<{ id: string }>(`select id from parishes where external_uuid = $1`, [uuid])).rows[0]!.id;
const oldListUnit = async () => (await ctx.db.query<{ id: string }>(`select id from church_units where external_id is null and level = 'province'`)).rows[0]!.id;
const get = (url: string) => ctx.app.inject({ url, remoteAddress: nextVisitor() });
const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]]))).toString();
const units = async (q: string, state?: string, page: { limit?: number; offset?: number } = {}) => {
  const response = await get(`/api/parishes/units?${query({ q, state, ...page })}`);
  expect(response.statusCode).toBe(200);
  return response.json() as UnitSearchResponse;
};
const inUnit = async (unit: string, q: string, page: { limit?: number; offset?: number } = {}) => {
  const response = await get(`/api/parishes/search?${query({ unit, q, ...page })}`);
  expect(response.statusCode).toBe(200);
  return response.json() as ParishSearchResponse;
};
const names = (found: { results: { name: string }[] }) => found.results.map((result) => result.name);

let applicant = 0;
const submit = (parish: unknown) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email: `places.applicant${++applicant}@example.org` }), parish },
  });
const stored = async (applicationId: string) =>
  (
    await ctx.db.query<{
      parish_id: string | null;
      parish_status: string;
      parish_name: string | null;
      parish_snapshot: Record<string, unknown> | null;
      parish_place_snapshot: Record<string, unknown> | null;
    }>(
      `select parish_id, parish_status::text as parish_status, parish_name, parish_snapshot, parish_place_snapshot from applications where id = $1`,
      [applicationId],
    )
  ).rows[0]!;
const applications = async () => (await ctx.db.query<{ n: number }>(`select count(*)::int as n from applications`)).rows[0]!.n;
const makeStale = () => ctx.db.query(`update directory_sync set checked_at = now() - interval '48 hours'`);

describe('step 1: finding a province (GET /api/parishes/units)', () => {
  it('finds provinces by name and number, the applicant’s own words and state first', async () => {
    // "Lagos 3" is Lagos Province 3 first; Lagos Province 2 is in Continent 3, so it matches too, after it.
    expect(names(await units('lagos 3', 'Lagos'))).toEqual(['Lagos Province 3', 'Lagos Province 2']);
    // The number alone: that province first, then those its region or continent matched.
    expect(names(await units('3', 'Lagos'))[0]).toBe('Lagos Province 3');
    // "LP 3" is how many write it.
    expect(names(await units('LP 3', 'Lagos'))[0]).toBe('Lagos Province 3');
    // The applicant's state first, then names with their numbers in order.
    expect(names(await units('province', 'Oyo'))).toEqual(['Oyo Province 1', 'Lagos Province 2', 'Lagos Province 3', 'Rivers Province 4']);
    const lagos = await units('province', 'Lagos');
    expect(names(lagos)).toEqual(['Lagos Province 2', 'Lagos Province 3', 'Oyo Province 1', 'Rivers Province 4']);
    expect(lagos.results.map((result) => result.inState)).toEqual([true, true, false, false]);
    expect(lagos.total).toBe(4);
    // Each says where it is, and how many parishes step 2 will list (look-alikes once).
    expect(lagos.results[1]).toEqual({
      id: await unitId(FIXTURE.lagos3),
      level: 'province',
      name: 'Lagos Province 3',
      chain: {
        continent: { id: await unitId(FIXTURE.continent3), name: 'Continent 3' },
        region: { id: await unitId(FIXTURE.region54), name: 'Region 54' },
        province: { id: await unitId(FIXTURE.lagos3), name: 'Lagos Province 3' },
        zone: null,
        area: null,
      },
      parishes: 3,
      inState: true,
    });
    expect(lagos.directory).toMatchObject({ source: 'api', release: 'SANDBOX.1-PLACES', stale: false });
  });

  it('offers the regions and continents some parishes sit directly under, but no unit without parishes of its own', async () => {
    const region = await units('region 14');
    // Abundance Mega, and Zion Assembly in a zone directly under the region.
    expect(region.results).toEqual([
      expect.objectContaining({ level: 'region', name: 'Region 14', parishes: 2, chain: expect.objectContaining({ continent: expect.objectContaining({ name: 'Continent 3' }), province: null }) }),
    ]);
    // A province counts the parishes in its zones; zones are never offered themselves.
    expect((await units('oyo')).results).toEqual([expect.objectContaining({ name: 'Oyo Province 1', parishes: 2 })]);
    expect(await units('zone')).toMatchObject({ results: [], total: 0 });
    // Every typed word in its own name puts it first (Lagos Province 2 matches too: "2", in Continent 3).
    expect((await units('continent 2')).results[0]).toEqual(expect.objectContaining({ level: 'continent', name: 'Continent 2', parishes: 1 }));
    // Region 54 has provinces but no parishes of its own: its provinces are offered, not the region.
    expect(names(await units('region 54'))).toEqual(['Lagos Province 3']);
    // Ogun Province 9 is empty; Ogun Province 7 is the old list's.
    expect(await units('ogun')).toMatchObject({ results: [], total: 0 });
  });

  it('pages through the matches, still counting them all', async () => {
    expect(await units('province', 'Lagos', { limit: 2, offset: 2 })).toMatchObject({ total: 4, results: [{ name: 'Oyo Province 1' }, { name: 'Rivers Province 4' }] });
    expect(await units('province', 'Lagos', { offset: 40 })).toMatchObject({ total: 4, results: [] });
    // At most a page at a time, whatever is asked for.
    const page = await get(`/api/parishes/units?q=province&limit=500`);
    expect((page.json() as UnitSearchResponse).results).toHaveLength(4);
  });

  it('leaves out retired units, and refuses an empty search or one while the list is off', async () => {
    fake.releases.push(RETIRE_RELEASE);
    fake.latest = 'SANDBOX.1-RETIRE';
    expect(await syncDirectory(ctx.db, ctx.services.directory!)).toMatchObject({ status: 'applied' });
    expect(await units('rivers')).toMatchObject({ results: [], total: 0 });

    for (const q of ['', '   ', 'x'.repeat(61)]) expect((await get(`/api/parishes/units?${query({ q })}`)).statusCode).toBe(400);
    expect((await get('/api/parishes/units')).statusCode).toBe(400);
    await setDirectory(ctx, false);
    expect((await get('/api/parishes/units?q=lagos')).statusCode).toBe(404);
  });

  it('looks a saved province up by its ID, for a draft’s re-check', async () => {
    const lagos3 = await unitId(FIXTURE.lagos3);
    const found = await get(`/api/parishes/units/${lagos3}`);
    expect(found.statusCode).toBe(200);
    expect(found.json() as UnitDetails).toEqual({
      id: lagos3,
      level: 'province',
      name: 'Lagos Province 3',
      chain: expect.objectContaining({ region: { id: await unitId(FIXTURE.region54), name: 'Region 54' } }),
      parishes: 3,
    });
    // Never the RCCG code.
    expect(found.body).not.toContain('SANDBOX-P403');
    for (const gone of [id(999_999), 'lagos', await unitId(FIXTURE.region54), await unitId(PLACES.ogun9), await unitId(PLACES.oyoZone), await oldListUnit()]) {
      expect((await get(`/api/parishes/units/${gone}`)).statusCode).toBe(404);
    }
  });
});

describe('step 2: a province’s parishes (GET /api/parishes/search?unit=)', () => {
  it('lists only the parishes directly in that unit, look-alikes once, filtered by what is typed', async () => {
    const lagos3 = await unitId(FIXTURE.lagos3);
    const all = await inUnit(lagos3, '');
    expect(all).toMatchObject({ total: 3, fuzzy: false });
    expect(all.results).toEqual([
      expect.objectContaining({ id: await parishId(FIXTURE.grace), name: 'Grace Chapel' }),
      expect.objectContaining({ id: await parishId(FIXTURE.prayer), name: 'House of Prayer' }),
      expect.objectContaining({ id: await parishId(FIXTURE.jesusLagos3A), name: 'Jesus House', lookalikes: 2 }),
    ]);
    expect(all.results.every((result) => result.chain.province?.name === 'Lagos Province 3')).toBe(true);
    // Jesus House in Lagos Province 2 and Rivers Province 4 aren't this province's.
    expect(await inUnit(lagos3, 'jesus')).toMatchObject({ total: 1, results: [{ name: 'Jesus House', lookalikes: 2 }] });
    expect(names(await inUnit(lagos3, 'house'))).toEqual(['House of Prayer', 'Jesus House']);
    // Closest spellings stay inside the unit too.
    const close = await inUnit(await unitId(FIXTURE.lagos2), 'jesuss house');
    expect(close.fuzzy).toBe(true);
    expect(close.results).toEqual([expect.objectContaining({ id: await parishId(FIXTURE.jesusLagos2) })]);
    // A province's parishes include those in its zones.
    const oyo = await inUnit(await unitId(PLACES.oyo1), '');
    expect(names(oyo)).toEqual(['Fountain of Life', 'Glory Chapel']);
    expect(oyo.results[1]!.chain).toMatchObject({ province: { name: 'Oyo Province 1' }, zone: { name: 'Zone 1' } });
    // A region's or continent's parishes in no province (or region) below it.
    expect(names(await inUnit(await unitId(FIXTURE.region14), ''))).toEqual(['Abundance Mega', 'Zion Assembly']);
    expect((await inUnit(await unitId(FIXTURE.continent2), '')).results).toEqual([expect.objectContaining({ id: await parishId(FIXTURE.central) })]);
  });

  it('pages through a big province twenty at a time, with names in number order and a total that adds up', async () => {
    const lagos2 = await unitId(FIXTURE.lagos2);
    const first = await inUnit(lagos2, '');
    expect(first.total).toBe(24);
    expect(names(first)).toEqual(['Jesus House', ...Array.from({ length: 19 }, (_, index) => `Mount Zion ${index + 1}`)]);
    const second = await inUnit(lagos2, '', { offset: 20 });
    expect(second).toMatchObject({ total: 24, fuzzy: false });
    expect(names(second)).toEqual(['Mount Zion 20', 'Mount Zion 21', 'Mount Zion 22', 'Mount Zion 23']);
    // Past the end: empty, never a guess at spellings, and still the whole count.
    expect(await inUnit(lagos2, '', { offset: 40 })).toEqual({ results: [], total: 24, fuzzy: false, directory: expect.any(Object) });
    // Typed and paged.
    expect(await inUnit(lagos2, 'zion', { limit: 5, offset: 20 })).toMatchObject({ total: 23, results: [{ name: 'Mount Zion 21' }, { name: 'Mount Zion 22' }, { name: 'Mount Zion 23' }] });
    // At most twenty at a time.
    expect((await inUnit(lagos2, '', { limit: 50 })).results).toHaveLength(20);
  });

  it('answers 404 for a unit that isn’t a place to choose from', async () => {
    fake.releases.push(RETIRE_RELEASE);
    fake.latest = 'SANDBOX.1-RETIRE';
    await syncDirectory(ctx.db, ctx.services.directory!);
    for (const unit of [
      id(999_999), // unknown
      'lagos',
      await unitId(FIXTURE.rivers4), // retired
      await unitId(FIXTURE.region54), // no parishes of its own
      await unitId(PLACES.ogun9), // empty
      await oldListUnit(), // the old list's
    ]) {
      expect((await get(`/api/parishes/search?${query({ unit, q: '' })}`)).statusCode).toBe(404);
    }
    // Without a unit, the search everywhere is as before: two characters at least.
    expect((await get('/api/parishes/search?q=j')).statusCode).toBe(400);
    expect((await get('/api/parishes/search?q=jesus')).json()).toMatchObject({ total: 2 });
  });
});

describe('“I can’t find my parish” after choosing a province (D-59)', () => {
  it('keeps the province with the answer, as the directory names it, and reports the name for staff', async () => {
    const lagos3 = await unitId(FIXTURE.lagos3);
    // Names the browser might send are never used: only the unit's ID counts.
    const response = await submit({ kind: 'not_listed', name: ' Mercy  Seat ', unitId: lagos3.toUpperCase(), unitName: 'Lagos Province 99', chain: { province: 'Fake' } });
    expect(response.statusCode).toBe(201);
    const row = await stored(response.json().id);
    // No parish was chosen, so no parish snapshot: the province has its own (migration 0014).
    expect(row).toMatchObject({ parish_id: null, parish_status: 'reported', parish_name: 'Mercy Seat', parish_snapshot: null });
    expect(row.parish_place_snapshot).toEqual({
      unit: { id: lagos3, name: 'Lagos Province 3', level: 'province' },
      importId: expect.any(String),
      externalId: 'rccg-org:sandbox:SANDBOX-P403',
      continent: { id: await unitId(FIXTURE.continent3), name: 'Continent 3' },
      region: { id: await unitId(FIXTURE.region54), name: 'Region 54' },
      province: { id: lagos3, name: 'Lagos Province 3' },
      zone: null,
      area: null,
    });
    const reports = await ctx.db.query(`select kind::text as kind, parish_id, status::text as status from parish_reports where application_id = $1`, [response.json().id]);
    expect(reports.rows).toEqual([{ kind: 'not_listed', parish_id: null, status: 'pending' }]);

    // A region's own parishes: the region, and no province.
    const inRegion = await submit({ kind: 'not_listed', name: 'Mercy Seat', unitId: await unitId(FIXTURE.region14) });
    expect((await stored(inRegion.json().id)).parish_place_snapshot).toMatchObject({ unit: { name: 'Region 14', level: 'region' }, province: null, region: { name: 'Region 14' } });
    // Without a province ("I don't know my province"): as before.
    const anywhere = await submit({ kind: 'not_listed', name: 'Mercy Seat' });
    expect(await stored(anywhere.json().id)).toMatchObject({ parish_status: 'reported', parish_snapshot: null, parish_place_snapshot: null });
  });

  it('refuses a province that isn’t a place to choose from, storing nothing', async () => {
    const before = await applications();
    const refused = async (unitIdValue: unknown) => {
      const response = await submit({ kind: 'not_listed', name: 'Mercy Seat', unitId: unitIdValue });
      expect(response.statusCode).toBe(400);
      return response.json().fieldErrors;
    };
    expect(await refused('lagos')).toEqual({ parishName: MESSAGES.parishUnitInvalid });
    expect(await refused(42)).toEqual({ parishName: MESSAGES.parishUnitInvalid });
    for (const unit of [id(999_999), await unitId(FIXTURE.region54), await unitId(PLACES.ogun9), await oldListUnit()]) {
      expect(await refused(unit)).toEqual({ parishName: PARISH_ERRORS.placeGone });
    }
    expect(await applications()).toBe(before);
  });

  it('leaves listed answers as they were, the stale-copy check included', async () => {
    const grace = await parishId(FIXTURE.grace);
    // A stray unit on a listed answer is ignored: the parish's own chain is stored.
    const listed = await submit({ kind: 'listed', id: grace, confirmed: true, unitId: await unitId(FIXTURE.lagos2) });
    expect(listed.statusCode).toBe(201);
    const row = await stored(listed.json().id);
    expect(row.parish_snapshot).toMatchObject({ parish: { id: grace, name: 'Grace Chapel' }, province: { name: 'Lagos Province 3' } });
    expect(row.parish_place_snapshot).toBeNull();

    // Stale: a listed parish is confirmed live, and never stored when the provider can't answer.
    await makeStale();
    fake.calls.length = 0;
    expect((await submit({ kind: 'listed', id: grace, confirmed: true })).statusCode).toBe(201);
    expect(fake.calls).toEqual(['/parishes/SANDBOX-1004']);
    fake.failures.push({ status: 503 }, { status: 503 });
    const unavailable = await submit({ kind: 'listed', id: grace, confirmed: true });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' });
    // A not-listed answer accepts no parish: its province is where they said, from the copy, for staff to review.
    fake.calls.length = 0;
    fake.failures.length = 0;
    expect((await submit({ kind: 'not_listed', name: 'Mercy Seat', unitId: await unitId(FIXTURE.lagos3) })).statusCode).toBe(201);
    expect(fake.calls).toEqual([]);
  });
});

describe('staff see the province with a not-listed answer', () => {
  it('in Parish review, with that province’s parishes suggested first, and on the applicant’s page', async () => {
    const lagos2 = await unitId(FIXTURE.lagos2);
    const owner = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'owner' })));
    const near = (await submit({ kind: 'not_listed', name: 'Jesus House', unitId: lagos2 })).json().id as string;
    const elsewhere = (await submit({ kind: 'not_listed', name: 'Grace Chapel', unitId: lagos2 })).json().id as string;
    const unplaced = (await submit({ kind: 'not_listed', name: 'Jesus House' })).json().id as string;

    const queue = await owner({ url: '/api/admin/parish-review?kind=not_listed' });
    expect(queue.statusCode).toBe(200);
    const item = (applicationId: string) => queue.json().items.find((entry: { application: { id: string } }) => entry.application.id === applicationId);
    // The province they chose, and its Jesus House only (not Lagos Province 3's or Rivers').
    expect(item(near)).toMatchObject({
      kind: 'not_listed',
      name: 'Jesus House',
      place: { id: lagos2, name: 'Lagos Province 2', level: 'province' },
      submitted: { province: { name: 'Lagos Province 2' }, region: { name: 'Region 19' }, continent: { name: 'Continent 3' } },
    });
    expect(item(near).suggestions).toEqual([expect.objectContaining({ id: await parishId(FIXTURE.jesusLagos2) })]);
    // Nothing like it there: suggestions from everywhere instead.
    expect(item(elsewhere).suggestions).toEqual([expect.objectContaining({ id: await parishId(FIXTURE.grace) })]);
    // No province: as before.
    expect(item(unplaced)).toMatchObject({ place: null, submitted: null });
    expect(item(unplaced).suggestions.length).toBeGreaterThan(1);

    const detail = (await owner({ url: `/api/admin/applicants/${near}` })).json();
    expect(detail.parish).toMatchObject({
      submitted: null,
      place: { unit: { id: lagos2, name: 'Lagos Province 2', level: 'province' }, chain: { province: { name: 'Lagos Province 2' }, region: { name: 'Region 19' } } },
    });
    expect((await owner({ url: `/api/admin/applicants/${unplaced}` })).json().parish).toMatchObject({ submitted: null, place: null });
  });
});
