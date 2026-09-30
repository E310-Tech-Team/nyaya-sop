import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validPayload } from '../../src/shared/test-fixtures';
import { clearSettingsCache } from '../settings';
import { createTestContext, nextVisitor, type TestContext } from '../test-helpers';
import { createDirectoryApi, type DirectoryApi } from './api';
import { isFresh, syncDirectory, syncState } from './api-sync';
import { planImport } from './plan';
import type { SourceRow } from './source';
import { applyPlan, DirectoryError, loadSnapshot, revertImport } from './store';
import { BASE_RELEASE, FIXTURE, fakeDirectoryApi, SECOND_RELEASE, THIRD_RELEASE, type FakeDirectoryApi, type FakeRelease } from './test-api';

const KEY = 'fake-sync-key-0123456789-SECRET';
let ctx: TestContext;
let fake: FakeDirectoryApi;
let api: DirectoryApi;

function provider(releases: FakeRelease[]) {
  fake = fakeDirectoryApi({ key: KEY, releases });
  api = createDirectoryApi({ env: 'sandbox', key: KEY, fetch: fake.fetch, sleep: async () => {} });
}

beforeEach(async () => {
  ctx = await createTestContext();
  provider([BASE_RELEASE]);
});
afterEach(async () => {
  await ctx.close();
});

const unitOf = async (uuid: string) =>
  (await ctx.db.query(`select id, display_name, status::text as status, external_id from church_units where external_uuid = $1`, [uuid])).rows[0];
const parishOf = async (uuid: string) =>
  (
    await ctx.db.query<Record<string, unknown>>(
      `select p.id, p.display_name, p.status::text as status, p.external_id,
              (select display_name from church_units where id = p.province_id) as province,
              (select display_name from church_units where id = p.region_id) as region,
              (select display_name from church_units where id = p.continent_id) as continent
         from parishes p where p.external_uuid = $1`,
      [uuid],
    )
  ).rows[0]!;
const counts = async () =>
  (
    await ctx.db.query<{ units: number; parishes: number; changes: number }>(
      `select (select count(*)::int from church_units) as units, (select count(*)::int from parishes) as parishes,
              (select count(*)::int from directory_changes) as changes`,
    )
  ).rows[0]!;

