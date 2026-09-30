/**
 * Reads the parish directory for the planner, and applies or reverts a plan (docs/05 §2,
 * "Parish directory"). The only code that writes the directory tables. Every apply and revert
 * is one transaction that ends with a consistency check: if the check fails, nothing changes.
 */
import { randomUUID } from 'node:crypto';
import type { ChurchLevel } from '../../src/shared/directory';
import { audit, SYSTEM, type AuditActor } from '../audit';
import type { Db, Queryable } from '../db';
import type { LineageRecord, ParishChange, ParishRecord, Plan, PlanCounts, Snapshot, UnitChange, UnitRecord } from './plan';

export class DirectoryError extends Error {}

export type ImportMeta = {
  source: 'spreadsheet' | 'api';
  label: string;
  checksum: string | null;
  /** The date the source's structure is correct for, when known (YYYY-MM-DD). */
  structureAsAt: string | null;
  via: 'cli' | 'admin' | 'sync';
  staffId?: string | null;
};

// Rows per statement: large enough to be quick, small enough for one JSON parameter.
const BATCH = 5000;

async function inBatches<T>(items: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < items.length; start += BATCH) await write(items.slice(start, start + BATCH));
}

export async function loadSnapshot(db: Queryable): Promise<Snapshot> {
  const [units, parishes, aliases, lineage] = [
    await db.query<UnitRecord>(
      `select id, level::text as level, official_name, display_name, name_key, parent_id, parent_level::text as parent_level,
              state, status::text as status, merged_into_id, origin::text as origin
         from church_units`,
    ),
    await db.query<ParishRecord>(
      `select id, unit_id, official_name, display_name, name_key, listed_rows, status::text as status, merged_into_id, origin::text as origin
         from parishes`,
    ),
    await db.query<{ parish_id: string; alias: string }>('select parish_id, alias from parish_aliases'),
    await db.query<LineageRecord>('select level::text as level, new_key, source_level::text as source_level, source_key from unit_lineage'),
  ];
  return { units: units.rows, parishes: parishes.rows, aliases: aliases.rows, lineage: lineage.rows };
}

// Each parish's path up the hierarchy, flattened to one column per level, and the text parish
// search matches: its name key, other spellings, and its province and region keys.
const DERIVED = `
  with recursive chain as (
    select p.id as parish_id, u.id as unit_id, u.level, u.parent_id, 1 as depth
      from parishes p join church_units u on u.id = p.unit_id
    union all
    select c.parish_id, u.id, u.level, u.parent_id, c.depth + 1
      from chain c join church_units u on u.id = c.parent_id
     where c.depth < 6
  ),
  flat as (
    select parish_id,
           (array_agg(unit_id) filter (where level = 'continent'))[1] as continent_id,
           (array_agg(unit_id) filter (where level = 'region'))[1] as region_id,
           (array_agg(unit_id) filter (where level = 'province'))[1] as province_id,
           (array_agg(unit_id) filter (where level = 'zone'))[1] as zone_id,
           (array_agg(unit_id) filter (where level = 'area'))[1] as area_id
      from chain
     group by parish_id
  )
  select f.*,
         concat_ws(' ', p.name_key,
           (select string_agg(distinct a.alias_key, ' ' order by a.alias_key)
              from parish_aliases a where a.parish_id = p.id and a.alias_key <> p.name_key),
           province.name_key, region.name_key) as search_text
    from flat f
    join parishes p on p.id = f.parish_id
    left join church_units province on province.id = f.province_id
    left join church_units region on region.id = f.region_id`;

/** Brings every parish's cached chain and search text up to date. Returns how many changed. */
export async function rebuildCaches(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ changed: number }>(
    `with derived as (${DERIVED}),
          updated as (
            update parishes p
               set continent_id = d.continent_id, region_id = d.region_id, province_id = d.province_id,
                   zone_id = d.zone_id, area_id = d.area_id, search_text = d.search_text
              from derived d
             where d.parish_id = p.id
               and (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id, p.search_text)
                   is distinct from (d.continent_id, d.region_id, d.province_id, d.zone_id, d.area_id, d.search_text)
            returning 1)
     select count(*)::int as changed from updated`,
  );
  return rows[0]!.changed;
}

export type Consistency = { chainMismatches: number; searchMismatches: number; activeUnderInactive: number; unitsUnderInactive: number };

