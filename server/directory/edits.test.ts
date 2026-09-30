import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '../db';
import { migrate } from '../migrate';
import { searchParishes } from '../parishes';
import { createParish, createUnit, mergeParish, mergeUnit, splitParish, updateParish, updateUnit } from './edits';
import { planImport } from './plan';
import type { SourceRow } from './source';
import { applyPlan, checkConsistency, DirectoryError, loadSnapshot, revertImport } from './store';

let db: Db;
let staffId: string;
beforeEach(async () => {
  db = await createPgliteDb('memory://');
  await migrate(db);
  // Only needed as the author of the changes (an invitation is enough: no password involved).
  staffId = (await db.query<{ id: string }>(`insert into staff_users (email, display_name, role, status) values ('editor@example.org', 'Editor', 'owner', 'invited') returning id`)).rows[0]!.id;
});
afterEach(async () => {
  await db.close();
});

let line = 1;
const row = (continent: string, region: string, province: string, parish: string): SourceRow => ({ line: ++line, continent, region, province, parish });

const LIST = [
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'GRACE CHAPEL'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'GRACE CHAPEL'),
  row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 2', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 2', 'HOUSE OF PRAYER'),
  row('CONTINENT 3', 'REGION 19', 'REGION 19', 'TRINITY SANCTUARY'),
];

const CONSISTENT = { chainMismatches: 0, searchMismatches: 0, activeUnderInactive: 0, unitsUnderInactive: 0 };

async function importRows(rows: SourceRow[]) {
  const plan = planImport(rows, await loadSnapshot(db));
  const id = await applyPlan(db, plan, { source: 'spreadsheet', label: 'list.xlsx', checksum: null, structureAsAt: '2026-04-30', via: 'cli' });
  return { plan, id };
}

const unitId = async (name: string) => (await db.query<{ id: string }>(`select id from church_units where display_name = $1`, [name])).rows[0]!.id;
const parishId = async (name: string, unit: string) =>
  (await db.query<{ id: string }>(`select p.id from parishes p join church_units u on u.id = p.unit_id where p.display_name = $1 and u.display_name = $2`, [name, unit])).rows[0]!.id;

/** Every entry with this name: where it is, its cached province and region, and its status. */
const entries = async (name: string) =>
  (
    await db.query(
      `select p.id, u.display_name as unit, prov.display_name as province, reg.display_name as region, p.status::text as status
         from parishes p join church_units u on u.id = p.unit_id
         left join church_units prov on prov.id = p.province_id left join church_units reg on reg.id = p.region_id
        where p.display_name = $1 order by u.display_name`,
      [name],
    )
  ).rows;

const record = async (id: string) =>
  (
    await db.query(
      `select display_name, status::text as status, merged_into_id, source_unit_id, to_jsonb(staff_fields) as staff_fields, origin::text as origin
         from parishes where id = $1`,
      [id],
    )
  ).rows[0]!;

const overrides = (issues: { code: string; details: Record<string, unknown> }[]) =>
  issues.filter((issue) => issue.code === 'staff_override').map((issue) => issue.details);

