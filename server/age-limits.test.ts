import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ageEligibility, ageLimitMessage } from '../src/shared/ageLimits';
import { AGE_RANGES, CONSENT_STATEMENT, CONSENT_VERSION } from '../src/shared/application';
import { validPayload } from '../src/shared/test-fixtures';
import { syncDirectory } from './directory/api-sync';
import { BASE_RELEASE, FIXTURE, fakeDirectoryApi, type FakeDirectoryApi, type FakeRelease } from './directory/test-api';
import { clearSettingsCache } from './settings';
import { createTestContext, nextVisitor, type TestContext } from './test-helpers';

// Age limits by continent (06 D-65): 35 in Continent 1, 40 in Continents 2 and 11, 30 elsewhere or
// when the continent isn't known. The sandbox fixture has Jesus House in Rivers Province 4
// (Continent 1), RCCG Central Parish directly under Continent 2 and Grace Chapel in Lagos
// Province 3 (Continent 3); this release adds Continent 11 with a province and a parish.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NORTH = { continent: id(110), region: id(1101), province: id(1102), parish: id(1103) };
const NORTH_RELEASE: FakeRelease = {
  id: id(9201),
  versionCode: 'SANDBOX.1-NORTH',
  name: 'Sandbox Continent 11',
  base: 'SANDBOX.1',
  effectiveFrom: '2026-08-20T23:00:00Z',
  changes: [
    { type: 'created', id: NORTH.continent, code: 'NORTH-C11', level: 'continent', name: 'CONTINENT 11', parentId: FIXTURE.root },
    { type: 'created', id: NORTH.region, code: 'NORTH-R1', level: 'region', name: 'REGION 110', parentId: NORTH.continent },
    { type: 'created', id: NORTH.province, code: 'NORTH-P1', level: 'province', name: 'KANO PROVINCE 1', parentId: NORTH.region },
    { type: 'created', id: NORTH.parish, code: 'NORTH-1', level: 'parish', name: 'NORTH STAR PARISH', parentId: NORTH.province },
  ],
};

const KEY = 'fake-age-limits-key-0123456789';
let ctx: TestContext;
let fake: FakeDirectoryApi;

async function setDirectory(on: boolean) {
  await ctx.db.query(
    `insert into app_settings (key, value) values ('parish_directory_enabled', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(on)],
  );
  clearSettingsCache();
}

beforeEach(async () => {
  fake = fakeDirectoryApi({ key: KEY, releases: [BASE_RELEASE, NORTH_RELEASE] });
  ctx = await createTestContext({ DIRECTORY_API_ENV: 'sandbox', DIRECTORY_API_KEY: KEY }, { directoryFetch: (input, init) => fake.fetch(input, init) });
  expect(await syncDirectory(ctx.db, ctx.services.directory!)).toMatchObject({ status: 'applied', release: 'SANDBOX.1-NORTH' });
  await setDirectory(true);
});
afterEach(async () => {
  await ctx.close();
});

const parishId = async (uuid: string) => (await ctx.db.query<{ id: string }>(`select id from parishes where external_uuid = $1`, [uuid])).rows[0]!.id;
const unitId = async (uuid: string) => (await ctx.db.query<{ id: string }>(`select id from church_units where external_uuid = $1`, [uuid])).rows[0]!.id;

let applicant = 0;
const submit = (ageRange: string, extra: object) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: nextVisitor(),
    payload: { ...validPayload({ email: `age.applicant${++applicant}@example.org`, ageRange: ageRange as never }), ...extra },
  });
const listed = async (uuid: string) => ({ parish: { kind: 'listed', id: await parishId(uuid), confirmed: true } });
const storedAge = async (applicationId: string) =>
  (await ctx.db.query<{ age_range: string }>('select age_range::text from applications where id = $1', [applicationId])).rows[0]!.age_range;

describe('the age options', () => {
  it('match the database enum, in order', async () => {
    const { rows } = await ctx.db.query<{ value: string }>('select unnest(enum_range(null::age_range))::text as value');
    expect(rows.map((row) => row.value)).toEqual(AGE_RANGES.map((range) => range.value));
  });

  it('come with the new consent statement, and the earlier one still counts', async () => {
    const { rows } = await ctx.db.query<{ version: string; statement: string }>('select version, statement from consent_versions order by version');
    expect(rows.map((row) => row.version)).toEqual(['2026-09-v1', CONSENT_VERSION]);
    // The form shows exactly what the database records for the consent.
    expect(rows[1]!.statement).toBe(CONSENT_STATEMENT);
    expect(CONSENT_STATEMENT).toContain(ageEligibility());
    const earlier = await ctx.app.inject({
      method: 'POST',
      url: '/api/applications',
      remoteAddress: nextVisitor(),
      payload: { ...validPayload({ email: 'earlier.form@example.org', consentVersion: '2026-09-v1' }), ...(await listed(FIXTURE.grace)) },
    });
    expect(earlier.statusCode).toBe(201);
  });
});

describe('POST /api/applications: age by the parish’s continent', () => {
  it('takes 31–35 in Continent 1 but not 36–40', async () => {
    const ok = await submit('31_35', await listed(FIXTURE.jesusRivers));
    expect(ok.statusCode).toBe(201);
    expect(await storedAge(ok.json().id)).toBe('31_35');
    const over = await submit('36_40', await listed(FIXTURE.jesusRivers));
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { ageRange: ageLimitMessage('CONTINENT 1') } });
  });

  it('takes 36–40 in Continents 2 and 11', async () => {
    const central = await submit('36_40', await listed(FIXTURE.central));
    expect(central.statusCode).toBe(201);
    expect(await storedAge(central.json().id)).toBe('36_40');
    expect((await submit('36_40', await listed(NORTH.parish))).statusCode).toBe(201);
  });

  it('keeps 18–30 in every other continent', async () => {
    expect((await submit('28_30', await listed(FIXTURE.grace))).statusCode).toBe(201);
    const over = await submit('31_35', await listed(FIXTURE.grace));
    expect(over.statusCode).toBe(400);
    expect(over.json().fieldErrors).toEqual({ ageRange: ageLimitMessage('CONTINENT 3') });
  });

  it('uses the place chosen for a parish that isn’t listed, and 30 when there is none', async () => {
    const placed = await submit('36_40', { parish: { kind: 'not_listed', name: 'New Hope Chapel', unitId: await unitId(NORTH.province) } });
    expect(placed.statusCode).toBe(201);
    const anywhere = await submit('31_35', { parish: { kind: 'not_listed', name: 'New Hope Chapel' } });
    expect(anywhere.statusCode).toBe(400);
    expect(anywhere.json().fieldErrors).toEqual({ ageRange: ageLimitMessage(null) });
  });

  it('takes the standard limit while the parish question is typed text (directory off)', async () => {
    await setDirectory(false);
    expect((await submit('28_30', {})).statusCode).toBe(201);
    const over = await submit('36_40', {});
    expect(over.statusCode).toBe(400);
    expect(over.json().fieldErrors).toEqual({ ageRange: ageLimitMessage(null) });
  });
});