/** Every count must be zero. */
export async function checkConsistency(db: Queryable): Promise<Consistency> {
  const { rows } = await db.query<Consistency>(
    `with derived as (${DERIVED})
     select
       (select count(*)::int from parishes p left join derived d on d.parish_id = p.id
         where (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)
               is distinct from (d.continent_id, d.region_id, d.province_id, d.zone_id, d.area_id)) as "chainMismatches",
       (select count(*)::int from parishes p left join derived d on d.parish_id = p.id
         where p.search_text is distinct from d.search_text) as "searchMismatches",
       (select count(*)::int from parishes p
         where p.status = 'active'
           and exists (select 1 from church_units u
                        where u.id in (p.unit_id, p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)
                          and u.status <> 'active')) as "activeUnderInactive",
       (select count(*)::int from church_units c join church_units u on u.id = c.parent_id
         where c.status = 'active' and u.status <> 'active') as "unitsUnderInactive"`,
  );
  return rows[0]!;
}

const isConsistent = (check: Consistency) => Object.values(check).every((count) => count === 0);

const UNIT_COLUMNS = `official_name text, display_name text, parent_id uuid, parent_level church_level, state text, status directory_status`;
const PARISH_COLUMNS = `unit_id uuid, official_name text, display_name text, listed_rows int, status directory_status`;

async function writeUnits(db: Queryable, changes: UnitChange[]): Promise<void> {
  // New units level by level, so every parent exists before its children.
  const levels: ChurchLevel[] = ['continent', 'region', 'province', 'zone', 'area'];
  for (const level of levels) {
    const created = changes.filter((change) => change.kind === 'create' && change.level === level);
    await inBatches(created, (batch) =>
      db.query(
        `insert into church_units (id, level, name_key, official_name, display_name, parent_id, parent_level, state, status)
         select r.id, r.level, r.name_key, r.official_name, r.display_name, r.parent_id, r.parent_level, r.state, r.status
           from jsonb_to_recordset($1::jsonb) as r(id uuid, level church_level, name_key text, ${UNIT_COLUMNS})`,
        [JSON.stringify(batch.map((change) => ({ id: change.id, level: change.level, name_key: change.name_key, ...change.after })))],
      ),
    );
  }
  await updateUnits(db, changes.filter((change) => change.kind !== 'create' && change.kind !== 'deactivate'));
}

async function updateUnits(db: Queryable, changes: UnitChange[]): Promise<void> {
  await inBatches(changes, (batch) =>
    db.query(
      `update church_units u
          set official_name = r.official_name, display_name = r.display_name, parent_id = r.parent_id,
              parent_level = r.parent_level, state = r.state, status = r.status, updated_at = now()
         from jsonb_to_recordset($1::jsonb) as r(id uuid, ${UNIT_COLUMNS})
        where u.id = r.id`,
      [JSON.stringify(batch.map((change) => ({ id: change.id, ...change.after })))],
    ),
  );
}

async function writeParishes(db: Queryable, changes: ParishChange[]): Promise<void> {
  await inBatches(
    changes.filter((change) => change.kind === 'create'),
    (batch) =>
      db.query(
        `insert into parishes (id, name_key, unit_id, official_name, display_name, listed_rows, status)
         select r.id, r.name_key, r.unit_id, r.official_name, r.display_name, r.listed_rows, r.status
           from jsonb_to_recordset($1::jsonb) as r(id uuid, name_key text, ${PARISH_COLUMNS})`,
        [JSON.stringify(batch.map((change) => ({ id: change.id, name_key: change.name_key, ...change.after })))],
      ),
  );
  await inBatches(
    changes.filter((change) => change.kind !== 'create'),
    (batch) =>
      db.query(
        `update parishes p
            set unit_id = r.unit_id, official_name = r.official_name, display_name = r.display_name,
                listed_rows = r.listed_rows, status = r.status, updated_at = now()
           from jsonb_to_recordset($1::jsonb) as r(id uuid, ${PARISH_COLUMNS})
          where p.id = r.id`,
        [JSON.stringify(batch.map((change) => ({ id: change.id, ...change.after })))],
      ),
  );
}

