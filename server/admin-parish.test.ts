import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validPayload } from '../src/shared/test-fixtures';
import { utcToZonedLocal } from '../src/shared/time';
import { planImport } from './directory/plan';
import type { SourceRow } from './directory/source';
import { applyPlan, loadSnapshot, saveLineage } from './directory/store';
import { parseCsv } from './csv';
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

const LIST = [
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'GRACE CHAPEL'),
  row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 2', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 19', 'REGION 19', 'TRINITY SANCTUARY'),
  row('CONTINENT 1', 'REGION 5', 'RIVERS PROVINCE 4', 'REHOBOTH'),
  row('CONTINENT 12', 'REGION 21', 'OYO PROVINCE 6', 'REHOBOTH'),
];

const today = () => utcToZonedLocal(new Date(), 'Africa/Lagos').slice(0, 10);
type As = ReturnType<typeof asUser>;

let applicant = 0;
async function submit(overrides: Record<string, unknown>): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email: `parish.applicant${++applicant}@example.org` }), ...overrides },
  });
  if (response.statusCode !== 201) throw new Error(`submit failed: ${response.body}`);
  return response.json().id;
}

const unitId = async (name: string) => (await ctx.db.query<{ id: string }>(`select id from church_units where display_name = $1`, [name])).rows[0]!.id;
const parishId = async (name: string, unit: string) =>
  (await ctx.db.query<{ id: string }>(`select p.id from parishes p join church_units u on u.id = p.unit_id where p.display_name = $1 and u.display_name = $2`, [name, unit])).rows[0]!.id;

/**
 * The made-up directory, switched on, and one application of each kind:
 * listed (Jesus House twice, Grace Chapel flagged "details look wrong", Trinity Sanctuary with no
 * province, Rehoboth in Rivers), not listed, three earlier typed answers and one with no parish.
 */
async function seed() {
  const plan = planImport(LIST, await loadSnapshot(ctx.db));
  await applyPlan(ctx.db, plan, { source: 'spreadsheet', label: 'rccg-test.xlsx', checksum: null, structureAsAt: '2026-04-30', via: 'cli' });
  await ctx.db.query(
    `insert into app_settings (key, value) values ('parish_directory_enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value`,
  );
  clearSettingsCache();
  const parishes = {
    jesus3: await parishId('Jesus House', 'Lagos Province 3'),
    jesus2: await parishId('Jesus House', 'Lagos Province 2'),
    grace: await parishId('Grace Chapel', 'Lagos Province 3'),
    trinity: await parishId('Trinity Sanctuary', 'Region 19'),
    rehobothRivers: await parishId('Rehoboth', 'Rivers Province 4'),
  };
  const listed = (id: string, extra: object = {}) => ({ parish: { kind: 'listed', id, confirmed: true, ...extra } });
  const apps = {
    jesusA: await submit(listed(parishes.jesus3)),
    jesusB: await submit(listed(parishes.jesus3)),
    grace: await submit(listed(parishes.grace, { detailsWrong: true })),
    trinity: await submit(listed(parishes.trinity)),
    rivers: await submit({ ...listed(parishes.rehobothRivers), stateOfResidence: 'Rivers' }),
    notListed: await submit({ parish: { kind: 'not_listed', name: 'Glory Tabernacle' } }),
    typedJesus: await submit({ parishName: 'Jesus House' }),
    typedRehoboth: await submit({ parishName: 'RCCG Rehoboth Parish', stateOfResidence: 'Rivers' }),
    typedGrace: await submit({ parishName: 'grace chapel' }),
    none: await submit({}),
  };
  const staff = await createStaff(ctx, { role: 'owner' });
  const owner = asUser(ctx.app, await staffSignIn(ctx, staff));
  const units = {
    continent3: await unitId('Continent 3'),
    continent1: await unitId('Continent 1'),
    region54: await unitId('Region 54'),
    region19: await unitId('Region 19'),
    lagos3: await unitId('Lagos Province 3'),
    lagos2: await unitId('Lagos Province 2'),
  };
  return { parishes, apps, units, owner, ownerId: staff.id };
}

