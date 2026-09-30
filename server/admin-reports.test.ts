import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type Permission } from '../src/shared/permissions';
import { validPayload } from '../src/shared/test-fixtures';
import { utcToZonedLocal } from '../src/shared/time';
import { planImport } from './directory/plan';
import type { SourceRow } from './directory/source';
import { applyPlan, loadSnapshot } from './directory/store';
import { clearSettingsCache } from './settings';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type TestContext } from './test-helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

let line = 1;
const row = (continent: string, region: string, province: string, parish: string): SourceRow => ({ line: ++line, continent, region, province, parish });

// Made-up directory with the RCCG list's shapes: a parish with no province (Trinity Sanctuary) and a
// province straight under its continent, with no region (Rivers Province 4).
const LIST = [
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'GRACE CHAPEL'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 9', 'HOUSE OF PRAYER'),
  row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 2', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 19', 'REGION 19', 'TRINITY SANCTUARY'),
  row('CONTINENT 1', 'CONTINENT 1', 'RIVERS PROVINCE 4', 'REHOBOTH'),
  row('CONTINENT 12', 'REGION 21', 'OYO PROVINCE 6', 'REHOBOTH'),
];

const lagosDay = (offsetDays = 0) => utcToZonedLocal(new Date(Date.now() + offsetDays * 86_400_000), 'Africa/Lagos').slice(0, 10);
type As = ReturnType<typeof asUser>;

let applicant = 0;
async function submit(overrides: Record<string, unknown>, email = `report.applicant${++applicant}@example.org`): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email }), ...overrides },
  });
  if (response.statusCode !== 201) throw new Error(`submit failed: ${response.body}`);
  return response.json().id;
}

const unitId = async (name: string) => (await ctx.db.query<{ id: string }>(`select id from church_units where display_name = $1`, [name])).rows[0]!.id;
const parishId = async (name: string, unit: string) =>
  (await ctx.db.query<{ id: string }>(`select p.id from parishes p join church_units u on u.id = p.unit_id where p.display_name = $1 and u.display_name = $2`, [name, unit])).rows[0]!.id;

/**
 * Ten applications, nine people: seven with a listed parish (one of them the same person in a
 * second cohort), one not listed, one typed on the earlier form and one with no parish.
 */
async function seed() {
  const plan = planImport(LIST, await loadSnapshot(ctx.db));
  await applyPlan(ctx.db, plan, { source: 'spreadsheet', label: 'report-test.xlsx', checksum: null, structureAsAt: '2026-04-30', via: 'cli' });
  await ctx.db.query(`insert into app_settings (key, value) values ('parish_directory_enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value`);
  clearSettingsCache();
  const listed = (id: string, extra: object = {}) => ({ parish: { kind: 'listed', id, confirmed: true, ...extra } });
  const jesus3 = await parishId('Jesus House', 'Lagos Province 3');
  const returning = 'returning.applicant@example.org';
  const apps = {
    jesusA: await submit(listed(jesus3), returning),
    jesusB: await submit(listed(jesus3)),
    grace: await submit(listed(await parishId('Grace Chapel', 'Lagos Province 3'), { detailsWrong: true })),
    prayer: await submit(listed(await parishId('House of Prayer', 'Lagos Province 9'))),
    trinity: await submit(listed(await parishId('Trinity Sanctuary', 'Region 19'))),
    rivers: await submit({ ...listed(await parishId('Rehoboth', 'Rivers Province 4')), stateOfResidence: 'Rivers' }),
    notListed: await submit({ parish: { kind: 'not_listed', name: 'Glory Tabernacle' } }),
    typed: await submit({ parishName: 'Jesus House' }),
    none: await submit({}),
    secondCohort: '',
  };
  const staff = await createStaff(ctx, { role: 'owner' });
  const owner = asUser(ctx.app, await staffSignIn(ctx, staff));
  // A second cohort, open now: the same person applies again.
  const open = (days: number) => utcToZonedLocal(new Date(Date.now() + days * 86_400_000), 'Africa/Lagos');
  const cohort = await owner({
    method: 'POST',
    url: '/api/admin/cohorts',
    payload: { slug: 'called-generation-2', name: 'Second cohort', edition: 2, opensAt: open(-1), closesAt: open(60), timeZone: 'Africa/Lagos', acceptingApplications: true },
  });
  expect(cohort.statusCode).toBe(201);
  apps.secondCohort = await submit(listed(jesus3), returning);
  return { apps, owner, cohort2: cohort.json().id as string };
}

