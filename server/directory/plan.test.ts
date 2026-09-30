import { describe, expect, it } from 'vitest';
import { parishKey, unitKey } from '../../src/shared/directory';
import { planImport, planIsEmpty, type ParishRecord, type Plan, type Snapshot, type UnitRecord } from './plan';
import type { SourceRow } from './source';

const EMPTY: Snapshot = { units: [], parishes: [], aliases: [], lineage: [] };

let counter = 0;
const ids = () => `id-${++counter}`;

let line = 1;
const row = (continent: string, region: string, province: string, parish: string): SourceRow => ({ line: ++line, continent, region, province, parish });

/** What the directory looks like after applying the plan: the store's job, done in memory. */
function applied(before: Snapshot, plan: Plan): Snapshot {
  const units = new Map<string, UnitRecord>(before.units.map((unit) => [unit.id, { ...unit }]));
  for (const change of plan.units) {
    const existing = units.get(change.id);
    units.set(change.id, {
      ...(existing ?? { id: change.id, level: change.level, name_key: change.name_key, merged_into_id: null, origin: 'import' }),
      ...change.after,
    });
  }
  const parishes = new Map<string, ParishRecord>(before.parishes.map((parish) => [parish.id, { ...parish }]));
  for (const change of plan.parishes) {
    const existing = parishes.get(change.id);
    parishes.set(change.id, { ...(existing ?? { id: change.id, name_key: change.name_key, merged_into_id: null, origin: 'import' }), ...change.after });
  }
  return {
    units: [...units.values()],
    parishes: [...parishes.values()],
    aliases: [...before.aliases, ...plan.aliases.map(({ parish_id, alias }) => ({ parish_id, alias }))],
    lineage: before.lineage,
  };
}

const unitNamed = (snapshot: Snapshot, name: string) => snapshot.units.find((unit) => unit.name_key === unitKey(name))!;
const parishIn = (snapshot: Snapshot, unit: string, name: string) =>
  snapshot.parishes.find((parish) => parish.unit_id === unitNamed(snapshot, unit).id && parish.name_key === parishKey(name));

const LIST = [
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'RCCG, DIVINE FAVOUR PARISH'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'DIVINE FAVOUR'),
  row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', 'DIVINE FAVOUR'),
  row('CONTINENT 3', 'REGION 19', 'Lagos Province 2', 'JESUS HOUSE'),
  row('CONTINENT 3', 'REGION 19', 'REGION 19', 'TRINITY SANCTUARY'),
  row('CONTINENT 1', 'CONTINENT 1', 'CONTINENT 1', 'CONTINENT HQ'),
  row('CONTINENT 1', 'REGION 35', 'YOUTH PROVINCE 10', "GOD\\'S   GIFT &amp; GRACE"),
];

describe('planImport, first import', () => {
  const plan = planImport(LIST, EMPTY, ids);

  it('creates units parents first, recognising units whatever their capitals', () => {
    const created = plan.units.map((change) => `${change.level}:${change.after.display_name}`);
    expect(created).toEqual([
      'continent:Continent 3',
      'continent:Continent 1',
      'region:Region 54',
      'region:Region 19',
      'region:Region 35',
      'province:Lagos Province 3',
      'province:Lagos Province 2',
      'province:Youth Province 10',
    ]);
    expect(plan.counts.levels).toEqual({ continent: 2, region: 3, province: 3 });
    const lagos3 = plan.units.find((change) => change.after.display_name === 'Lagos Province 3')!;
    const region54 = plan.units.find((change) => change.after.display_name === 'Region 54')!;
    expect(lagos3.after).toMatchObject({ parent_id: region54.id, parent_level: 'region', state: 'Lagos' });
  });

  it('lists the same name in one unit once, keeping the other spellings as aliases', () => {
    expect(plan.counts).toMatchObject({ rows: 8, entries: 6, duplicateGroups: 1, duplicateRows: 3 });
    const favour = plan.parishes.find((change) => change.after.display_name === 'Divine Favour')!;
    expect(favour.after.listed_rows).toBe(3);
    expect(plan.aliases).toContainEqual({ parish_id: favour.id, alias: 'RCCG, DIVINE FAVOUR PARISH', alias_key: 'DIVINE FAVOUR' });
    expect(plan.issues.find((issue) => issue.code === 'duplicate_name')).toMatchObject({
      severity: 'warning',
      details: { unit: 'Lagos Province 3', name: 'Divine Favour', spellings: ['RCCG, DIVINE FAVOUR PARISH', 'DIVINE FAVOUR'] },
    });
  });

  it('attaches parishes without a province to their region or continent', () => {
    const after = applied(EMPTY, plan);
    expect(after.parishes.find((parish) => parish.official_name === 'TRINITY SANCTUARY')!.unit_id).toBe(unitNamed(after, 'REGION 19').id);
    expect(after.parishes.find((parish) => parish.official_name === 'CONTINENT HQ')!.unit_id).toBe(unitNamed(after, 'CONTINENT 1').id);
    expect(plan.counts.noProvince).toBe(2);
    expect(after.units.some((unit) => unit.name_key === 'REGION 19' && unit.level === 'province')).toBe(false);
  });

  it('cleans names and reports provinces with no state', () => {
    const gift = plan.parishes.find((change) => change.after.official_name.startsWith('GOD'))!;
    expect(gift.after).toMatchObject({ official_name: "GOD'S GIFT & GRACE", display_name: "God's Gift & Grace" });
    expect(plan.counts.cleaned).toEqual({ entities: 1, apostrophes: 1, spacing: 1 });
    expect(plan.counts.provincesWithoutState).toBe(1);
    expect(plan.issues.find((issue) => issue.code === 'province_without_state')?.details).toEqual({ province: 'Youth Province 10' });
  });

  it('skips rows with a missing value', () => {
    const result = planImport([row('CONTINENT 3', '', 'LAGOS PROVINCE 3', 'X'), row('CONTINENT 3', 'REGION 54', 'LAGOS PROVINCE 3', '  ')], EMPTY, ids);
    expect(result.counts).toMatchObject({ rows: 2, skippedRows: 2, entries: 0 });
    expect(result.issues.map((issue) => [issue.code, issue.severity, issue.details])).toEqual([
      ['missing_value', 'error', { missing: ['region'] }],
      ['missing_value', 'error', { missing: ['parish'] }],
    ]);
  });
});