describe('staff corrections to parishes', () => {
  it('keeps a new name through later imports, and search finds the parish by it', async () => {
    await importRows(LIST);
    const grace = await parishId('Grace Chapel', 'Lagos Province 3');
    expect(await updateParish(db, grace, { displayName: 'Grace Chapel, Ikeja' }, staffId)).toEqual(['display_name']);

    const { plan } = await importRows(LIST);
    expect(plan.parishes).toEqual([]);
    expect(overrides(plan.issues)).toEqual([{ name: 'Grace Chapel, Ikeja', fields: ['name'], unit: 'Lagos Province 3' }]);
    expect(await record(grace)).toMatchObject({ display_name: 'Grace Chapel, Ikeja', staff_fields: ['display_name'] });
    expect((await searchParishes(db, 'ikeja', null, 10, null)).results.map((result) => result.id)).toEqual([grace]);
    expect(await checkConsistency(db)).toEqual(CONSISTENT);
  });

  it('keeps a move: the parish keeps its ID where the list still places it, and a list that catches up changes nothing', async () => {
    await importRows(LIST);
    const prayer = await parishId('House of Prayer', 'Lagos Province 2');
    expect(await updateParish(db, prayer, { unitId: await unitId('Lagos Province 3') }, staffId)).toEqual(['unit_id']);
    expect(await entries('House of Prayer')).toEqual([{ id: prayer, unit: 'Lagos Province 3', province: 'Lagos Province 3', region: 'Region 54', status: 'active' }]);

    const { plan } = await importRows(LIST);
    expect(plan.counts.parishes).toMatchObject({ create: 0, move: 0, deactivate: 0 });
    expect(overrides(plan.issues)).toEqual([{ name: 'House of Prayer', fields: ['place'], unit: 'Lagos Province 2' }]);
    expect(await entries('House of Prayer')).toEqual([{ id: prayer, unit: 'Lagos Province 3', province: 'Lagos Province 3', region: 'Region 54', status: 'active' }]);

    const caughtUp = LIST.map((listed) => (listed.parish === 'HOUSE OF PRAYER' ? { ...listed, region: 'REGION 54', province: 'LAGOS PROVINCE 3' } : listed));
    const { plan: second } = await importRows(caughtUp);
    expect(second.counts.parishes).toMatchObject({ create: 0, move: 0, deactivate: 0 });
    expect(overrides(second.issues)).toEqual([]);
    expect((await entries('House of Prayer')).map((entry) => entry.id)).toEqual([prayer]);

    // Moving it back to where the list had it ends the correction.
    await updateParish(db, prayer, { unitId: await unitId('Lagos Province 2') }, staffId);
    expect(await record(prayer)).toMatchObject({ source_unit_id: null, staff_fields: [] });
  });

  it('refuses a move into a unit that already lists the name, pointing to a merge instead', async () => {
    await importRows(LIST);
    const jesus2 = await parishId('Jesus House', 'Lagos Province 2');
    await expect(updateParish(db, jesus2, { unitId: await unitId('Lagos Province 3') }, staffId)).rejects.toThrow(
      new DirectoryError('Lagos Province 3 already lists Jesus House. Merge the two parishes instead.'),
    );
  });

  it('keeps a status staff set: a deactivated parish stays off, a reactivated one stays on when the list drops it', async () => {
    await importRows(LIST);
    const trinity = await parishId('Trinity Sanctuary', 'Region 19');
    await updateParish(db, trinity, { status: 'inactive' }, staffId);
    const { plan } = await importRows(LIST);
    expect(await record(trinity)).toMatchObject({ status: 'inactive' });
    expect(overrides(plan.issues)).toEqual([{ name: 'Trinity Sanctuary', fields: ['status'], unit: 'Region 19' }]);

    await updateParish(db, trinity, { status: 'active' }, staffId);
    const { plan: dropped } = await importRows(LIST.filter((listed) => listed.parish !== 'TRINITY SANCTUARY'));
    expect(dropped.counts.parishes.deactivate).toBe(0);
    expect(await record(trinity)).toMatchObject({ status: 'active' });
  });

  it('merges a parish into another: its name finds the other, and imports count its rows there', async () => {
    await importRows(LIST);
    const jesus3 = await parishId('Jesus House', 'Lagos Province 3');
    const grace = await parishId('Grace Chapel', 'Lagos Province 3');
    await expect(mergeParish(db, grace, grace, staffId)).rejects.toThrow(/different parish/);
    expect(await mergeParish(db, grace, jesus3, staffId)).toEqual({ applicationsMoved: 0 });
    expect(await record(grace)).toMatchObject({ status: 'merged', merged_into_id: jesus3 });
    expect((await searchParishes(db, 'grace chapel', null, 10, null)).results.map((result) => result.id)).toEqual([jesus3]);

    const { plan } = await importRows(LIST);
    expect(plan.parishes).toEqual([]);
    expect(plan.issues.filter((issue) => issue.code === 'merged_entry')).toHaveLength(1);
    await expect(updateParish(db, grace, { displayName: 'Grace' }, staffId)).rejects.toThrow(/merged into another/);
  });

  it('splits a same-name entry into a second parish that imports leave alone', async () => {
    await importRows(LIST);
    const grace = await parishId('Grace Chapel', 'Lagos Province 3');
    await expect(splitParish(db, grace, 'GRACE CHAPEL', staffId)).rejects.toThrow(/already lists Grace Chapel/);
    const annex = await splitParish(db, grace, 'Grace Chapel Annex', staffId);
    expect(await record(annex)).toMatchObject({ display_name: 'Grace Chapel Annex', status: 'active', origin: 'staff' });
    const { rows } = await db.query(`select change, after from directory_changes where entity_id = $1`, [annex]);
    expect(rows).toEqual([{ change: 'create', after: expect.objectContaining({ split_from: grace }) }]);

    const { plan } = await importRows(LIST);
    expect(plan.counts.parishes.deactivate).toBe(0);
    expect(await record(annex)).toMatchObject({ status: 'active' });
  });

  it('adds a parish only to an active unit, under a name the unit doesn’t list yet', async () => {
    await importRows(LIST);
    const lagos3 = await unitId('Lagos Province 3');
    await expect(createParish(db, { unitId: lagos3, name: 'RCCG Jesus House Parish' }, staffId)).rejects.toThrow(/already lists Jesus House/);
    await expect(createParish(db, { unitId: lagos3, name: ' ' }, staffId)).rejects.toThrow(/Enter the parish's name/);
    const id = await createParish(db, { unitId: lagos3, name: 'Glory Tabernacle' }, staffId);
    expect(await entries('Glory Tabernacle')).toEqual([{ id, unit: 'Lagos Province 3', province: 'Lagos Province 3', region: 'Region 54', status: 'active' }]);
  });
});

describe('staff corrections to units', () => {
  it('adds, moves and sets a state, and imports keep the corrections', async () => {
    await importRows(LIST);
    const continent3 = await unitId('Continent 3');
    await expect(createUnit(db, { level: 'region', name: 'REGION 54', parentId: continent3 }, staffId)).rejects.toThrow('There is already a region called Region 54.');
    await expect(createUnit(db, { level: 'region', name: 'Region 70', parentId: null }, staffId)).rejects.toThrow(/Choose the unit this region sits under/);
    const region70 = await createUnit(db, { level: 'region', name: 'Region 70', parentId: continent3 }, staffId);
    const lagos3 = await unitId('Lagos Province 3');
    await expect(createUnit(db, { level: 'province', name: 'Lagos Province 200', parentId: lagos3 }, staffId)).rejects.toThrow(/only sit under a level above it/);

    expect(await updateUnit(db, lagos3, { parentId: region70 }, staffId)).toEqual(['parent']);
    expect((await entries('Grace Chapel'))[0]).toMatchObject({ province: 'Lagos Province 3', region: 'Region 70' });
    expect(await updateUnit(db, lagos3, { state: 'Ogun', displayName: 'Lagos Province 3 (Ikeja)' }, staffId)).toEqual(['display_name', 'state']);
    await expect(updateUnit(db, region70, { state: 'Lagos' }, staffId)).rejects.toThrow('Only provinces have a state.');

    const { plan } = await importRows(LIST);
    expect(plan.units).toEqual([]);
    expect(overrides(plan.issues)).toEqual([{ name: 'Lagos Province 3 (Ikeja)', fields: ['name', 'parent', 'state'] }]);
    expect((await entries('Jesus House')).find((entry) => entry.unit === 'Lagos Province 3 (Ikeja)')).toMatchObject({ region: 'Region 70' });
    expect(await checkConsistency(db)).toEqual(CONSISTENT);
  });

  it('merges a unit: parishes move across, same names merge, and the next import changes nothing', async () => {
    await importRows(LIST);
    const lagos2 = await unitId('Lagos Province 2');
    const lagos3 = await unitId('Lagos Province 3');
    const jesus2 = await parishId('Jesus House', 'Lagos Province 2');
    const jesus3 = await parishId('Jesus House', 'Lagos Province 3');
    await expect(mergeUnit(db, lagos2, await unitId('Region 54'), staffId)).rejects.toThrow('A province can only be merged into another province.');
    expect(await mergeUnit(db, lagos2, lagos3, staffId)).toEqual({ unitsMoved: 0, parishesMoved: 1, parishesMerged: 1, applicationsMoved: 0 });
    expect(await record(jesus2)).toMatchObject({ status: 'merged', merged_into_id: jesus3 });
    expect(await entries('House of Prayer')).toEqual([expect.objectContaining({ unit: 'Lagos Province 3', region: 'Region 54', status: 'active' })]);
    expect(await checkConsistency(db)).toEqual(CONSISTENT);

    const { plan } = await importRows(LIST);
    expect(plan.parishes).toEqual([]);
    expect(overrides(plan.issues)).toEqual([]);
    expect(await checkConsistency(db)).toEqual(CONSISTENT);
  });
});

describe('safeguards', () => {
  it('won’t revert an import once staff have corrected the directory since', async () => {
    const { id } = await importRows(LIST);
    await updateParish(db, await parishId('Grace Chapel', 'Lagos Province 3'), { displayName: 'Grace' }, staffId);
    await expect(revertImport(db, id)).rejects.toThrow('Staff have changed the directory since this import, so it can’t be reverted automatically.');
  });

  it('records every correction with the fields before and after, and audits IDs only', async () => {
    await importRows(LIST);
    const grace = await parishId('Grace Chapel', 'Lagos Province 3');
    await updateParish(db, grace, { displayName: 'Grace Chapel, Ikeja' }, staffId);
    await updateParish(db, grace, { status: 'inactive' }, staffId);
    const { rows } = await db.query(`select via, change, before, after, staff_id from directory_changes where entity_id = $1 and via = 'staff' order by id`, [grace]);
    expect(rows).toEqual([
      { via: 'staff', change: 'update', before: { display_name: 'Grace Chapel' }, after: { display_name: 'Grace Chapel, Ikeja' }, staff_id: staffId },
      { via: 'staff', change: 'deactivate', before: { status: 'active' }, after: { status: 'inactive' }, staff_id: staffId },
    ]);
    const audit = await db.query<{ action: string; details: unknown }>(`select action, details from audit_events where action like 'directory.parish%'`);
    expect(audit.rows.map((event) => event.action)).toEqual(['directory.parish_updated', 'directory.parish_updated']);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Grace|Ikeja/);
  });

  it('refuses a reactivation under an inactive unit, changing nothing', async () => {
    await importRows(LIST);
    const trinity = await parishId('Trinity Sanctuary', 'Region 19');
    await updateParish(db, trinity, { status: 'inactive' }, staffId);
    await db.query(`update church_units set status = 'inactive' where display_name = 'Region 19'`); // as a later import would
    await db.query(`update church_units set status = 'inactive' where display_name = 'Lagos Province 2'`);
    await db.query(`update parishes set status = 'inactive' where unit_id = (select id from church_units where display_name = 'Lagos Province 2')`);
    await expect(updateParish(db, trinity, { status: 'active' }, staffId)).rejects.toThrow(/no longer active. Move the parish first/);
    expect(await record(trinity)).toMatchObject({ status: 'inactive' });
  });
});