describe('syncing the directory from the RCCG directory API', () => {
  it('builds it from the base release, each entry identified by its code in the environment’s namespace', async () => {
    const result = await syncDirectory(ctx.db, api);
    expect(result).toMatchObject({ status: 'applied', release: 'SANDBOX.1', counts: { units: { created: 10 }, parishes: { created: 8 }, issues: 0, handover: null } });

    // Effective at midnight in Lagos (2026-08-16T23:00Z): the structure is as at the 17th, not the UTC date.
    expect((await ctx.db.query(`select structure_as_at::text as day from directory_imports where source = 'api'`)).rows).toEqual([{ day: '2026-08-17' }]);
    // The intercontinental level above continents has no place in the site's hierarchy: continents are the top.
    expect(await unitOf(FIXTURE.root)).toBeUndefined();
    expect(await unitOf(FIXTURE.continent3)).toMatchObject({ display_name: 'Continent 3', status: 'active', external_id: 'rccg-org:sandbox:SANDBOX-C3' });
    expect(await parishOf(FIXTURE.jesusLagos3A)).toMatchObject({ display_name: 'Jesus House', province: 'Lagos Province 3', region: 'Region 54', continent: 'Continent 3', external_id: 'rccg-org:sandbox:SANDBOX-1002' });
    // Two parishes of one name in one province stay two parishes.
    expect((await parishOf(FIXTURE.jesusLagos3B)).id).not.toBe((await parishOf(FIXTURE.jesusLagos3A)).id);
    // Levels the provider skips stay skipped: nothing is filled in.
    expect(await parishOf(FIXTURE.abundance)).toMatchObject({ province: null, region: 'Region 14', continent: 'Continent 3' });
    expect(await parishOf(FIXTURE.central)).toMatchObject({ province: null, region: null, continent: 'Continent 2' });

    const state = await syncState(ctx.db, 'rccg-org:sandbox');
    expect(state).toMatchObject({ releaseVersion: 'SANDBOX.1', releaseName: 'Sandbox base list', failures: 0, lastError: null });
    expect(isFresh(state, 24)).toBe(true);
    expect(isFresh(state, 24, new Date(Date.parse(state!.checkedAt!) + 25 * 3_600_000))).toBe(false);
  });

  it('is idempotent: the same release again changes nothing and duplicates nothing', async () => {
    await syncDirectory(ctx.db, api);
    const before = await counts();
    fake.calls.length = 0;
    expect(await syncDirectory(ctx.db, api)).toEqual({ status: 'current', namespace: 'rccg-org:sandbox', release: 'SANDBOX.1' });
    expect(fake.calls).toEqual(['/releases/latest']); // releases are kept: nothing is downloaded again
    const forced = await syncDirectory(ctx.db, api, { force: true });
    expect(forced).toMatchObject({ status: 'applied', counts: { units: { created: 0, unchanged: 10 }, parishes: { created: 0, unchanged: 8 }, fetchedReleases: 0 } });
    expect(await counts()).toEqual(before);
  });

  it('applies a new release, fetching only it: moves, renames, retirements and new parishes keep each entry’s ID', async () => {
    await syncDirectory(ctx.db, api);
    const grace = await parishOf(FIXTURE.grace);
    const rivers = await parishOf(FIXTURE.jesusRivers);
    provider([BASE_RELEASE, SECOND_RELEASE]);
    const result = await syncDirectory(ctx.db, api);
    expect(result).toMatchObject({ status: 'applied', release: 'SANDBOX.2', counts: { fetchedReleases: 1, parishes: { created: 1, moved: 1, updated: 1, deactivated: 1 } } });
    expect(fake.calls.filter((call) => call.includes('/changes'))).toEqual(['/releases/SANDBOX.2/changes?page=1&per_page=200']);

    expect(await parishOf(FIXTURE.grace)).toMatchObject({ id: grace.id, province: 'Lagos Province 2', region: 'Region 19' });
    expect(await parishOf(FIXTURE.prayer)).toMatchObject({ display_name: 'House of Prayer Chapel', status: 'active' });
    // Retired: kept (applications may point at it), no longer offered.
    expect(await parishOf(FIXTURE.jesusRivers)).toMatchObject({ id: rivers.id, status: 'inactive' });
    expect(await parishOf(FIXTURE.newDawn)).toMatchObject({ province: 'Lagos Province 3', status: 'active' });
    const log = await ctx.db.query(`select change, entity from directory_changes where import_id = $1 order by change`, [result.status === 'applied' ? result.importId : '']);
    expect(log.rows).toEqual([
      { change: 'create', entity: 'parish' },
      { change: 'deactivate', entity: 'parish' },
      { change: 'move', entity: 'parish' },
      { change: 'update', entity: 'parish' },
    ]);
  });

  it('retires a unit with its parishes, and places a parish under a new province', async () => {
    provider([BASE_RELEASE, SECOND_RELEASE, THIRD_RELEASE]);
    expect(await syncDirectory(ctx.db, api)).toMatchObject({ status: 'applied', release: 'SANDBOX.3', counts: { fetchedReleases: 3 } });
    expect(await unitOf(FIXTURE.region14)).toMatchObject({ status: 'inactive' });
    expect(await parishOf(FIXTURE.abundance)).toMatchObject({ status: 'inactive' });
    expect(await parishOf(FIXTURE.jesusLagos3B)).toMatchObject({ province: 'Lagos Province 135', region: 'Region 54', status: 'active' });
  });

  it('takes an entry out of use only when a release retires it: one the releases stop describing is kept and reported', async () => {
    await syncDirectory(ctx.db, api);
    // A release moves a province under a unit it never gives: the province (and so its parish) can't
    // be placed. They were in use; nothing says they closed, so they stay as they were.
    const broken: FakeRelease = { ...SECOND_RELEASE, changes: [{ type: 'moved', id: FIXTURE.lagos2, fromParentId: FIXTURE.region19, toParentId: '00000000-0000-4000-8000-000000008888' }] };
    provider([BASE_RELEASE, broken]);
    expect(await syncDirectory(ctx.db, api)).toMatchObject({
      status: 'applied',
      counts: { units: { kept: 1, deactivated: 0 }, parishes: { kept: 1, deactivated: 0 }, issues: 2 },
    });
    expect(await unitOf(FIXTURE.lagos2)).toMatchObject({ status: 'active' });
    expect(await parishOf(FIXTURE.jesusLagos2)).toMatchObject({ status: 'active', province: 'Lagos Province 2', region: 'Region 19' });
    const issues = async (release: string) =>
      (
        await ctx.db.query(
          `select i.code, i.details->>'code' as code_of from directory_issues i join directory_imports d on d.id = i.import_id
            where d.source_label like $1 order by 2`,
          [`%release ${release}`],
        )
      ).rows;
    expect(await issues('SANDBOX.2')).toEqual([
      { code: 'missing_parent', code_of: 'SANDBOX-1006' },
      { code: 'missing_parent', code_of: 'SANDBOX-P402' },
    ]);

    // The provider starts a new chain that leaves a parish out: an absence, not a retirement.
    const restarted: FakeRelease = {
      ...BASE_RELEASE,
      id: '00000000-0000-4000-8000-000000009009',
      versionCode: 'SANDBOX.9',
      changes: BASE_RELEASE.changes.filter((change) => change.id !== FIXTURE.central),
    };
    provider([BASE_RELEASE, broken, restarted]);
    expect(await syncDirectory(ctx.db, api)).toMatchObject({ status: 'applied', release: 'SANDBOX.9', counts: { parishes: { kept: 1, deactivated: 0 } } });
    expect(await parishOf(FIXTURE.central)).toMatchObject({ status: 'active' });
    expect(await issues('SANDBOX.9')).toEqual([{ code: 'not_in_releases', code_of: 'SANDBOX-1008' }]);
    // Placed again by the new chain, the province is back in step (it never left its region here).
    expect(await unitOf(FIXTURE.lagos2)).toMatchObject({ status: 'active' });
  });

  it('keeps the last good state when the provider fails or a release arrives incomplete', async () => {
    await syncDirectory(ctx.db, api);
    const before = await counts();
    provider([BASE_RELEASE, SECOND_RELEASE]);
    // The latest release answers; every attempt at its changes fails (all four the sync makes).
    api = createDirectoryApi({ env: 'sandbox', key: KEY, fetch: fakeFailingAfterLatest(fake, 4), sleep: async () => {} });
    expect(await syncDirectory(ctx.db, api)).toEqual({ status: 'failed', namespace: 'rccg-org:sandbox', error: 'api_unavailable' });
    expect(await counts()).toEqual(before);
    expect(await syncState(ctx.db, 'rccg-org:sandbox')).toMatchObject({ releaseVersion: 'SANDBOX.1', lastError: 'api_unavailable', failures: 1 });

    // A page that silently lost its rows: the counts don't add up, so nothing is applied or kept.
    api = createDirectoryApi({ env: 'sandbox', key: KEY, fetch: droppingItems(fake), sleep: async () => {} });
    expect(await syncDirectory(ctx.db, api)).toMatchObject({ status: 'failed', error: 'incomplete_release' });
    expect(await counts()).toEqual(before);
    expect((await ctx.db.query(`select count(*)::int as n from directory_releases where version_code = 'SANDBOX.2'`)).rows[0]).toEqual({ n: 0 });

    // Once the provider answers properly, the release goes in.
    provider([BASE_RELEASE, SECOND_RELEASE]);
    expect(await syncDirectory(ctx.db, api)).toMatchObject({ status: 'applied', release: 'SANDBOX.2' });
    expect(await syncState(ctx.db, 'rccg-org:sandbox')).toMatchObject({ releaseVersion: 'SANDBOX.2', lastError: null, failures: 0 });
  });

  it('records a refused key without retrying it', async () => {
    api = createDirectoryApi({ env: 'sandbox', key: 'not-the-right-key-0123', fetch: fake.fetch, sleep: async () => {} });
    expect(await syncDirectory(ctx.db, api)).toMatchObject({ status: 'failed', error: 'api_unauthorized' });
    expect(fake.calls).toEqual(['/releases/latest']);
  });

  it('reports a parish whose unit the provider doesn’t give, without making one up', async () => {
    const orphan: FakeRelease = {
      ...SECOND_RELEASE,
      changes: [{ type: 'created', id: '00000000-0000-4000-8000-000000009999', code: 'SANDBOX-9999', level: 'parish', name: 'ORPHAN PARISH', parentId: '00000000-0000-4000-8000-000000008888' }],
    };
    provider([BASE_RELEASE, orphan]);
    const result = await syncDirectory(ctx.db, api);
    expect(result).toMatchObject({ status: 'applied', counts: { issues: 1, parishes: { created: 8 } } });
    const issues = await ctx.db.query(`select code, details->>'code' as code_of from directory_issues`);
    expect(issues.rows).toEqual([{ code: 'missing_parent', code_of: 'SANDBOX-9999' }]);
    expect((await ctx.db.query(`select count(*)::int as n from parishes where external_uuid = '00000000-0000-4000-8000-000000009999'`)).rows[0]).toEqual({ n: 0 });
  });

  it('never stores the key: not in the sync state, the import records or the issues', async () => {
    api = createDirectoryApi({ env: 'sandbox', key: KEY, fetch: fake.fetch, sleep: async () => {} });
    await syncDirectory(ctx.db, api);
    fake.failures.push({ status: 401 });
    await syncDirectory(ctx.db, api, { force: true });
    const stored = await ctx.db.query(
      `select (select coalesce(string_agg(t::text, ' '), '') from directory_sync t) || (select coalesce(string_agg(t::text, ' '), '') from directory_imports t)
              || (select coalesce(string_agg(t::text, ' '), '') from directory_issues t) as everything`,
    );
    expect(String(stored.rows[0]!.everything)).not.toContain(KEY);
  });
});