const listIds = async (as: As, filters: Record<string, string>) => {
  const response = await as({ url: `/api/admin/applicants?${new URLSearchParams({ ...filters, pageSize: '100' })}` });
  expect(response.statusCode).toBe(200);
  return (response.json().items as { id: string }[]).map((item) => item.id).sort();
};
const listTotal = async (as: As, filters: Record<string, string>) =>
  (await as({ url: `/api/admin/applicants?${new URLSearchParams({ ...filters, pageSize: '1' })}` })).json().total as number;

describe('applicants and their parish', () => {
  it('lists each application’s parish and filters by any level, parish, answer and date', async () => {
    const { apps, parishes, units, owner } = await seed();
    const items = (await owner({ url: '/api/admin/applicants?pageSize=100' })).json().items as { id: string; parish: unknown }[];
    expect(items.find((item) => item.id === apps.jesusA)!.parish).toEqual({
      status: 'listed',
      answer: 'Jesus House',
      linked: { id: parishes.jesus3, name: 'Jesus House', place: 'Lagos Province 3' },
    });
    expect(items.find((item) => item.id === apps.trinity)!.parish).toMatchObject({ linked: { place: 'Region 19' } });
    expect(items.find((item) => item.id === apps.notListed)!.parish).toEqual({ status: 'reported', answer: 'Glory Tabernacle', linked: null });

    expect(await listIds(owner, { unit: units.lagos3 })).toEqual([apps.jesusA, apps.jesusB, apps.grace].sort());
    expect(await listIds(owner, { unit: units.continent3 })).toEqual([apps.jesusA, apps.jesusB, apps.grace, apps.trinity].sort());
    expect(await listIds(owner, { unit: units.region19, direct: '1' })).toEqual([apps.trinity]);
    expect(await listIds(owner, { parish: parishes.jesus3 })).toEqual([apps.jesusA, apps.jesusB].sort());
    expect(await listIds(owner, { parish: 'none', parishStatus: 'legacy_text' })).toEqual([apps.typedJesus, apps.typedRehoboth, apps.typedGrace].sort());
    expect(await listIds(owner, { parishStatus: 'not_provided' })).toEqual([apps.none]);
    expect(await listIds(owner, { q: 'Grace Chapel' })).toEqual([apps.grace, apps.typedGrace].sort());
    expect(await listTotal(owner, { from: today(), to: today() })).toBe(10);
    expect(await listTotal(owner, { from: '2099-01-01' })).toBe(0);
  });

  it('shows the parish as the applicant confirmed it and as it is now, and lets staff change it', async () => {
    const { apps, parishes, owner, ownerId } = await seed();
    const detail = async (id: string) => (await owner({ url: `/api/admin/applicants/${id}` })).json().parish;
    const before = await detail(apps.grace);
    expect(before).toMatchObject({
      status: 'listed',
      answer: 'Grace Chapel',
      current: { id: parishes.grace, status: 'active', chain: { province: { name: 'Lagos Province 3' }, region: { name: 'Region 54' }, continent: { name: 'Continent 3' } } },
      submitted: { parish: { id: parishes.grace, name: 'Grace Chapel' }, chain: { province: { name: 'Lagos Province 3' } } },
      linkedBy: null,
      reports: [{ kind: 'details_wrong', status: 'pending', resolvedAt: null }],
    });

    const change = (id: string, parishId: string | null) => owner({ method: 'POST', url: `/api/admin/applicants/${id}/parish`, payload: { parishId } });
    expect((await change(apps.grace, parishes.jesus3)).json()).toEqual({ ok: true, from: parishes.grace, to: parishes.jesus3, reportsResolved: 1 });
    const after = await detail(apps.grace);
    expect(after).toMatchObject({
      current: { id: parishes.jesus3, name: 'Jesus House' },
      submitted: { parish: { name: 'Grace Chapel' } },
      linkedBy: { name: 'Test owner' },
      reports: [{ kind: 'details_wrong', status: 'linked', resolvedBy: 'Test owner', resolvedParish: 'Jesus House' }],
    });
    const refused = await change(apps.grace, null);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toMatch(/applicant chose this parish/);

    // A parish the applicant couldn't find: linking settles the report, unlinking reopens it.
    await change(apps.notListed, parishes.grace);
    expect((await detail(apps.notListed)).reports[0]).toMatchObject({ status: 'linked' });
    await change(apps.notListed, null);
    expect(await detail(apps.notListed)).toMatchObject({ current: null, linkedBy: null, reports: [{ status: 'pending' }] });

    const { rows } = await ctx.db.query<{ actor_id: string; details: unknown }>(`select actor_id, details from audit_events where action = 'application.parish_changed' order by id`);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ actor_id: ownerId, details: { from: parishes.grace, to: parishes.jesus3, reportsResolved: 1 } });
    expect(JSON.stringify(rows)).not.toMatch(/Grace|Jesus|Glory/);
  });

  it('exports the parish with its province, region and continent', async () => {
    const { owner } = await seed();
    const csv = (await owner({ url: '/api/admin/applicants/export.csv' })).body;
    const [header, ...lines] = parseCsv(csv).map((cells) => cells.join(','));
    expect(header).toContain('RCCG parish,Parish answer,Parish (directory),Province,Region,Continent,Highest education');
    expect(lines.some((text) => text.includes('Jesus House,Chosen from the directory,Jesus House,Lagos Province 3,Region 54,Continent 3'))).toBe(true);
    expect(lines.some((text) => text.includes('Trinity Sanctuary,Chosen from the directory,Trinity Sanctuary,,Region 19,Continent 3'))).toBe(true);
    expect(lines.some((text) => text.includes('Glory Tabernacle,Not listed (typed by the applicant),,,,'))).toBe(true);
  });
});

