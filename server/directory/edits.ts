/**
 * Corrections staff make to the parish directory (Admin → Parish directory, and Parish review):
 * add, rename, move, merge and split. With ./store.ts (imports), the only code that writes the
 * directory tables. Each correction is one transaction that records the change
 * (directory_changes, via 'staff'), rebuilds the caches of the parishes it touches, runs the
 * consistency check and audits it with IDs and field names only. Later imports keep what staff
 * corrected (`staff_fields`, server/directory/plan.ts).
 */
import { NIGERIAN_STATES } from '../../src/shared/application';
import { CHURCH_LEVELS, cleanName, parishKey, stateFromProvince, unitKey, type ChurchLevel } from '../../src/shared/directory';
import { audit } from '../audit';
import type { Db, Queryable } from '../db';
import { checkConsistency, DirectoryError, inTransaction, isConsistent, rebuildCaches } from './store';

/** The levels staff can add: the ones the RCCG list uses (zone and area arrive with the RCCG API). */
export const EDITABLE_LEVELS = ['continent', 'region', 'province'] as const satisfies readonly ChurchLevel[];
export type EditableLevel = (typeof EDITABLE_LEVELS)[number];

const LEVEL_INDEX = new Map<ChurchLevel, number>(CHURCH_LEVELS.map((level, index) => [level, index]));

type UnitRow = {
  id: string;
  level: ChurchLevel;
  display_name: string;
  name_key: string;
  parent_id: string | null;
  parent_level: ChurchLevel | null;
  state: string | null;
  status: 'active' | 'inactive' | 'merged';
  origin: 'import' | 'staff';
  staff_fields: string[];
};

type ParishRow = {
  id: string;
  unit_id: string;
  source_unit_id: string | null;
  official_name: string;
  display_name: string;
  name_key: string;
  status: 'active' | 'inactive' | 'merged';
  origin: 'import' | 'staff';
  staff_fields: string[];
};

const actor = (staffId: string) => ({ type: 'staff' as const, id: staffId });

async function lockUnit(db: Queryable, id: string): Promise<UnitRow> {
  const { rows } = await db.query<UnitRow>(
    `select id, level::text as level, display_name, name_key, parent_id, parent_level::text as parent_level, state,
            status::text as status, origin::text as origin, to_jsonb(staff_fields) as staff_fields
       from church_units where id = $1 for update`,
    [id],
  );
  if (!rows[0]) throw new DirectoryError('There is no unit with that ID.');
  return rows[0];
}

async function lockParish(db: Queryable, id: string): Promise<ParishRow> {
  const { rows } = await db.query<ParishRow>(
    `select id, unit_id, source_unit_id, official_name, display_name, name_key, status::text as status, origin::text as origin,
            to_jsonb(staff_fields) as staff_fields
       from parishes where id = $1 for update`,
    [id],
  );
  if (!rows[0]) throw new DirectoryError('There is no parish with that ID.');
  return rows[0];
}

async function activeUnit(db: Queryable, id: string, what: string): Promise<UnitRow> {
  const unit = await lockUnit(db, id);
  if (unit.status !== 'active') throw new DirectoryError(`${what} is ${unit.status === 'merged' ? 'merged into another unit' : 'inactive'}. Choose an active one.`);
  return unit;
}

/** A name staff typed, cleaned like the list's names. */
function nameFrom(input: string, what: string): string {
  const name = cleanName(input);
  if (name.length < 2 || name.length > 200 || !/[A-Za-z0-9]/.test(name)) throw new DirectoryError(`Enter the ${what}'s name (2 to 200 characters).`);
  return name;
}

const withField = (fields: string[], field: string) => [...new Set([...fields, field])];

async function logChange(
  db: Queryable,
  staffId: string,
  entity: 'unit' | 'parish',
  entityId: string,
  change: 'create' | 'update' | 'move' | 'reactivate' | 'deactivate' | 'merge',
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `insert into directory_changes (staff_id, via, entity, entity_id, change, before, after) values ($1, 'staff', $2, $3, $4, $5, $6)`,
    [staffId, entity, entityId, change, before === null ? null : JSON.stringify(before), JSON.stringify(after)],
  );
}

/** Rebuilds the caches of the parishes a correction touched, then checks them: an inconsistent result changes nothing. */
async function settle(db: Queryable, parishIds: string[]): Promise<void> {
  await rebuildCaches(db, parishIds);
  const check = await checkConsistency(db, parishIds);
  if (!isConsistent(check)) throw new DirectoryError(`That change would leave the directory inconsistent (${JSON.stringify(check)}), so nothing was changed.`);
}