describe('handing over from the spreadsheet list', () => {
  let line = 1;
  const row = (continent: string, region: string, province: string, parish: string): SourceRow => ({ line: ++line, continent, region, province, parish });
  const LIST = [
    row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE'),
    row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'GRACE CHAPEL'),
    row('CONTINENT 12', 'REGION 21', 'OYO PROVINCE 6', 'REHOBOTH'),
  ];

  async function legacyApplications() {
    const plan = planImport(LIST, await loadSnapshot(ctx.db));
    const importId = await applyPlan(ctx.db, plan, { source: 'spreadsheet', label: 'rccg.xlsx', checksum: null, structureAsAt: '2026-04-30', via: 'cli' });
    await ctx.db.query(`insert into app_settings (key, value) values ('parish_directory_enabled', 'true'::jsonb)`);
    clearSettingsCache();
    const idOf = async (name: string) => (await ctx.db.query<{ id: string }>(`select id from parishes where display_name = $1`, [name])).rows[0]!.id;
    const submit = async (name: string, email: string) => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/applications',
        remoteAddress: nextVisitor(),
        payload: { ...validPayload({ email }), parish: { kind: 'listed', id: await idOf(name), confirmed: true } },
      });
      expect(response.statusCode).toBe(201);
      return response.json().id as string;
    };
    return {
      importId,
      jesus: await submit('Jesus House', 'legacy.jesus@example.org'),
      grace: await submit('Grace Chapel', 'legacy.grace@example.org'),
      rehoboth: await submit('Rehoboth', 'legacy.rehoboth@example.org'),
    };
  }

  const linkOf = async (applicationId: string) =>
    (await ctx.db.query(`select parish_id, parish_status::text as parish_status, parish_snapshot from applications where id = $1`, [applicationId])).rows[0];

  it('stops using the old entries, keeps every application’s link and snapshot, and reports possible matches for staff', async () => {
    const apps = await legacyApplications();
    const before = { jesus: await linkOf(apps.jesus), grace: await linkOf(apps.grace), rehoboth: await linkOf(apps.rehoboth) };

    const result = await syncDirectory(ctx.db, api);
    expect(result).toMatchObject({ status: 'applied', counts: { handover: { units: 6, parishes: 3, matched: 1, ambiguous: 1, unmatched: 1 } } });

    // Nothing relinked, nothing rewritten.
    expect({ jesus: await linkOf(apps.jesus), grace: await linkOf(apps.grace), rehoboth: await linkOf(apps.rehoboth) }).toEqual(before);
    // The old list no longer offers anything.
    expect((await ctx.db.query(`select count(*)::int as n from parishes where external_id is null and status = 'active'`)).rows[0]).toEqual({ n: 0 });
    expect((await ctx.db.query(`select count(*)::int as n from church_units where external_id is null and status = 'active'`)).rows[0]).toEqual({ n: 0 });

    const report = await ctx.db.query<{ name: string; status: string; candidates: string[]; applications: number }>(
      `select p.display_name as name, m.status::text as status, m.applications,
              array(select external_id from parishes where id = any (m.candidate_ids) order by external_id) as candidates
         from directory_legacy_matches m join parishes p on p.id = m.legacy_parish_id order by p.display_name`,
    );
    expect(report.rows).toEqual([
      { name: 'Grace Chapel', status: 'matched', applications: 1, candidates: ['rccg-org:sandbox:SANDBOX-1004'] },
      // Two parishes of that name in that province: which one is for staff to decide.
      { name: 'Jesus House', status: 'ambiguous', applications: 1, candidates: ['rccg-org:sandbox:SANDBOX-1002', 'rccg-org:sandbox:SANDBOX-1003'] },
      { name: 'Rehoboth', status: 'unmatched', applications: 1, candidates: [] },
    ]);

    // The old list can't come back over the API's entries, and an API sync isn't something to revert.
    await expect(applyPlan(ctx.db, planImport(LIST, await loadSnapshot(ctx.db)), { source: 'spreadsheet', label: 'again.xlsx', checksum: null, structureAsAt: null, via: 'cli' })).rejects.toThrow(DirectoryError);
    await expect(revertImport(ctx.db, (result as { importId: string }).importId)).rejects.toThrow(/can’t be reverted/);
  });
});

/** The provider's fetch, but every changes request after the first `/releases/latest` fails with 500 (`times` times). */
function fakeFailingAfterLatest(provider: FakeDirectoryApi, times: number): typeof fetch {
  let left = times;
  return async (input, init) => {
    if (String(input).includes('/changes') && left > 0) {
      left--;
      return new Response(JSON.stringify({ success: false, message: 'Server error.' }), { status: 500 });
    }
    return provider.fetch(input, init);
  };
}

/** The provider's fetch, but each changes page arrives with no rows (as a truncated answer would). */
function droppingItems(provider: FakeDirectoryApi): typeof fetch {
  return async (input, init) => {
    const response = await provider.fetch(input, init);
    if (!String(input).includes('/changes')) return response;
    const body = await response.json();
    body.data.items = [];
    body.data.has_more = false;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