const get = async (as: As, path: string, query: Record<string, string> = {}) => {
  const response = await as({ url: `/api/admin/reports/${path}?${new URLSearchParams(query)}` });
  expect(response.statusCode).toBe(200);
  return response.json();
};
const listTotal = async (as: As, filters: Record<string, string>) =>
  (await as({ url: `/api/admin/applicants?${new URLSearchParams({ ...filters, pageSize: '1' })}` })).json().total as number;

type Card = { key: string; kind: string; name: string; applications: number; filter: Record<string, string>; parishesWithApplications: number | null; activeParishes: number | null };
const cards = (listing: { items: Card[]; extras: Card[] }) => [...listing.items, ...listing.extras].map((card) => [card.kind, card.name, card.applications]);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Every card's count opens exactly that many applicants, and the cards add up to the listing's total. */
async function reconcile(as: As, listing: { items: Card[]; extras: Card[]; totals: { applications: number } }, filters: Record<string, string> = {}) {
  const all = [...listing.items, ...listing.extras];
  expect(sum(all.map((card) => card.applications))).toBe(listing.totals.applications);
  for (const card of all) expect({ card: card.name, total: await listTotal(as, { ...filters, ...card.filter }) }).toEqual({ card: card.name, total: card.applications });
}

describe('the summary', () => {
  it('counts applications and applicants, and every breakdown adds up to the applications', async () => {
    const { owner } = await seed();
    const summary = await get(owner, 'summary');
    expect(summary).toMatchObject({
      applications: 10,
      uniqueApplicants: 9,
      withParish: 7,
      linkedByStaff: 0,
      withoutParish: 3,
      answers: {
        listed: 7,
        reported: { linked: 0, unlinked: 1 },
        legacyText: { linked: 0, unlinked: 1 },
        notProvided: { linked: 0, unlinked: 1 },
      },
      noRegion: 1,
      noProvince: 1,
      parishesRepresented: 5,
      activeParishes: 7,
      waiting: { notListed: 1, detailsWrong: 1, earlierText: 1 },
      comparison: null,
      directory: { label: 'report-test.xlsx', structureAsAt: '2026-04-30' },
      masked: false,
    });
    expect(sum(Object.values(summary.byStatus))).toBe(10);
    expect(sum(Object.values(summary.byPublished))).toBe(10);
    const { listed, reported, legacyText, notProvided } = summary.answers;
    expect(listed + sum([reported, legacyText, notProvided].flatMap((split) => [split.linked, split.unlinked]))).toBe(summary.applications);
    expect(await listTotal(owner, {})).toBe(10);

    // Linking the typed answer moves it from "no parish" to "linked by staff", and the total stays.
    const typed = (await owner({ url: '/api/admin/parish-review?kind=earlier_text' })).json().items[0].id as string;
    await owner({ method: 'POST', url: `/api/admin/parish-review/earlier/${typed}/link`, payload: { parishId: await parishId('Jesus House', 'Lagos Province 2') } });
    expect(await get(owner, 'summary')).toMatchObject({
      applications: 10,
      withParish: 8,
      linkedByStaff: 1,
      withoutParish: 2,
      answers: { legacyText: { linked: 1, unlinked: 0 } },
      waiting: { earlierText: 0 },
    });
  });

  it('compares with the period before only when there is one, and says so when it had none', async () => {
    const { apps, owner } = await seed();
    const today = await get(owner, 'summary', { from: lagosDay(), to: lagosDay() });
    expect(today.comparison).toEqual({ from: lagosDay(-1), to: lagosDay(-1), days: 1, applications: 0, uniqueApplicants: 0 });

    await ctx.db.query(`update applications set created_at = created_at - interval '1 day' where id = $1`, [apps.prayer]);
    const again = await get(owner, 'summary', { from: lagosDay(), to: lagosDay() });
    expect(again.applications).toBe(9);
    expect(again.comparison).toMatchObject({ applications: 1, uniqueApplicants: 1 });
    // From yesterday with no last day means up to today: the previous period is the two days before.
    expect((await get(owner, 'summary', { from: lagosDay(-1) })).comparison).toMatchObject({ from: lagosDay(-3), to: lagosDay(-2), days: 2 });
    // No first day, nothing to compare with.
    expect((await get(owner, 'summary', { to: lagosDay() })).comparison).toBeNull();
  });
});