/** Parishes whose chain includes the unit (their caches change when it moves or merges). */
async function parishesUnder(db: Queryable, unitId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from parishes where $1::uuid in (unit_id, continent_id, region_id, province_id, zone_id, area_id)`,
    [unitId],
  );
  return rows.map((row) => row.id);
}

/** The active parish an entry was (eventually) merged into, itself if active, or null when that ends inactive. */
async function survivingParish(db: Queryable, id: string): Promise<string | null> {
  let current = id;
  for (let hops = 0; hops < 10; hops++) {
    const { rows } = await db.query<{ status: string; merged_into_id: string | null }>(
      `select status::text as status, merged_into_id from parishes where id = $1`,
      [current],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.status === 'active') return current;
    if (row.status !== 'merged' || !row.merged_into_id) return null;
    current = row.merged_into_id;
  }
  return null;
}

/** A parish with this name already sits in the unit, or is listed there by the source (moved away by staff). */
async function nameTaken(db: Queryable, unitId: string, key: string, except: string | null): Promise<string | null> {
  const { rows } = await db.query<{ display_name: string }>(
    `select display_name from parishes
      where name_key = $2 and (unit_id = $1 or source_unit_id = $1) and ($3::uuid is null or id <> $3::uuid) limit 1`,
    [unitId, key, except],
  );
  return rows[0]?.display_name ?? null;
}

function checkParent(level: ChurchLevel, parent: UnitRow | null): void {
  if (level === 'continent') {
    if (parent) throw new DirectoryError('A continent has no unit above it.');
    return;
  }
  if (!parent) throw new DirectoryError(`Choose the unit this ${level} sits under.`);
  if (LEVEL_INDEX.get(parent.level)! >= LEVEL_INDEX.get(level)!) throw new DirectoryError(`A ${level} can only sit under a level above it, not a ${parent.level}.`);
}

function stateValue(input: unknown): string | null {
  if (input === null || input === '') return null;
  if (typeof input === 'string' && (NIGERIAN_STATES as readonly string[]).includes(input)) return input;
  throw new DirectoryError('Choose a state from the list.');
}

// ── Units ─────────────────────────────────────────────────────────────────────

export async function createUnit(
  db: Db,
  input: { level: EditableLevel; name: string; parentId: string | null; state?: string | null },
  staffId: string,
): Promise<string> {
  return inTransaction(db, async (connection) => {
    const name = nameFrom(input.name, input.level);
    const parent = input.parentId ? await activeUnit(connection, input.parentId, 'That parent') : null;
    checkParent(input.level, parent);
    const key = unitKey(name);
    const clash = await connection.query<{ display_name: string; status: string }>(
      `select display_name, status::text as status from church_units where level = $1 and name_key = $2`,
      [input.level, key],
    );
    if (clash.rows[0]) {
      throw new DirectoryError(`There is already a ${input.level} called ${clash.rows[0].display_name}${clash.rows[0].status === 'active' ? '' : ` (${clash.rows[0].status})`}.`);
    }
    const state = input.level === 'province' ? (input.state === undefined ? stateFromProvince(name) : stateValue(input.state)) : null;
    const { rows } = await connection.query<{ id: string }>(
      `insert into church_units (level, official_name, display_name, name_key, parent_id, parent_level, state, origin)
       values ($1::church_level, $2::text, $2::text, $3, $4, $5::church_level, $6, 'staff') returning id`,
      [input.level, name, key, parent?.id ?? null, parent?.level ?? null, state],
    );
    const id = rows[0]!.id;
    await logChange(connection, staffId, 'unit', id, 'create', null, {
      level: input.level,
      display_name: name,
      parent_id: parent?.id ?? null,
      state,
      status: 'active',
    });
    await settle(connection, []);
    await audit(connection, actor(staffId), 'directory.unit_created', { type: 'church_unit', id }, { level: input.level });
    return id;
  });
}

export type UnitChanges = { displayName?: string; parentId?: string; state?: string | null };

/** Renames, moves or sets the state of a unit. Returns the fields that changed. */
export async function updateUnit(db: Db, id: string, changes: UnitChanges, staffId: string): Promise<string[]> {
  return inTransaction(db, async (connection) => {
    const unit = await activeUnit(connection, id, 'That unit');
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let fields = unit.staff_fields;
    const changed: string[] = [];

    if (changes.displayName !== undefined) {
      const name = nameFrom(changes.displayName, unit.level);
      if (name !== unit.display_name) {
        before.display_name = unit.display_name;
        after.display_name = name;
        fields = withField(fields, 'display_name');
        changed.push('display_name');
      }
    }
    let affected: string[] = [];
    if (changes.parentId !== undefined && changes.parentId !== unit.parent_id) {
      const parent = await activeUnit(connection, changes.parentId, 'That parent');
      checkParent(unit.level, parent);
      before.parent_id = unit.parent_id;
      after.parent_id = parent.id;
      fields = withField(fields, 'parent');
      changed.push('parent');
      affected = await parishesUnder(connection, unit.id);
      await connection.query(`update church_units set parent_id = $2, parent_level = $3::church_level where id = $1`, [unit.id, parent.id, parent.level]);
    }
    if (changes.state !== undefined) {
      if (unit.level !== 'province') throw new DirectoryError('Only provinces have a state.');
      const state = stateValue(changes.state);
      if (state !== unit.state) {
        before.state = unit.state;
        after.state = state;
        fields = withField(fields, 'state');
        changed.push('state');
      }
    }
    if (!changed.length) return changed;

    await connection.query(
      `update church_units
          set display_name = coalesce($2, display_name), state = case when $3::boolean then $4::text else state end,
              staff_fields = array(select jsonb_array_elements_text($5::jsonb)), updated_at = now()
        where id = $1`,
      [unit.id, (after.display_name as string | undefined) ?? null, 'state' in after, (after.state as string | null | undefined) ?? null, JSON.stringify(fields)],
    );
    await logChange(connection, staffId, 'unit', unit.id, 'parent_id' in after ? 'move' : 'update', before, after);
    await settle(connection, affected);
    await audit(connection, actor(staffId), 'directory.unit_updated', { type: 'church_unit', id: unit.id }, { fields: changed });
    return changed;
  });
}

export type MergeResult = { unitsMoved: number; parishesMoved: number; parishesMerged: number; applicationsMoved: number };

/**
 * Merges a unit into another at the same level: the units and parishes under it move across
 * (a parish whose name the other unit already lists is merged into that one), and later imports
 * count the old unit's rows under the one it was merged into.
 */
export async function mergeUnit(db: Db, id: string, intoId: string, staffId: string): Promise<MergeResult> {
  return inTransaction(db, async (connection) => {
    if (id === intoId) throw new DirectoryError('Choose a different unit to merge into.');
    const unit = await activeUnit(connection, id, 'That unit');
    const into = await activeUnit(connection, intoId, 'The unit to merge into');
    if (unit.level !== into.level) throw new DirectoryError(`A ${unit.level} can only be merged into another ${unit.level}.`);
    const affected = await parishesUnder(connection, unit.id);

    const children = await connection.query<{ id: string }>(`select id from church_units where parent_id = $1 and status <> 'merged'`, [unit.id]);
    for (const child of children.rows) {
      await connection.query(`update church_units set parent_id = $2, parent_level = $3::church_level, updated_at = now() where id = $1`, [child.id, into.id, into.level]);
      await logChange(connection, staffId, 'unit', child.id, 'move', { parent_id: unit.id }, { parent_id: into.id });
    }

    let parishesMoved = 0;
    let parishesMerged = 0;
    let applicationsMoved = 0;
    const direct = await connection.query<{ id: string; name_key: string; display_name: string }>(
      `select id, name_key, display_name from parishes where unit_id = $1 and status <> 'merged'`,
      [unit.id],
    );
    for (const parish of direct.rows) {
      // The same name in the other unit (any status: a unit lists a name once) takes this one in.
      const { rows } = await connection.query<{ id: string }>(`select id from parishes where unit_id = $1 and name_key = $2`, [into.id, parish.name_key]);
      if (rows[0]) {
        const target = await survivingParish(connection, rows[0].id);
        if (!target) throw new DirectoryError(`${into.display_name} lists ${parish.display_name} as inactive. Reactivate or rename one of them first.`);
        applicationsMoved += await mergeParishIn(connection, parish.id, target, staffId);
        affected.push(target);
        parishesMerged++;
      } else {
        await connection.query(`update parishes set unit_id = $2, updated_at = now() where id = $1`, [parish.id, into.id]);
        await logChange(connection, staffId, 'parish', parish.id, 'move', { unit_id: unit.id }, { unit_id: into.id });
        parishesMoved++;
      }
    }

    await connection.query(`update church_units set status = 'merged', merged_into_id = $2, updated_at = now() where id = $1`, [unit.id, into.id]);
    await logChange(connection, staffId, 'unit', unit.id, 'merge', { status: 'active', merged_into_id: null }, { status: 'merged', merged_into_id: into.id });
    await settle(connection, affected);
    const result = { unitsMoved: children.rows.length, parishesMoved, parishesMerged, applicationsMoved };
    await audit(connection, actor(staffId), 'directory.unit_merged', { type: 'church_unit', id: unit.id }, { into: into.id, ...result });
    return result;
  });
}

// ── Parishes ──────────────────────────────────────────────────────────────────

/** Adds a parish (inside the caller's transaction): Parish review adds one and links it at once. */
export async function createParishIn(
  connection: Queryable,
  input: { unitId: string; name: string; splitFrom?: string },
  staffId: string,
): Promise<string> {
  const unit = await activeUnit(connection, input.unitId, 'That unit');
  const name = nameFrom(input.name, 'parish');
  const key = parishKey(name);
  const taken = await nameTaken(connection, unit.id, key, null);
  if (taken) throw new DirectoryError(`${unit.display_name} already lists ${taken}. Give the new parish a name that tells them apart.`);
  const { rows } = await connection.query<{ id: string }>(
    `insert into parishes (unit_id, official_name, display_name, name_key, origin) values ($1, $2::text, $2::text, $3, 'staff') returning id`,
    [unit.id, name, key],
  );
  const id = rows[0]!.id;
  await logChange(connection, staffId, 'parish', id, 'create', null, {
    unit_id: unit.id,
    display_name: name,
    status: 'active',
    ...(input.splitFrom ? { split_from: input.splitFrom } : {}),
  });
  await settle(connection, [id]);
  await audit(connection, actor(staffId), input.splitFrom ? 'directory.parish_split' : 'directory.parish_created', { type: 'parish', id }, {
    unitId: unit.id,
    ...(input.splitFrom ? { from: input.splitFrom } : {}),
  });
  return id;
}

export const createParish = (db: Db, input: { unitId: string; name: string }, staffId: string) =>
  inTransaction(db, (connection) => createParishIn(connection, input, staffId));

export type ParishChanges = { displayName?: string; unitId?: string; status?: 'active' | 'inactive' };

/** Renames, moves, deactivates or reactivates a parish. Returns the fields that changed. */
export async function updateParish(db: Db, id: string, changes: ParishChanges, staffId: string): Promise<string[]> {
  return inTransaction(db, async (connection) => {
    const parish = await lockParish(connection, id);
    if (parish.status === 'merged') throw new DirectoryError('That parish was merged into another; change that one instead.');
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let fields = parish.staff_fields;
    let sourceUnit = parish.source_unit_id;
    const changed: string[] = [];

    if (changes.displayName !== undefined) {
      const name = nameFrom(changes.displayName, 'parish');
      if (name !== parish.display_name) {
        before.display_name = parish.display_name;
        after.display_name = name;
        fields = withField(fields, 'display_name');
        changed.push('display_name');
        // Search finds it by its new name too.
        await connection.query(
          `insert into parish_aliases (parish_id, alias, alias_key) values ($1, $2, $3) on conflict (parish_id, alias) do nothing`,
          [parish.id, name, parishKey(name)],
        );
      }
    }
    if (changes.unitId !== undefined && changes.unitId !== parish.unit_id) {
      const unit = await activeUnit(connection, changes.unitId, 'That unit');
      const taken = await nameTaken(connection, unit.id, parish.name_key, parish.id);
      if (taken) throw new DirectoryError(`${unit.display_name} already lists ${taken}. Merge the two parishes instead.`);
      before.unit_id = parish.unit_id;
      after.unit_id = unit.id;
      changed.push('unit_id');
      // Imports recognise a moved parish where the source lists it; moving it back ends the correction.
      if (parish.origin === 'import') {
        const listedAt = sourceUnit ?? parish.unit_id;
        if (unit.id === listedAt) {
          sourceUnit = null;
          fields = fields.filter((field) => field !== 'unit_id');
        } else {
          sourceUnit = listedAt;
          fields = withField(fields, 'unit_id');
        }
      }
    }
    if (changes.status !== undefined && changes.status !== parish.status) {
      if (changes.status === 'active') {
        const { rows } = await connection.query<{ inactive: boolean }>(
          `select exists (select 1 from parishes p join church_units u
                           on u.id in (p.unit_id, p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)
                          where p.id = $1 and u.status <> 'active') as inactive`,
          [parish.id],
        );
        if (rows[0]!.inactive && after.unit_id === undefined) throw new DirectoryError('Its province, region or continent is no longer active. Move the parish first.');
      }
      before.status = parish.status;
      after.status = changes.status;
      fields = withField(fields, 'status');
      changed.push('status');
    }
    if (!changed.length) return changed;

    await connection.query(
      `update parishes
          set display_name = coalesce($2, display_name), unit_id = coalesce($3, unit_id), status = coalesce($4::directory_status, status),
              source_unit_id = $5, staff_fields = array(select jsonb_array_elements_text($6::jsonb)), updated_at = now()
        where id = $1`,
      [parish.id, (after.display_name as string | undefined) ?? null, (after.unit_id as string | undefined) ?? null, (after.status as string | undefined) ?? null, sourceUnit, JSON.stringify(fields)],
    );
    const kind = 'status' in after ? (after.status === 'active' ? 'reactivate' : 'deactivate') : 'unit_id' in after ? 'move' : 'update';
    await logChange(connection, staffId, 'parish', parish.id, kind, before, after);
    await settle(connection, [parish.id]);
    await audit(connection, actor(staffId), 'directory.parish_updated', { type: 'parish', id: parish.id }, { fields: changed });
    return changed;
  });
}

/**
 * Merges one parish into another (inside the caller's transaction): its applications move to
 * the other, and its names become the other's aliases so search still finds it. Returns how
 * many applications moved.
 */
async function mergeParishIn(connection: Queryable, id: string, intoId: string, staffId: string): Promise<number> {
  if (id === intoId) throw new DirectoryError('Choose a different parish to merge into.');
  const parish = await lockParish(connection, id);
  const into = await lockParish(connection, intoId);
  if (parish.status === 'merged') throw new DirectoryError('That parish was already merged into another.');
  if (into.status !== 'active') throw new DirectoryError('Choose an active parish to merge into.');
  await connection.query(
    `insert into parish_aliases (parish_id, alias, alias_key)
     select $2::uuid, alias, alias_key from parish_aliases where parish_id = $1::uuid
     union select $2::uuid, $3::text, $4::text
     union select $2::uuid, $5::text, $6::text
     on conflict (parish_id, alias) do nothing`,
    [parish.id, into.id, parish.display_name, parishKey(parish.display_name), parish.official_name, parishKey(parish.official_name)],
  );
  await connection.query(`update parishes set status = 'merged', merged_into_id = $2, updated_at = now() where id = $1`, [parish.id, into.id]);
  const moved = await connection.query<{ n: number }>(
    `with moved as (update applications set parish_id = $2 where parish_id = $1 returning 1) select count(*)::int as n from moved`,
    [parish.id, into.id],
  );
  await logChange(connection, staffId, 'parish', parish.id, 'merge', { status: parish.status, merged_into_id: null }, { status: 'merged', merged_into_id: into.id });
  return moved.rows[0]!.n;
}

export async function mergeParish(db: Db, id: string, intoId: string, staffId: string): Promise<{ applicationsMoved: number }> {
  return inTransaction(db, async (connection) => {
    const applicationsMoved = await mergeParishIn(connection, id, intoId, staffId);
    await settle(connection, [id, intoId]);
    await audit(connection, actor(staffId), 'directory.parish_merged', { type: 'parish', id }, { into: intoId, applicationsMoved });
    return { applicationsMoved };
  });
}

/**
 * Splits a same-name entry: adds a second parish in the same unit under a name that tells them
 * apart. Applications stay where they are; staff move any that belong to the new one.
 */
export async function splitParish(db: Db, id: string, name: string, staffId: string): Promise<string> {
  return inTransaction(db, async (connection) => {
    const parish = await lockParish(connection, id);
    if (parish.status !== 'active') throw new DirectoryError('Only an active parish can be split.');
    return createParishIn(connection, { unitId: parish.unit_id, name, splitFrom: parish.id }, staffId);
  });
}