describe('Parish review', () => {
  it('queues parishes that aren’t listed, details flags and earlier answers, with suggestions', async () => {
    const { apps, parishes, owner } = await seed();
    const queue = (await owner({ url: '/api/admin/parish-review' })).json();
    expect(queue.counts).toEqual({ not_listed: 1, details_wrong: 1, earlier_text: 3 });
    expect(queue.items).toEqual([expect.objectContaining({ kind: 'not_listed', name: 'Glory Tabernacle', application: expect.objectContaining({ id: apps.notListed, state: 'Lagos' }) })]);

    const flags = (await owner({ url: '/api/admin/parish-review?kind=details_wrong' })).json();
    expect(flags.items[0]).toMatchObject({ parish: { id: parishes.grace }, submitted: { province: { name: 'Lagos Province 3' } } });

    const earlier = (await owner({ url: '/api/admin/parish-review?kind=earlier_text' })).json();
    const exact = Object.fromEntries((earlier.items as { id: string; exactMatch: string | null }[]).map((item) => [item.id, item.exactMatch]));
    // Two Jesus Houses in Lagos: staff choose. One Rehoboth in Rivers and one Grace Chapel in Lagos: exact.
    expect(exact).toEqual({ [apps.typedJesus]: null, [apps.typedRehoboth]: parishes.rehobothRivers, [apps.typedGrace]: parishes.grace });
    const jesus = (earlier.items as { id: string; suggestions: { id: string }[] }[]).find((item) => item.id === apps.typedJesus)!;
    expect(jesus.suggestions.map((suggestion) => suggestion.id).sort()).toEqual([parishes.jesus2, parishes.jesus3].sort());

    // It shows applicants' names and changes the directory: reviewers can't open it.
    const reviewer = asUser(ctx.app, await staffSignIn(ctx, await createStaff(ctx, { role: 'reviewer' })));
    expect((await reviewer({ url: '/api/admin/parish-review' })).statusCode).toBe(403);
  });

  it('adds a parish that wasn’t listed and links the application, once', async () => {
    const { apps, units, owner } = await seed();
    const report = (await owner({ url: '/api/admin/parish-review' })).json().items[0].id as string;
    const resolve = (payload: object) => owner({ method: 'POST', url: `/api/admin/parish-review/reports/${report}/resolve`, payload });
    expect((await resolve({ action: 'add', unitId: units.lagos3, name: 'Jesus House' })).json().message).toMatch(/already lists Jesus House/);
    const added = await resolve({ action: 'add', unitId: units.lagos3, name: 'Glory Tabernacle' });
    expect(added.statusCode).toBe(200);
    const parish = added.json().parishId as string;
    const { rows } = await ctx.db.query(
      `select a.parish_id, a.parish_status::text as parish_status, r.status::text as report, p.origin::text as origin
         from applications a join parish_reports r on r.application_id = a.id join parishes p on p.id = a.parish_id where a.id = $1`,
      [apps.notListed],
    );
    expect(rows).toEqual([{ parish_id: parish, parish_status: 'reported', report: 'added', origin: 'staff' }]);
    expect((await resolve({ action: 'reject' })).statusCode).toBe(409);
  });

  it('marks a details flag fixed', async () => {
    const { owner } = await seed();
    const flag = (await owner({ url: '/api/admin/parish-review?kind=details_wrong' })).json().items[0].id as string;
    const resolve = (payload: object) => owner({ method: 'POST', url: `/api/admin/parish-review/reports/${flag}/resolve`, payload });
    expect((await resolve({ action: 'add', unitId: (await ctx.db.query<{ id: string }>(`select id from church_units limit 1`)).rows[0]!.id, name: 'X' })).statusCode).toBe(400);
    expect((await resolve({ action: 'fixed' })).statusCode).toBe(200);
    expect((await owner({ url: '/api/admin/parish-review' })).json().counts.details_wrong).toBe(0);
  });

  it('confirms exact matches together, skipping any dealt with meanwhile', async () => {
    const { apps, parishes, owner } = await seed();
    const matches = (await owner({ url: '/api/admin/parish-review/earlier/matches' })).json();
    expect(matches.total).toBe(2);
    const items = (matches.items as { application: { id: string }; parish: { id: string; name: string; place: string } }[]).map((item) => ({
      applicationId: item.application.id,
      parishId: item.parish.id,
    }));
    expect(items).toEqual(
      expect.arrayContaining([
        { applicationId: apps.typedRehoboth, parishId: parishes.rehobothRivers },
        { applicationId: apps.typedGrace, parishId: parishes.grace },
      ]),
    );
    expect((await owner({ method: 'POST', url: `/api/admin/parish-review/earlier/${apps.typedGrace}/dismiss` })).statusCode).toBe(200);
    expect((await owner({ method: 'POST', url: `/api/admin/parish-review/earlier/${apps.typedGrace}/dismiss` })).statusCode).toBe(409);
    const confirmed = await owner({ method: 'POST', url: '/api/admin/parish-review/earlier/confirm', payload: { items } });
    expect(confirmed.json()).toEqual({ ok: true, linked: 1, skipped: 1 });
    const { rows } = await ctx.db.query(`select id, parish_id from applications where id in ($1, $2) order by id`, [apps.typedRehoboth, apps.typedGrace]);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.parish_id]))).toEqual({ [apps.typedRehoboth]: parishes.rehobothRivers, [apps.typedGrace]: null });

    // Staff link the last one by hand.
    const link = await owner({ method: 'POST', url: `/api/admin/parish-review/earlier/${apps.typedJesus}/link`, payload: { parishId: parishes.jesus2 } });
    expect(link.statusCode).toBe(200);
    expect((await owner({ url: '/api/admin/parish-review' })).json().counts.earlier_text).toBe(0);

    // A full batch fits in one request: 500 pairs are more than the default 16 KB body (security audit).
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const batch = Array.from({ length: 500 }, (_, n) => ({ applicationId: id(n), parishId: id(n + 1000) }));
    expect(JSON.stringify({ items: batch }).length).toBeGreaterThan(16 * 1024);
    expect((await owner({ method: 'POST', url: '/api/admin/parish-review/earlier/confirm', payload: { items: batch } })).json()).toEqual({ ok: true, linked: 0, skipped: 500 });
  });
});