describe('applications by region, province and parish', () => {
  it('lists every level across the directory, and the groups outside it make the totals add up', async () => {
    const { owner } = await seed();
    const regions = await get(owner, 'units', { level: 'region' });
    expect(regions).toMatchObject({ mode: 'level', level: 'region', total: 3, includeAll: true });
    expect(cards(regions)).toEqual([
      ['unit', 'Region 54', 5],
      ['unit', 'Region 19', 1],
      ['unit', 'Region 21', 0],
      ['without', 'No region', 1],
    ]);
    expect(regions.totals.applications).toBe(7);
    expect(regions.items[0]).toMatchObject({ parent: { name: 'Continent 3' }, parishesWithApplications: 3, activeParishes: 3, children: { level: 'province', count: 2 } });
    await reconcile(owner, regions);

    const provinces = await get(owner, 'units', { level: 'province' });
    expect(cards(provinces)).toEqual([
      ['unit', 'Lagos Province 3', 4],
      ['unit', 'Lagos Province 9', 1],
      ['unit', 'Rivers Province 4', 1],
      ['unit', 'Lagos Province 2', 0],
      ['unit', 'Oyo Province 6', 0],
      ['without', 'No province', 1],
    ]);
    await reconcile(owner, provinces);

    const continents = await get(owner, 'units', { level: 'continent', sort: 'name' });
    expect(cards(continents)).toEqual([
      ['unit', 'Continent 1', 1],
      ['unit', 'Continent 3', 6],
      ['unit', 'Continent 12', 0],
    ]);
    await reconcile(owner, continents);

    const parishes = await get(owner, 'units', { level: 'parish' });
    expect(parishes.includeAll).toBe(false);
    expect(cards(parishes)).toEqual([
      ['parish', 'Jesus House', 3],
      ['parish', 'Grace Chapel', 1],
      ['parish', 'House of Prayer', 1],
      ['parish', 'Rehoboth', 1],
      ['parish', 'Trinity Sanctuary', 1],
    ]);
    expect(parishes.items[0]).toMatchObject({ parent: { name: 'Lagos Province 3', level: 'province' }, chain: { province: 'Lagos Province 3', region: 'Region 54', continent: 'Continent 3' } });
    await reconcile(owner, parishes);
    expect((await get(owner, 'units', { level: 'parish', include: 'all' })).total).toBe(7);

    // Every listing adds up to the applications with a parish, and the summary's gaps name the rest.
    const summary = await get(owner, 'summary');
    for (const listing of [regions, provinces, continents, parishes]) expect(listing.totals.applications).toBe(summary.withParish);
    const without = await get(owner, 'units', { level: 'parish', without: 'province' });
    expect(cards(without)).toEqual([['parish', 'Trinity Sanctuary', 1]]);
  });

  it('drills from a continent or region to what is under it, down to parishes', async () => {
    const { owner } = await seed();
    const region54 = await get(owner, 'units', { unit: await unitId('Region 54') });
    expect(region54).toMatchObject({ mode: 'children', level: null, within: { name: 'Region 54', level: 'region', childLevel: 'province' }, ancestors: [{ name: 'Continent 3' }] });
    expect(cards(region54)).toEqual([
      ['unit', 'Lagos Province 3', 4],
      ['unit', 'Lagos Province 9', 1],
    ]);
    const region19 = await get(owner, 'units', { unit: await unitId('Region 19') });
    expect(cards(region19)).toEqual([
      ['unit', 'Lagos Province 2', 0],
      ['direct', 'No province: directly under Region 19', 1],
    ]);
    await reconcile(owner, region19);
    const direct = await get(owner, 'units', { unit: await unitId('Region 19'), direct: '1' });
    expect(direct).toMatchObject({ mode: 'parishes', direct: true });
    expect(cards(direct)).toEqual([['parish', 'Trinity Sanctuary', 1]]);

    const lagos3 = await get(owner, 'units', { unit: await unitId('Lagos Province 3') });
    expect(lagos3).toMatchObject({ mode: 'parishes', ancestors: [{ name: 'Continent 3' }, { name: 'Region 54' }] });
    expect(cards(lagos3)).toEqual([
      ['parish', 'Jesus House', 3],
      ['parish', 'Grace Chapel', 1],
    ]);
    // A province straight under its continent is one of the continent's units.
    const continent1 = await get(owner, 'units', { unit: await unitId('Continent 1') });
    expect(cards(continent1)).toEqual([['unit', 'Rivers Province 4', 1]]);
    expect(continent1.items[0].level).toBe('province');

    // Each level adds up to the level above, under the same filters.
    for (const [name, listing] of [['Region 54', region54], ['Region 19', region19], ['Lagos Province 3', lagos3]] as const) {
      expect((await get(owner, 'summary', { unit: await unitId(name) })).applications).toBe(listing.totals.applications);
      await reconcile(owner, listing);
    }
    expect((await owner({ url: `/api/admin/reports/units?unit=${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}` })).statusCode).toBe(404);
  });

  it('keeps every filter across the summary, the cards and the applicants they open', async () => {
    const { apps, owner } = await seed();
    await owner({ method: 'POST', url: `/api/admin/applicants/${apps.jesusA}/status`, payload: { status: 'under_review' } });
    await owner({ method: 'POST', url: `/api/admin/applicants/${apps.prayer}/status`, payload: { status: 'under_review' } });
    const filters = { status: 'under_review', unit: await unitId('Region 54'), from: lagosDay(), to: lagosDay() };
    const summary = await get(owner, 'summary', filters);
    expect(summary.applications).toBe(2);
    expect(await listTotal(owner, filters)).toBe(2);
    const listing = await get(owner, 'units', filters);
    expect(cards(listing)).toEqual([
      ['unit', 'Lagos Province 3', 1],
      ['unit', 'Lagos Province 9', 1],
    ]);
    expect(listing.items[0].byStatus).toMatchObject({ under_review: 1, submitted: 0 });
    await reconcile(owner, listing, filters);
  });

  it('pages, searches and sorts on the server, and caps the page size', async () => {
    const { owner } = await seed();
    const page = (query: Record<string, string>) => get(owner, 'units', { level: 'parish', include: 'all', sort: 'name', ...query });
    const first = await page({ pageSize: '2' });
    expect(first).toMatchObject({ total: 7, page: 1, pageSize: 2 });
    expect(first.items.map((card: Card) => card.name)).toEqual(['Grace Chapel', 'House of Prayer']);
    expect((await page({ pageSize: '2', page: '4' })).items.map((card: Card) => card.name)).toEqual(['Trinity Sanctuary']);
    expect((await page({ pageSize: '500' })).pageSize).toBe(48);
    const search = await get(owner, 'units', { level: 'region', q: 'region 5' });
    expect(cards(search)).toEqual([['unit', 'Region 54', 5]]);
    expect((await get(owner, 'units', { level: 'province', sort: 'name' })).items.map((card: Card) => card.name)).toEqual([
      'Lagos Province 2',
      'Lagos Province 3',
      'Lagos Province 9',
      'Oyo Province 6',
      'Rivers Province 4',
    ]);
  });

  it('sorts by any review status or by parishes with applications, either way, breaking ties by applications then name', async () => {
    const { apps, owner } = await seed();
    // Staff have moved some applications on.
    await ctx.db.query(`update applications set status = 'shortlisted' where id = any($1::uuid[])`, [[apps.jesusB, apps.grace, apps.prayer]]);
    await ctx.db.query(`update applications set status = 'under_review' where id = $1`, [apps.rivers]);
    const provinces = async (query: Record<string, string>) => {
      const listing = await get(owner, 'units', { level: 'province', ...query });
      return { sort: listing.sort, dir: listing.dir, names: listing.items.map((card: Card) => card.name) };
    };
    expect(await provinces({ sort: 'shortlisted' })).toEqual({
      sort: 'shortlisted',
      dir: 'desc',
      names: ['Lagos Province 3', 'Lagos Province 9', 'Rivers Province 4', 'Lagos Province 2', 'Oyo Province 6'],
    });
    expect((await provinces({ sort: 'shortlisted', dir: 'asc' })).names).toEqual(['Rivers Province 4', 'Lagos Province 2', 'Oyo Province 6', 'Lagos Province 9', 'Lagos Province 3']);
    expect((await provinces({ sort: 'under_review' })).names).toEqual(['Rivers Province 4', 'Lagos Province 3', 'Lagos Province 9', 'Lagos Province 2', 'Oyo Province 6']);
    expect((await provinces({ sort: 'parishes' })).names).toEqual(['Lagos Province 3', 'Lagos Province 9', 'Rivers Province 4', 'Lagos Province 2', 'Oyo Province 6']);
    expect((await provinces({ dir: 'asc' })).names).toEqual(['Lagos Province 2', 'Oyo Province 6', 'Lagos Province 9', 'Rivers Province 4', 'Lagos Province 3']);
    expect(await provinces({ sort: 'name', dir: 'desc' })).toEqual({
      sort: 'name',
      dir: 'desc',
      names: ['Rivers Province 4', 'Oyo Province 6', 'Lagos Province 9', 'Lagos Province 3', 'Lagos Province 2'],
    });
    // Unknown sorts fall back to the default.
    expect(await provinces({ sort: 'unknown', dir: 'sideways' })).toMatchObject({ sort: 'applications', dir: 'desc' });
    const parishes = await get(owner, 'units', { level: 'parish', sort: 'shortlisted' });
    expect(parishes.items.map((card: Card) => card.name)).toEqual(['Jesus House', 'Grace Chapel', 'House of Prayer', 'Rehoboth', 'Trinity Sanctuary']);
  });

  it('exports a whole listing as CSV, with the period and the directory, and audits it', async () => {
    const { owner } = await seed();
    const response = await owner({ url: '/api/admin/reports/units.csv?level=province&pageSize=2' });
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    const lines = response.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^Level,Name,In,Status,Changed in 2026,Applications,Review: /);
    expect(lines).toHaveLength(1 + 5 + 1 + 1); // header, every province (not just the page), No province, total
    expect(lines[1]).toContain('province,Lagos Province 3,Region 54,active,,4');
    expect(lines[1]).toContain('all time,report-test.xlsx (as at 2026-04-30)');
    expect(lines.at(-1)).toMatch(/^total,All provinces,,,,7,/);
    const { rows } = await ctx.db.query(`select details from audit_events where action = 'reports.exported'`);
    expect(rows).toEqual([{ details: { rows: 6, level: 'province', filters: ['level', 'pageSize'], masked: false } }]);
  });
});