async function writeLog(db: Queryable, importId: string, plan: Plan): Promise<void> {
  const changes = [
    ...plan.units.map((change) => ({ entity: 'unit', entity_id: change.id, change: change.kind, before: change.before, after: change.after })),
    ...plan.parishes.map((change) => ({ entity: 'parish', entity_id: change.id, change: change.kind, before: change.before, after: change.after })),
  ];
  await inBatches(changes, (batch) =>
    db.query(
      `insert into directory_changes (import_id, via, entity, entity_id, change, before, after)
       select $1, 'import', r.entity, r.entity_id, r.change, r.before, r.after
         from jsonb_to_recordset($2::jsonb) as r(entity text, entity_id uuid, change text, before jsonb, after jsonb)`,
      [importId, JSON.stringify(batch)],
    ),
  );
  await inBatches(plan.aliases, (batch) =>
    db.query(
      `insert into parish_aliases (parish_id, alias, alias_key, import_id)
       select r.parish_id, r.alias, r.alias_key, $1
         from jsonb_to_recordset($2::jsonb) as r(parish_id uuid, alias text, alias_key text)
       on conflict (parish_id, alias) do nothing`,
      [importId, JSON.stringify(batch)],
    ),
  );
  await inBatches(plan.issues, (batch) =>
    db.query(
      `insert into directory_issues (import_id, severity, code, line, message, details)
       select $1, r.severity, r.code, r.line, r.message, r.details
         from jsonb_to_recordset($2::jsonb) as r(severity text, code text, line int, message text, details jsonb)`,
      [importId, JSON.stringify(batch.map((issue) => ({ ...issue, message: issue.message.slice(0, 500) })))],
    ),
  );
}

/** Figures only, for the audit trail. */
const auditSummary = (counts: PlanCounts) => ({
  rows: counts.rows,
  entries: counts.entries,
  units: counts.units,
  parishes: counts.parishes,
});

async function inTransaction<T>(db: Db, run: (connection: Queryable) => Promise<T>): Promise<T> {
  return db.withConnection(async (connection) => {
    await connection.exec('begin');
    try {
      // A first import writes tens of thousands of rows: allow more than the usual 15 seconds.
      if (db.driver === 'postgres') await connection.exec(`set local statement_timeout = '300s'`);
      const result = await run(connection);
      await connection.exec('commit');
      return result;
    } catch (error) {
      await connection.exec('rollback');
      throw error;
    }
  });
}

const actorFor = (meta: { staffId?: string | null }): AuditActor => (meta.staffId ? { type: 'staff', id: meta.staffId } : SYSTEM);

/** Applies the plan in one transaction and records it. Returns the import's ID. */
export async function applyPlan(db: Db, plan: Plan, meta: ImportMeta): Promise<string> {
  const importId = randomUUID();
  try {
    await inTransaction(db, async (connection) => {
      await connection.query(
        `insert into directory_imports (id, source, source_label, checksum, structure_as_at, status, counts, via, staff_id)
         values ($1, $2, $3, $4, $5, 'applied', $6, $7, $8)`,
        [importId, meta.source, meta.label.slice(0, 200), meta.checksum, meta.structureAsAt, JSON.stringify(plan.counts), meta.via, meta.staffId ?? null],
      );
      await writeUnits(connection, plan.units);
      await writeParishes(connection, plan.parishes);
      await updateUnits(connection, plan.units.filter((change) => change.kind === 'deactivate'));
      await writeLog(connection, importId, plan);
      await rebuildCaches(connection);
      const check = await checkConsistency(connection);
      if (!isConsistent(check)) {
        throw new DirectoryError(`The import would leave the directory inconsistent (${JSON.stringify(check)}), so nothing was changed.`);
      }
      await connection.query('update directory_imports set finished_at = now() where id = $1', [importId]);
      await audit(connection, actorFor(meta), 'directory.imported', { type: 'directory_import', id: importId }, auditSummary(plan.counts));
    });
    return importId;
  } catch (error) {
    // Keep a record that it was tried; the original error is what matters, so this is best effort.
    await db
      .query(
        `insert into directory_imports (id, source, source_label, checksum, structure_as_at, status, counts, error, via, staff_id, finished_at)
         values ($1, $2, $3, $4, $5, 'failed', $6, $7, $8, $9, now())`,
        [importId, meta.source, meta.label.slice(0, 200), meta.checksum, meta.structureAsAt, JSON.stringify(plan.counts), String((error as Error).message).slice(0, 500), meta.via, meta.staffId ?? null],
      )
      .catch(() => {});
    throw error;
  }
}

export type RevertResult = { units: { restored: number; deleted: number }; parishes: { restored: number; deleted: number }; aliases: number };