describe('Parish directory screens', () => {
  it('browses the tree with counts, and shows an entry’s history and the 2026 changes', async () => {
    const { units, parishes, owner } = await seed();
    const root = (await owner({ url: '/api/admin/directory/browse' })).json();
    expect(root.children.map((unit: { name: string; parishes: number }) => [unit.name, unit.parishes])).toEqual([
      ['Continent 1', 1],
      ['Continent 3', 4],
      ['Continent 12', 1],
    ]);
    const region = (await owner({ url: `/api/admin/directory/browse?unit=${units.region19}` })).json();
    expect(region.ancestors.map((unit: { name: string }) => unit.name)).toEqual(['Continent 3']);
    expect(region.children.map((unit: { name: string }) => unit.name)).toEqual(['Lagos Province 2']);
    expect(region.parishes.items).toEqual([expect.objectContaining({ id: parishes.trinity, name: 'Trinity Sanctuary', applications: 1, corrected: false })]);

    const renamed = await owner({ method: 'PATCH', url: `/api/admin/directory/parishes/${parishes.trinity}`, payload: { displayName: 'Trinity Sanctuary, Surulere' } });
    expect(renamed.json()).toEqual({ ok: true, changed: ['display_name'] });
    const detail = (await owner({ url: `/api/admin/directory/parishes/${parishes.trinity}` })).json();
    expect(detail.parish).toMatchObject({ name: 'Trinity Sanctuary, Surulere', officialName: 'TRINITY SANCTUARY', corrected: ['display_name'], unit: { name: 'Region 19' } });
    expect(detail.applications).toBe(1);
    expect(detail.history.items.map((item: { change: string; by: string }) => [item.change, item.by])).toEqual([
      ['update', 'Test owner'],
      ['create', 'Import: rccg-test.xlsx'],
    ]);

    await saveLineage(ctx.db, [
      { level: 'province', newKey: 'LAGOS PROVINCE 135', newName: 'LAGOS PROVINCE 135', sourceLevel: 'province', sourceKey: 'LAGOS PROVINCE 2', sourceName: 'LAGOS PROVINCE 2', approvedOn: '2026-08-17' },
    ]);
    const lineage = (await owner({ url: '/api/admin/directory/lineage' })).json();
    expect(lineage.items).toEqual([
      { level: 'province', name: 'LAGOS PROVINCE 135', approvedOn: '2026-08-17', unit: null, sources: [{ name: 'Lagos Province 2', unit: { id: units.lagos2, name: 'Lagos Province 2', status: 'active' } }] },
    ]);
    expect((await owner({ url: `/api/admin/directory/browse?unit=${units.region19}` })).json().children[0]).toMatchObject({ changed2026: true });
    expect((await owner({ url: '/api/admin/directory/overview' })).json()).toMatchObject({ lineageWaiting: 1, corrections: 1, pendingReviews: 5 });
  });

  it('merges parishes through the API, moving their applications and keeping what the applicant confirmed', async () => {
    const { apps, parishes, owner } = await seed();
    const merged = await owner({ method: 'POST', url: `/api/admin/directory/parishes/${parishes.grace}/merge`, payload: { intoId: parishes.jesus3 } });
    expect(merged.json()).toEqual({ ok: true, applicationsMoved: 1 });
    const detail = (await owner({ url: `/api/admin/applicants/${apps.grace}` })).json().parish;
    expect(detail).toMatchObject({ current: { id: parishes.jesus3 }, submitted: { parish: { name: 'Grace Chapel' } } });
    const refused = await owner({ method: 'POST', url: '/api/admin/directory/parishes', payload: { unitId: parishes.grace, name: 'Anything' } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toBe('There is no unit with that ID.');
  });

  it('shows the directory’s readiness in Settings', async () => {
    const { owner } = await seed();
    const settings = (await owner({ url: '/api/admin/settings' })).json();
    expect(settings.settings.parish_directory_enabled).toBe(true);
    expect(settings.directory).toMatchObject({
      levels: { continent: { active: 3, total: 3 }, region: { active: 4, total: 4 }, province: { active: 4, total: 4 } },
      parishes: { active: 6, inactive: 0, merged: 0, staffAdded: 0 },
      latestImport: { label: 'rccg-test.xlsx', structureAsAt: '2026-04-30', via: 'cli' },
      pendingReviews: 5,
    });
  });
});
