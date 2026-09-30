import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ParishDetailsResponse, ParishSearchResponse } from '../src/shared/directory';
import { validPayload } from '../src/shared/test-fixtures';
import { MESSAGES } from '../src/shared/validation';
import { planImport } from './directory/plan';
import type { SourceRow } from './directory/source';
import { applyPlan, DirectoryError, loadSnapshot, revertImport } from './directory/store';
import { PARISH_ERRORS } from './parishes';
import { clearSettingsCache } from './settings';
import { asUser, createStaff, createTestContext, nextVisitor, staffSignIn, type TestContext } from './test-helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext({ LOG_LEVEL: 'info' });
});
afterEach(async () => {
  await ctx.close();
});

let line = 1;
const row = (continent: string, region: string, province: string, parish: string): SourceRow => ({ line: ++line, continent, region, province, parish });

const LIST = [
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 12', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 2', 'LAGOS PROVINCE 120', 'RCCG JESUS HOUSE PARISH'),
  row('CONTINENT 1', 'REGION 5', 'RIVERS PROVINCE 4', 'JESUS HOUSE'),
  row('CONTINENT 2', 'REGION 35', 'YOUTH PROVINCE 10', 'JESUS HOUSE (YOUTH CHURCH)'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'HOUSE OF PRAYER'),
  row('CONTINENT 12', 'REGION 21', 'OYO PROVINCE 6', 'REHOBOTH'),
  row('CONTINENT 3', 'REGION 14', 'REGION 14', 'ABUNDANCE MEGA'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'GRACE CHAPEL'),
];

async function importList(rows: SourceRow[]): Promise<string> {
  const plan = planImport(rows, await loadSnapshot(ctx.db));
  return applyPlan(ctx.db, plan, { source: 'spreadsheet', label: 'test.xlsx', checksum: null, structureAsAt: '2026-04-30', via: 'cli' });
}

