import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHURCH_LEVELS } from '../../src/shared/directory';
import { createPgliteDb, type Db } from '../db';
import { migrate } from '../migrate';
import { planImport, planIsEmpty, type Plan } from './plan';
import { rowsSource, spreadsheetSource, type DirectorySource } from './source';
import { applyPlan, checkConsistency, DirectoryError, loadSnapshot, revertImport, saveLineage } from './store';
import { buildXlsx, type FixtureCell } from './test-xlsx';

let db: Db;
beforeEach(async () => {
  db = await createPgliteDb('memory://');
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

// The attendance column is in the file, as in the RCCG list, and must never reach the database.
const HEADER = ['CONTINENT', 'REGION', 'PROVINCE', 'PARISH', 'AVG(SEP-25 & APR-26)'];
const LIST: FixtureCell[][] = [
  ['CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE', 975318641],
  ['CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'DIVINE FAVOUR', 975318642],
  ['CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'RCCG DIVINE FAVOUR PARISH', 975318643],
  ['CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 2', 'JESUS HOUSE', 975318644],
  ['CONTINENT 3', 'REGION 19', 'REGION 19', 'TRINITY SANCTUARY', 975318645],
  ['CONTINENT 1', 'CONTINENT 1', 'CONTINENT 1', 'CONTINENT HQ', 975318646],
];

const CONSISTENT = { chainMismatches: 0, searchMismatches: 0, activeUnderInactive: 0, unitsUnderInactive: 0 };

const sheet = (rows: FixtureCell[][]) => spreadsheetSource('list.xlsx', buildXlsx([{ name: 'List', rows: [HEADER, ...rows] }]));

async function importFrom(source: DirectorySource, target: Db = db): Promise<{ plan: Plan; id: string }> {
  const { rows } = await source.read();
  const plan = planImport(rows, await loadSnapshot(target));
  const id = await applyPlan(target, plan, {
    source: source.kind,
    label: source.label,
    checksum: source.checksum,
    structureAsAt: '2026-04-30',
    via: 'cli',
  });
  return { plan, id };
}

/** Every parish with its unit and cached chain, by name: comparable across databases. */
async function directory(target: Db = db) {
  const { rows } = await target.query(
    `select pr.display_name as parish, pr.status::text as status, pr.listed_rows, u.display_name as unit,
            c.display_name as continent, r.display_name as region, p.display_name as province
       from parishes pr
       join church_units u on u.id = pr.unit_id
       left join church_units c on c.id = pr.continent_id
       left join church_units r on r.id = pr.region_id
       left join church_units p on p.id = pr.province_id
      order by pr.display_name, u.display_name`,
  );
  return rows;
}

/** Everything an import can change, including IDs and aliases. */
async function state(target: Db = db) {
  const units = await target.query('select id, level::text, official_name, display_name, parent_id, state, status::text from church_units order by id');
  const parishes = await target.query(
    'select id, unit_id, official_name, display_name, listed_rows, status::text, continent_id, region_id, province_id from parishes order by id',
  );
  const aliases = await target.query('select parish_id, alias from parish_aliases order by parish_id, alias');
  return { units: units.rows, parishes: parishes.rows, aliases: aliases.rows };
}

describe('the directory tables', () => {
  it('store the levels in the order src/shared/directory.ts lists them', async () => {
    const sql = await readFile(new URL('../migrations/0006_parish_directory.sql', import.meta.url), 'utf8');
    const values = /create type church_level as enum \(([^)]*)\)/.exec(sql)![1]!.match(/'([a-z]+)'/g)!.map((value) => value.slice(1, -1));
    expect(values).toEqual([...CHURCH_LEVELS]);
  });

  it('refuse a unit placed under a lower level', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into church_units (level, official_name, display_name, name_key) values ('province', 'P', 'P', 'P') returning id`);
    await expect(
      db.query(`insert into church_units (level, official_name, display_name, name_key, parent_id, parent_level) values ('region', 'R', 'R', 'R', $1, 'province')`, [rows[0]!.id]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(`insert into church_units (level, official_name, display_name, name_key, parent_id, parent_level) values ('area', 'A', 'A', 'A', $1, 'zone')`, [rows[0]!.id]),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('applying an import', () => {
  it('creates the directory in one go, with every chain cached and nothing else from the file', async () => {
    const { plan, id } = await importFrom(sheet(LIST));
    expect(plan.counts).toMatchObject({ rows: 6, entries: 5, duplicateGroups: 1, noProvince: 2 });
    expect(await directory()).toEqual([
      { parish: 'Continent HQ', status: 'active', listed_rows: 1, unit: 'Continent 1', continent: 'Continent 1', region: null, province: null },
      { parish: 'Divine Favour', status: 'active', listed_rows: 2, unit: 'Lagos Province 3', continent: 'Continent 3', region: 'Region 54', province: 'Lagos Province 3' },
      { parish: 'Jesus House', status: 'active', listed_rows: 1, unit: 'Lagos Province 2', continent: 'Continent 3', region: 'Region 19', province: 'Lagos Province 2' },
      { parish: 'Jesus House', status: 'active', listed_rows: 1, unit: 'Lagos Province 3', continent: 'Continent 3', region: 'Region 54', province: 'Lagos Province 3' },
      { parish: 'Trinity Sanctuary', status: 'active', listed_rows: 1, unit: 'Region 19', continent: 'Continent 3', region: 'Region 19', province: null },
    ]);
    expect(await checkConsistency(db)).toEqual(CONSISTENT);

    const record = (await db.query(`select status::text as status, structure_as_at::text as as_at, source::text as source, counts from directory_imports where id = $1`, [id])).rows[0]!;
    expect(record).toMatchObject({ status: 'applied', as_at: '2026-04-30', source: 'spreadsheet', counts: { rows: 6, entries: 5 } });
    const audit = (await db.query(`select action, details from audit_events where target_id = $1`, [id])).rows;
    expect(audit).toEqual([{ action: 'directory.imported', details: expect.objectContaining({ rows: 6, entries: 5 }) }]);
    expect(JSON.stringify(audit)).not.toMatch(/JESUS|Jesus/);

    const everything = await db.query<{ text: string }>(
      `select string_agg(t, ' ') as text from (
         select row_to_json(x)::text as t from church_units x union all
         select row_to_json(x)::text from parishes x union all
         select row_to_json(x)::text from parish_aliases x union all
         select row_to_json(x)::text from directory_imports x union all
         select row_to_json(x)::text from directory_issues x union all
         select row_to_json(x)::text from directory_changes x) all_rows`,
    );
    expect(everything.rows[0]!.text).not.toMatch(/97531864\d|AVG/);
  });

  it('changes nothing when the same file comes again', async () => {
    await importFrom(sheet(LIST));
    const before = await state();
    const { plan } = await importFrom(sheet(LIST));
    expect(planIsEmpty(plan)).toBe(true);
    expect(await state()).toEqual(before);
  });

  it('gives the same directory from an API source as from the spreadsheet', async () => {
    await importFrom(sheet(LIST));
    const other = await createPgliteDb('memory://');
    try {
      await migrate(other);
      const { rows } = await sheet(LIST).read();
      await importFrom(rowsSource('RCCG API sync', rows), other);
      expect(await directory(other)).toEqual(await directory());
      expect((await other.query(`select source::text as source from directory_imports`)).rows).toEqual([{ source: 'api' }]);
    } finally {
      await other.close();
    }
  });

  it('keeps a parish that moved to a new province, and reverts the import exactly', async () => {
    const { id: firstImport } = await importFrom(sheet(LIST));
    const afterFirst = await state();
    const jesus2 = (await db.query<{ id: string }>(`select p.id from parishes p join church_units u on u.id = p.unit_id where u.name_key = 'LAGOS PROVINCE 2'`)).rows[0]!.id;

    expect(
      await saveLineage(db, [
        { level: 'province', newKey: 'LAGOS PROVINCE 135', newName: 'LAGOS PROVINCE 135', sourceLevel: 'province', sourceKey: 'LAGOS PROVINCE 2', sourceName: 'LAGOS PROVINCE 2', approvedOn: '2026-08-17' },
      ]),
    ).toBe(1);
    const changed: FixtureCell[][] = [
      ['CONTINENT 3', 'REGION 70', 'LAGOS PROVINCE 3', 'Jesus House Parish', 1], // new spelling, province moved to a new region
      ['CONTINENT 3', 'REGION 70', 'LAGOS PROVINCE 3', 'DIVINE FAVOUR', 2],
      ['CONTINENT 3', 'REGION 70', 'LAGOS PROVINCE 3', 'NEW LIFE', 3], // new parish
      ['CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 135', 'JESUS HOUSE', 4], // moved from Lagos Province 2
      ['CONTINENT 1', 'CONTINENT 1', 'CONTINENT 1', 'CONTINENT HQ', 5],
    ]; // Trinity Sanctuary is gone
    const { plan, id: secondImport } = await importFrom(sheet(changed));
    expect(plan.counts.parishes).toMatchObject({ create: 1, move: 1, update: 2, deactivate: 1, unchanged: 1 });
    expect(plan.counts.units).toMatchObject({ create: 2, move: 1, deactivate: 2, unchanged: 3 });
    expect(await directory()).toEqual([
      { parish: 'Continent HQ', status: 'active', listed_rows: 1, unit: 'Continent 1', continent: 'Continent 1', region: null, province: null },
      { parish: 'Divine Favour', status: 'active', listed_rows: 1, unit: 'Lagos Province 3', continent: 'Continent 3', region: 'Region 70', province: 'Lagos Province 3' },
      { parish: 'Jesus House', status: 'active', listed_rows: 1, unit: 'Lagos Province 135', continent: 'Continent 3', region: 'Region 19', province: 'Lagos Province 135' },
      { parish: 'Jesus House Parish', status: 'active', listed_rows: 1, unit: 'Lagos Province 3', continent: 'Continent 3', region: 'Region 70', province: 'Lagos Province 3' },
      { parish: 'New Life', status: 'active', listed_rows: 1, unit: 'Lagos Province 3', continent: 'Continent 3', region: 'Region 70', province: 'Lagos Province 3' },
      { parish: 'Trinity Sanctuary', status: 'inactive', listed_rows: 1, unit: 'Region 19', continent: 'Continent 3', region: 'Region 19', province: null },
    ]);
    const moved = (await db.query<{ id: string }>(`select p.id from parishes p join church_units u on u.id = p.unit_id where u.name_key = 'LAGOS PROVINCE 135'`)).rows[0]!.id;
    expect(moved).toBe(jesus2);

    await expect(revertImport(db, firstImport)).rejects.toThrow(new DirectoryError('A later import has been applied since; revert that one first.'));
    expect(await revertImport(db, secondImport)).toEqual({
      units: { restored: 3, deleted: 2 },
      parishes: { restored: 4, deleted: 1 },
      aliases: 1,
    });
    expect(await state()).toEqual(afterFirst);
    expect(await checkConsistency(db)).toEqual(CONSISTENT);
    await expect(revertImport(db, secondImport)).rejects.toThrow(/only an applied import can be reverted/);

    await revertImport(db, firstImport);
    expect(await state()).toEqual({ units: [], parishes: [], aliases: [] });
  });

  it('changes nothing, and records the attempt, when the result would be inconsistent', async () => {
    await importFrom(sheet(LIST));
    const before = await state();
    const snapshot = await loadSnapshot(db);
    const lagos2 = snapshot.units.find((unit) => unit.name_key === 'LAGOS PROVINCE 2')!;
    const { official_name, display_name, parent_id, parent_level, state: unitState } = lagos2;
    const broken: Plan = {
      ...planImport([], snapshot),
      units: [
        {
          kind: 'deactivate',
          id: lagos2.id,
          level: 'province',
          name_key: lagos2.name_key,
          before: { official_name, display_name, parent_id, parent_level, state: unitState, status: 'active' },
          after: { official_name, display_name, parent_id, parent_level, state: unitState, status: 'inactive' },
        },
      ],
      parishes: [],
    };
    await expect(
      applyPlan(db, broken, { source: 'spreadsheet', label: 'broken.xlsx', checksum: null, structureAsAt: null, via: 'cli' }),
    ).rejects.toThrow(DirectoryError);
    expect(await state()).toEqual(before);
    expect((await db.query(`select status::text as status, error from directory_imports where source_label = 'broken.xlsx'`)).rows).toEqual([
      { status: 'failed', error: expect.stringContaining('inconsistent') },
    ]);
  });

  it('saves each lineage link once', async () => {
    const link = { level: 'province' as const, newKey: 'OYO PROVINCE 25', newName: 'OYO PROVINCE 25', sourceLevel: 'province' as const, sourceKey: 'OYO PROVINCE 4', sourceName: 'OYO 4', approvedOn: null };
    expect(await saveLineage(db, [link])).toBe(1);
    expect(await saveLineage(db, [link])).toBe(0);
  });
});