/** Undoes the latest applied import: restores what it changed and deletes what it created. */
export async function revertImport(db: Db, importId: string, actor: AuditActor = SYSTEM): Promise<RevertResult> {
  return inTransaction(db, async (connection) => {
    const { rows } = await connection.query<{ status: string; started_at: Date }>(
      `select status::text as status, started_at from directory_imports where id = $1 for update`,
      [importId],
    );
    const target = rows[0];
    if (!target) throw new DirectoryError('There is no import with that ID.');
    if (target.status !== 'applied') throw new DirectoryError(`That import is ${target.status}; only an applied import can be reverted.`);
    const later = await connection.query(
      `select 1 from directory_imports where status = 'applied' and id <> $1 and started_at >= $2 limit 1`,
      [importId, target.started_at],
    );
    if (later.rows.length) throw new DirectoryError('A later import has been applied since; revert that one first.');
    const { rows: used } = await connection.query<{ n: number }>(
      `with added as (select entity_id from directory_changes where import_id = $1 and entity = 'parish' and change = 'create')
       select (select count(*) from applications where parish_id in (select entity_id from added))
            + (select count(*) from parish_reports where parish_id in (select entity_id from added) or resolved_parish_id in (select entity_id from added)) as n`,
      [importId],
    );
    if (Number(used[0]!.n) > 0) {
      throw new DirectoryError(`${used[0]!.n} applications or parish reports point at parishes this import added, so it can't be reverted.`);
    }

    const count = async (sql: string) => (await connection.query<{ n: number }>(`with done as (${sql} returning 1) select count(*)::int as n from done`, [importId])).rows[0]!.n;
    const aliases = await count('delete from parish_aliases where import_id = $1');
    const unitsRestored = await count(
      `update church_units u
          set official_name = b.official_name, display_name = b.display_name, parent_id = b.parent_id,
              parent_level = b.parent_level, state = b.state, status = b.status, updated_at = now()
         from directory_changes c, jsonb_to_record(c.before) as b(${UNIT_COLUMNS})
        where c.import_id = $1 and c.entity = 'unit' and c.change <> 'create' and u.id = c.entity_id`,
    );
    const parishesRestored = await count(
      `update parishes p
          set unit_id = b.unit_id, official_name = b.official_name, display_name = b.display_name,
              listed_rows = b.listed_rows, status = b.status, updated_at = now()
         from directory_changes c, jsonb_to_record(c.before) as b(${PARISH_COLUMNS})
        where c.import_id = $1 and c.entity = 'parish' and c.change <> 'create' and p.id = c.entity_id`,
    );
    const parishesDeleted = await count(
      `delete from parishes where id in (
         select entity_id from directory_changes where import_id = $1 and entity = 'parish' and change = 'create')`,
    );
    // Remaining parishes may still point at units this import created: repoint them first.
    await rebuildCaches(connection);
    const unitsDeleted = await count(
      `delete from church_units where id in (
         select entity_id from directory_changes where import_id = $1 and entity = 'unit' and change = 'create')`,
    );
    const check = await checkConsistency(connection);
    if (!isConsistent(check)) throw new DirectoryError(`Reverting would leave the directory inconsistent (${JSON.stringify(check)}), so nothing was changed.`);

    await connection.query(`update directory_imports set status = 'reverted', reverted_at = now() where id = $1`, [importId]);
    const result: RevertResult = {
      units: { restored: unitsRestored, deleted: unitsDeleted },
      parishes: { restored: parishesRestored, deleted: parishesDeleted },
      aliases,
    };
    await audit(connection, actor, 'directory.reverted', { type: 'directory_import', id: importId }, result);
    return result;
  });
}

export type LineageLink = { level: ChurchLevel; newKey: string; newName: string; sourceLevel: ChurchLevel; sourceKey: string; sourceName: string; approvedOn: string | null };

/** Records where new units came from. Links already recorded are kept as they are. */
export async function saveLineage(db: Db, links: LineageLink[], actor: AuditActor = SYSTEM): Promise<number> {
  return inTransaction(db, async (connection) => {
    const { rows } = await connection.query<{ added: number }>(
      `with added as (
         insert into unit_lineage (level, new_key, new_name, source_level, source_key, source_name, approved_on)
         select r.level, r.new_key, r.new_name, r.source_level, r.source_key, r.source_name, r.approved_on
           from jsonb_to_recordset($1::jsonb)
             as r(level church_level, new_key text, new_name text, source_level church_level, source_key text, source_name text, approved_on date)
         on conflict (level, new_key, source_level, source_key) do nothing
         returning 1)
       select count(*)::int as added from added`,
      [
        JSON.stringify(
          links.map((link) => ({
            level: link.level,
            new_key: link.newKey,
            new_name: link.newName,
            source_level: link.sourceLevel,
            source_key: link.sourceKey,
            source_name: link.sourceName,
            approved_on: link.approvedOn,
          })),
        ),
      ],
    );
    const added = rows[0]!.added;
    await audit(connection, actor, 'directory.lineage_added', null, { links: links.length, added });
    return added;
  });
}