async function switchDirectory(on: boolean) {
  await ctx.db.query(
    `insert into app_settings (key, value) values ('parish_directory_enabled', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(on)],
  );
  clearSettingsCache();
}

const parishId = async (name: string, province: string) =>
  (
    await ctx.db.query<{ id: string }>(
      `select p.id from parishes p join church_units u on u.id = p.province_id where p.display_name = $1 and u.display_name = $2`,
      [name, province],
    )
  ).rows[0]!.id;

const search = async (query: string) => {
  const response = await ctx.app.inject({ method: 'GET', url: `/api/parishes/search?${query}`, remoteAddress: nextVisitor() });
  return { status: response.statusCode, body: response.json() as ParishSearchResponse };
};
const places = (body: ParishSearchResponse) => body.results.map((result) => `${result.name} · ${result.chain.province?.name ?? result.chain.region?.name}`);

let applicant = 0;
const submit = (overrides: Record<string, unknown>) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email: `applicant${++applicant}@example.org` }), ...overrides },
  });
const stored = async (id: string) =>
  (
    await ctx.db.query(
      `select parish_status::text as parish_status, parish_id, parish_name, parish_snapshot from applications where id = $1`,
      [id],
    )
  ).rows[0]!;

describe('GET /api/parishes/search', () => {
  beforeEach(async () => {
    await importList(LIST);
  });

  it('puts parishes in the applicant’s state first, then in province order', async () => {
    const { status, body } = await search('q=jesus%20house&state=Rivers');
    expect(status).toBe(200);
    expect(places(body)).toEqual([
      'Jesus House · Rivers Province 4',
      'Jesus House · Lagos Province 3',
      'Jesus House · Lagos Province 12',
      'RCCG Jesus House Parish · Lagos Province 120',
      'Jesus House (Youth Church) · Youth Province 10',
    ]);
    expect(body).toMatchObject({ total: 5, fuzzy: false });
    expect(body.results[0]).toMatchObject({
      inState: true,
      chain: { province: { name: 'Rivers Province 4' }, region: { name: 'Region 5' }, continent: { name: 'Continent 1' }, zone: null, area: null },
    });
  });

  it('narrows by a province number, whole numbers first, and reads “LP 12” as Lagos Province 12', async () => {
    for (const query of ['q=jesus%20house%2012&state=Lagos', 'q=jesus%20house%20lp%2012', 'q=JESUS%20HOUSE%20LP12', 'q=jesus%20lagos%2012']) {
      const { body } = await search(query);
      expect(places(body), query).toEqual(['Jesus House · Lagos Province 12', 'RCCG Jesus House Parish · Lagos Province 120']);
    }
  });

  it('matches the start of words, ignores RCCG and Parish, and finds parishes with no province', async () => {
    expect(places((await search('q=hous%20of%20pra')).body)).toEqual(['House of Prayer · Lagos Province 3']);
    expect(places((await search('q=rccg%20rehoboth%20parish')).body)).toEqual(['Rehoboth · Oyo Province 6']);
    expect(places((await search('q=abundance')).body)).toEqual(['Abundance Mega · Region 14']);
    expect((await search('q=zzqx')).body).toEqual({ results: [], total: 0, fuzzy: false });
  });

  it('offers the closest spellings when nothing matches exactly', async () => {
    const { body } = await search('q=jesuss%20house&state=Lagos');
    expect(body.fuzzy).toBe(true);
    expect(body.results.map((result) => result.name)).toContain('Jesus House');
    expect(body.results[0]!.chain.province?.name).toMatch(/^Lagos Province/);
  });

  it('leaves out parishes that are no longer listed', async () => {
    expect((await search('q=grace%20chapel')).body.total).toBe(1);
    await importList(LIST.filter((entry) => entry.parish !== 'GRACE CHAPEL'));
    expect((await search('q=grace%20chapel')).body).toEqual({ results: [], total: 0, fuzzy: false });
  });

  it('returns at most the limit asked for, and says how many matched', async () => {
    const { body } = await search('q=jesus&limit=2');
    expect(body.results).toHaveLength(2);
    expect(body.total).toBe(5);
  });

  it('refuses searches that are too short or too long', async () => {
    for (const query of ['q=j', 'q=', '', `q=${'a'.repeat(61)}`]) {
      expect((await search(query)).status, query).toBe(400);
    }
  });

  it('never logs what was typed or the applicant’s state', async () => {
    await search('q=abundance%20mega&state=Rivers');
    const logs = ctx.logs.join('\n');
    expect(logs).toContain('/api/parishes/search');
    expect(logs).not.toMatch(/abundance|Rivers/i);
  });
});

describe('GET /api/parishes/:id', () => {
  beforeEach(async () => {
    await importList(LIST);
  });

  const lookup = async (id: string) => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/parishes/${id}`, remoteAddress: nextVisitor() });
    return { status: response.statusCode, body: response.json() as ParishDetailsResponse };
  };

  it('gives the parish as it stands, with its chain', async () => {
    const id = await parishId('Rehoboth', 'Oyo Province 6');
    expect((await lookup(id)).body).toEqual({
      id,
      name: 'Rehoboth',
      status: 'active',
      mergedInto: null,
      chain: {
        continent: { id: expect.any(String), name: 'Continent 12' },
        region: { id: expect.any(String), name: 'Region 21' },
        province: { id: expect.any(String), name: 'Oyo Province 6' },
        zone: null,
        area: null,
      },
    });
  });

  it('says when a parish is no longer listed or was merged', async () => {
    const grace = await parishId('Grace Chapel', 'Lagos Province 3');
    const prayer = await parishId('House of Prayer', 'Lagos Province 3');
    await ctx.db.query(`update parishes set status = 'merged', merged_into_id = $2 where id = $1`, [grace, prayer]);
    expect((await lookup(grace)).body).toMatchObject({ status: 'merged', mergedInto: { id: prayer, name: 'House of Prayer' } });
    await ctx.db.query(`update parishes set status = 'inactive', merged_into_id = null where id = $1`, [grace]);
    expect((await lookup(grace)).body).toMatchObject({ status: 'inactive', mergedInto: null });
  });

  it('answers 404 for an unknown or malformed ID', async () => {
    expect((await lookup('3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c')).status).toBe(404);
    expect((await lookup('not-an-id')).status).toBe(404);
  });
});

describe('switching the parish directory on', () => {
  const config = async () => (await ctx.app.inject({ method: 'GET', url: '/api/config', remoteAddress: nextVisitor() })).json();

  it('is off by default, and stays off with an empty directory', async () => {
    expect((await config()).parishDirectory).toEqual({ enabled: false });
    await switchDirectory(true);
    expect((await config()).parishDirectory).toEqual({ enabled: false });
    await importList(LIST);
    expect((await config()).parishDirectory).toEqual({ enabled: true });
  });

  it('needs an imported list before an owner can switch it on', async () => {
    const owner = await createStaff(ctx, { role: 'owner' });
    const as = asUser(ctx.app, await staffSignIn(ctx, owner));
    const patch = () => as({ method: 'PATCH', url: '/api/admin/settings', payload: { parish_directory_enabled: true } });
    const refused = await patch();
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toMatch(/Import the RCCG parish list/);
    await importList(LIST);
    const accepted = await patch();
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().settings.parish_directory_enabled).toBe(true);
  });
});