describe('over time and by cohort', () => {
  it('counts per day and per week in Lagos time, adding up to the summary', async () => {
    const { owner } = await seed();
    const days = await get(owner, 'trend', { interval: 'day', from: lagosDay(-2), to: lagosDay() });
    expect(days.points).toEqual([
      { period: lagosDay(-2), applications: 0 },
      { period: lagosDay(-1), applications: 0 },
      { period: lagosDay(), applications: 10 },
    ]);
    expect(days.explicit).toBe(true);
    const weeks = await get(owner, 'trend', { interval: 'week' });
    expect(weeks).toMatchObject({ explicit: false });
    expect(weeks.points).toHaveLength(12);
    expect(sum(weeks.points.map((point: { applications: number }) => point.applications))).toBe((await get(owner, 'summary', { from: weeks.from, to: weeks.to })).applications);
  });

  it('counts each cohort, telling applications from applicants', async () => {
    const { owner, cohort2 } = await seed();
    const cohorts = await get(owner, 'cohorts');
    expect(cohorts.items.map((cohort: { name: string; applications: number; openNow: boolean }) => [cohort.name, cohort.applications, cohort.openNow])).toEqual([
      ['Second cohort', 1, true],
      [expect.any(String), 9, expect.any(Boolean)],
    ]);
    expect(await listTotal(owner, { cohort: cohort2 })).toBe(1);
    const summary = await get(owner, 'summary');
    expect(summary.applications - summary.uniqueApplicants).toBe(1); // the same person in both cohorts
    // The cohort filter doesn't narrow the cohort list; the others do.
    expect((await get(owner, 'cohorts', { cohort: cohort2, parish: 'none' })).items.map((cohort: { applications: number }) => cohort.applications)).toEqual([0, 3]);
  });

  it('gives the dashboard applications by continent, the busiest regions and those without a parish', async () => {
    const { owner } = await seed();
    const overview = (await owner({ url: '/api/admin/reports/overview' })).json();
    expect(overview).toMatchObject({ masked: false, total: 10, unmatched: 3 });
    expect(overview.continents.map((continent: { name: string; applications: number }) => [continent.name, continent.applications])).toEqual([
      ['Continent 1', 1],
      ['Continent 3', 6],
      ['Continent 12', 0],
    ]);
    expect(overview.topRegions.map((region: { name: string; applications: number }) => [region.name, region.applications])).toEqual([
      ['Region 54', 5],
      ['Region 19', 1],
    ]);
  });
});