describe('planImport, later imports', () => {
  const first = applied(EMPTY, planImport(LIST, EMPTY, ids));

  it('changes nothing when the same list comes again', () => {
    const plan = planImport(LIST, first, ids);
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.counts.parishes).toMatchObject({ unchanged: 6, create: 0, deactivate: 0 });
    expect(plan.counts.units).toMatchObject({ unchanged: 8, create: 0 });
  });

  it('deactivates what disappears and reactivates it when it returns', () => {
    const without = planImport(LIST.filter((entry) => entry.parish !== 'JESUS HOUSE'), first, ids);
    expect(without.parishes.filter((change) => change.kind === 'deactivate')).toHaveLength(2);
    // Lagos Province 2 has nothing else under it, so it goes too; its region doesn't (a parish sits directly under it).
    expect(without.units.map((change) => [change.kind, change.after.display_name])).toEqual([['deactivate', 'Lagos Province 2']]);
    const later = applied(first, without);
    const back = planImport(LIST, later, ids);
    expect(back.counts.parishes).toMatchObject({ reactivate: 2, create: 0 });
    expect(back.counts.units).toMatchObject({ reactivate: 1, create: 0 });
  });

  it('warns when a list would deactivate a large share of the directory', () => {
    const plan = planImport(LIST.slice(0, 2), first, ids);
    expect(plan.issues.find((issue) => issue.code === 'large_drop')?.details).toEqual({ deactivated: 4, active: 6 });
  });

  it('records a new spelling and keeps the old one as an alias', () => {
    const renamed = LIST.map((entry) => (entry.parish === 'JESUS HOUSE' && entry.region === 'REGION 54' ? { ...entry, parish: 'Jesus  House Parish' } : entry));
    const plan = planImport(renamed, first, ids);
    const jesus = parishIn(first, 'LAGOS PROVINCE 3', 'JESUS HOUSE')!;
    expect(plan.parishes).toEqual([
      expect.objectContaining({ kind: 'update', id: jesus.id, after: expect.objectContaining({ official_name: 'Jesus House Parish' }) }),
    ]);
    expect(plan.aliases).toEqual([{ parish_id: jesus.id, alias: 'JESUS HOUSE', alias_key: 'JESUS HOUSE' }]);
  });

  it('moves a province to a new region without touching its parishes', () => {
    const moved = LIST.map((entry) => (entry.province === 'Lagos Province 2' ? { ...entry, region: 'REGION 68' } : entry));
    const plan = planImport(moved, first, ids);
    const region68 = plan.units.find((change) => change.kind === 'create')!;
    expect(region68.after.display_name).toBe('Region 68');
    expect(plan.units.find((change) => change.kind === 'move')).toMatchObject({
      id: unitNamed(first, 'LAGOS PROVINCE 2').id,
      after: { parent_id: region68.id },
    });
    expect(plan.parishes).toEqual([]);
  });

  it('moves a parish into a province created from its old one, keeping its ID', () => {
    const withLineage: Snapshot = {
      ...first,
      lineage: [{ level: 'province', new_key: 'LAGOS PROVINCE 135', source_level: 'province', source_key: 'LAGOS PROVINCE 2' }],
    };
    const moved = LIST.map((entry) => (entry.province === 'Lagos Province 2' ? { ...entry, province: 'LAGOS PROVINCE 135' } : entry));
    const plan = planImport(moved, withLineage, ids);
    const jesus = parishIn(first, 'Lagos Province 2', 'JESUS HOUSE')!;
    const lagos135 = plan.units.find((change) => change.kind === 'create')!;
    expect(plan.parishes).toEqual([expect.objectContaining({ kind: 'move', id: jesus.id, after: expect.objectContaining({ unit_id: lagos135.id }) })]);
    expect(plan.units.map((change) => [change.kind, change.after.display_name])).toEqual([
      ['create', 'Lagos Province 135'],
      ['deactivate', 'Lagos Province 2'],
    ]);
  });

  it('adds a parish as new when it could have moved from more than one place', () => {
    const twoJesus = [...LIST, row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 23', 'JESUS HOUSE')];
    const before = applied(EMPTY, planImport(twoJesus, EMPTY, ids));
    before.lineage = [
      { level: 'province', new_key: 'LAGOS PROVINCE 135', source_level: 'province', source_key: 'LAGOS PROVINCE 2' },
      { level: 'province', new_key: 'LAGOS PROVINCE 135', source_level: 'province', source_key: 'LAGOS PROVINCE 23' },
    ];
    const merged = LIST.map((entry) => (entry.province === 'Lagos Province 2' ? { ...entry, province: 'LAGOS PROVINCE 135' } : entry));
    const plan = planImport(merged, before, ids);
    expect(plan.parishes.map((change) => change.kind).sort()).toEqual(['create', 'deactivate', 'deactivate']);
    expect(plan.issues.find((issue) => issue.code === 'ambiguous_move')?.details).toMatchObject({
      name: 'Jesus House',
      unit: 'Lagos Province 135',
      from: ['Lagos Province 2', 'Lagos Province 23'],
    });
  });

  it('keeps entries staff added, and the units they sit under', () => {
    const lagos2 = unitNamed(first, 'LAGOS PROVINCE 2');
    const withStaff: Snapshot = {
      ...first,
      parishes: [
        ...first.parishes,
        { id: 'staff-parish', unit_id: lagos2.id, official_name: 'NEW PLANT', display_name: 'New Plant', name_key: 'NEW PLANT', listed_rows: 1, status: 'active', merged_into_id: null, origin: 'staff' },
      ],
    };
    const plan = planImport(LIST.filter((entry) => entry.province !== 'Lagos Province 2'), withStaff, ids);
    expect(plan.parishes.map((change) => [change.kind, change.after.official_name])).toEqual([['deactivate', 'JESUS HOUSE']]);
    expect(plan.units).toEqual([]);
    expect(plan.issues.find((issue) => issue.code === 'kept_unit')?.details).toEqual({ unit: 'Lagos Province 2' });
  });

  it('counts rows of a parish staff merged into another under the survivor', () => {
    const favour = parishIn(first, 'LAGOS PROVINCE 3', 'DIVINE FAVOUR')!;
    const jesus = parishIn(first, 'LAGOS PROVINCE 3', 'JESUS HOUSE')!;
    const mergedSnapshot: Snapshot = {
      ...first,
      parishes: first.parishes.map((parish) => (parish.id === favour.id ? { ...parish, status: 'merged', merged_into_id: jesus.id } : parish)),
    };
    const plan = planImport(LIST, mergedSnapshot, ids);
    expect(plan.parishes).toEqual([]);
    expect(plan.issues.find((issue) => issue.code === 'merged_entry')?.details).toMatchObject({ merged: 'Divine Favour', into: 'Jesus House' });
  });

  it('places a unit under the parent most rows give, and says so', () => {
    const conflicting = [...LIST, row('CONTINENT 3', 'REGION 19', 'LAGOS PROVINCE 3', 'NEW LIFE')];
    const plan = planImport(conflicting, EMPTY, ids);
    const lagos3 = plan.units.find((change) => change.after.display_name === 'Lagos Province 3')!;
    const region54 = plan.units.find((change) => change.after.display_name === 'Region 54')!;
    expect(lagos3.after.parent_id).toBe(region54.id);
    expect(plan.issues.find((issue) => issue.code === 'unit_parent_conflict')?.details).toEqual({
      unit: 'Lagos Province 3',
      parents: [
        { parent: 'Region 54', rows: 4 },
        { parent: 'Region 19', rows: 1 },
      ],
    });
  });
});