describe('POST /api/applications with the parish directory', () => {
  beforeEach(async () => {
    await importList(LIST);
    await switchDirectory(true);
  });

  it('stores a confirmed parish with a snapshot of what the applicant saw', async () => {
    const id = await parishId('Jesus House', 'Rivers Province 4');
    const response = await submit({ parish: { kind: 'listed', id, confirmed: true } });
    expect(response.statusCode).toBe(201);
    expect(await stored(response.json().id)).toEqual({
      parish_status: 'listed',
      parish_id: id,
      parish_name: 'Jesus House',
      parish_snapshot: {
        parish: { id, name: 'Jesus House' },
        importId: expect.any(String),
        continent: { id: expect.any(String), name: 'Continent 1' },
        region: { id: expect.any(String), name: 'Region 5' },
        province: { id: expect.any(String), name: 'Rivers Province 4' },
        zone: null,
        area: null,
      },
    });
    expect((await ctx.db.query('select count(*)::int as n from parish_reports')).rows[0]).toEqual({ n: 0 });
  });

  it('records a report when the details look wrong, or the parish isn’t listed', async () => {
    const id = await parishId('Rehoboth', 'Oyo Province 6');
    const flagged = await submit({ parish: { kind: 'listed', id, confirmed: true, detailsWrong: true } });
    const missing = await submit({ parish: { kind: 'not_listed', name: ' Glory  Tabernacle ' } });
    expect(await stored(missing.json().id)).toMatchObject({ parish_status: 'reported', parish_id: null, parish_name: 'Glory Tabernacle', parish_snapshot: null });
    const reports = await ctx.db.query(
      `select application_id, kind::text as kind, reported_name, parish_id, status::text as status from parish_reports order by kind`,
    );
    expect(reports.rows).toEqual([
      { application_id: flagged.json().id, kind: 'details_wrong', reported_name: null, parish_id: id, status: 'pending' },
      { application_id: missing.json().id, kind: 'not_listed', reported_name: 'Glory Tabernacle', parish_id: null, status: 'pending' },
    ]);
  });

  it('asks again for a parish that has since been merged, deactivated or never existed', async () => {
    const grace = await parishId('Grace Chapel', 'Lagos Province 3');
    const prayer = await parishId('House of Prayer', 'Lagos Province 3');
    const errorFor = async (id: string) => (await submit({ parish: { kind: 'listed', id, confirmed: true } })).json().fieldErrors?.parishName;
    await ctx.db.query(`update parishes set status = 'merged', merged_into_id = $2 where id = $1`, [grace, prayer]);
    expect(await errorFor(grace)).toBe(PARISH_ERRORS.merged);
    await ctx.db.query(`update parishes set status = 'inactive', merged_into_id = null where id = $1`, [grace]);
    expect(await errorFor(grace)).toBe(PARISH_ERRORS.inactive);
    expect(await errorFor('3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c')).toBe(PARISH_ERRORS.unknown);
    expect((await ctx.db.query('select count(*)::int as n from applications')).rows[0]).toEqual({ n: 0 });
  });

  it('requires the parish from a form that uses the directory, and a confirmation', async () => {
    const id = await parishId('Rehoboth', 'Oyo Province 6');
    expect((await submit({ parish: null })).json().fieldErrors).toEqual({ parishName: MESSAGES.parishRequired });
    expect((await submit({ parish: { kind: 'listed', id, confirmed: false } })).json().fieldErrors).toEqual({ parishName: MESSAGES.parishConfirm });
  });

  it('still accepts an older copy of the form, with its free text', async () => {
    const typed = await submit({ parishName: '  St  Mark ' });
    const blank = await submit({});
    expect(await stored(typed.json().id)).toMatchObject({ parish_status: 'legacy_text', parish_name: 'St Mark', parish_id: null });
    expect(await stored(blank.json().id)).toMatchObject({ parish_status: 'not_provided', parish_name: null });
  });
});

describe('after applications link to parishes', () => {
  it('keeps directory parishes out of text corrections, and tracks free-text ones', async () => {
    const importId = await importList(LIST);
    await switchDirectory(true);
    const listed = (await submit({ parish: { kind: 'listed', id: await parishId('Rehoboth', 'Oyo Province 6'), confirmed: true } })).json().id;
    const typed = (await submit({ parishName: 'St Mark' })).json().id;
    const owner = await createStaff(ctx, { role: 'owner' });
    const as = asUser(ctx.app, await staffSignIn(ctx, owner));
    const correct = (id: string, parishName: string) => as({ method: 'POST', url: `/api/admin/applicants/${id}/correct`, payload: { parishName } });

    const refused = await correct(listed, 'Something else');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().fieldErrors.parishName).toMatch(/parish directory/);
    expect((await correct(typed, '')).statusCode).toBe(200);
    expect(await stored(typed)).toMatchObject({ parish_status: 'not_provided', parish_name: null });
    expect((await correct(typed, 'St Luke')).statusCode).toBe(200);
    expect(await stored(typed)).toMatchObject({ parish_status: 'legacy_text', parish_name: 'St Luke' });

    // The import that added the linked parish can't be undone any more.
    await expect(revertImport(ctx.db, importId)).rejects.toThrow(DirectoryError);
    await expect(revertImport(ctx.db, importId)).rejects.toThrow(/point at parishes this import added/);
  });
});