describe('who sees what', () => {
  it('shows counts of 1 to 4 as “fewer than 5” to roles without applicant details', async () => {
    await seed();
    const original = ROLE_PERMISSIONS.read_only;
    (ROLE_PERMISSIONS as Record<string, readonly Permission[]>).read_only = [...original, 'reports.view'];
    try {
      const viewer = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'read_only' })));
      const summary = await get(viewer, 'summary');
      expect(summary).toMatchObject({ masked: true, applications: 10, uniqueApplicants: 9, withParish: 7, noRegion: null, parishesRepresented: 5, activeParishes: 7 });
      const regions = await get(viewer, 'units', { level: 'region' });
      expect(cards(regions)).toEqual([
        ['unit', 'Region 54', 5],
        ['unit', 'Region 19', null],
        ['unit', 'Region 21', 0],
        ['without', 'No region', null],
      ]);
      expect(regions.items[0].byStatus.submitted).toBe(5);
      // Ordering by a status or by parishes would give small counts away: the listing keeps its default order.
      expect(await get(viewer, 'units', { level: 'region', sort: 'shortlisted' })).toMatchObject({ sort: 'applications', dir: 'desc' });
      expect(await get(viewer, 'units', { level: 'region', sort: 'parishes', dir: 'asc' })).toMatchObject({ sort: 'applications', dir: 'asc' });
      expect(await get(viewer, 'units', { level: 'region', sort: 'name' })).toMatchObject({ sort: 'name', dir: 'asc' });
      expect((await get(viewer, 'cohorts')).items.map((cohort: { applications: number | null }) => cohort.applications)).toEqual([null, 9]);
      const csv = (await viewer({ url: '/api/admin/reports/units.csv?level=region' })).body;
      expect(csv).toContain('region,Region 19,Continent 3,active,,fewer than 5');
      // Read-only staff still can't open the applicants behind the counts.
      expect((await viewer({ url: '/api/admin/applicants' })).statusCode).toBe(403);
    } finally {
      (ROLE_PERMISSIONS as Record<string, readonly Permission[]>).read_only = original;
    }
  });
});
