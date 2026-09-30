/**
 * Keeps the parish directory in step with the RCCG directory API (docs/05 §2, "Directory API").
 *
 * The provider publishes immutable releases and, for each, its changes against the release it was
 * based on. A sync asks for the latest release (cheap, and done every few minutes by the worker);
 * when it is new, it fetches the changes of every release it hasn't seen (each is kept: a release
 * never changes), replays the chain from the base release into the complete hierarchy, and writes
 * the difference in one transaction: history, caches and the consistency check included. Nothing
 * is applied from a partial download, and a failure keeps the last good state.
 *
 * Freshness: the directory is as current as the provider's latest release when `checked_at` was
 * last set, i.e. within one poll interval of a publication while the provider answers. It is not
 * real time, and the site says so when the last confirmation is too old (`isFresh`).
 */
import { randomUUID } from 'node:crypto';
import { CHURCH_LEVELS, cleanName, displayName, parishKey, stateFromProvince, unitKey, type ChurchLevel } from '../../src/shared/directory';
import { DEFAULT_TIME_ZONE, utcToZonedLocal } from '../../src/shared/time';
import type { Db, Queryable } from '../db';
import { DirectoryApiError, externalIdOf, type ApiChange, type ApiChangesPage, type ApiLevel, type ApiRelease, type DirectoryApi, type DirectoryNamespace } from './api';
import { checkConsistency, DirectoryError, inTransaction, isConsistent, rebuildCaches } from './store';

const PER_PAGE = 200;
const SYNC_LOCK = 7_310_016; // pg_advisory_xact_lock key for directory syncs
// Guards against a runaway answer: far beyond the whole RCCG list (about 50,000 entries).
const MAX_PAGES_PER_RELEASE = 2_500;
const MAX_RELEASES = 100;
const BATCH = 2_000;

/** A failed sync, with a short code for the admin area and the logs (never a payload). */
export class SyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export type SyncCounts = {
  release: string;
  /** `kept`: entries the releases no longer describe usably, left as they were (with an issue each). */
  units: Record<'created' | 'updated' | 'moved' | 'deactivated' | 'reactivated' | 'unchanged' | 'kept', number>;
  parishes: Record<'created' | 'updated' | 'moved' | 'deactivated' | 'reactivated' | 'unchanged' | 'kept', number>;
  issues: number;
  handover: { units: number; parishes: number; matched: number; ambiguous: number; unmatched: number } | null;
  fetchedReleases: number;
};

export type SyncResult =
  | { status: 'current'; namespace: DirectoryNamespace; release: string | null }
  | { status: 'applied'; namespace: DirectoryNamespace; release: string; importId: string; counts: SyncCounts }
  | { status: 'failed'; namespace: DirectoryNamespace; error: string };

/** One unit or parish as the provider's releases describe it, after replaying them. */
type Entry = { id: string; code: string | null; level: ApiLevel; name: string; parentId: string | null; retired: boolean };
type Issue = { code: string; message: string; details: Record<string, unknown> };

const UNIT_LEVELS = CHURCH_LEVELS as readonly string[];
const isUnitLevel = (level: ApiLevel): level is ChurchLevel => UNIT_LEVELS.includes(level);
const isRetiredStatus = (status: string | null) => status !== null && status.toLowerCase() !== 'active';

// ── Talking to the provider, and keeping what it sent ────────────────────────────────────────

type CachedRelease = { versionCode: string; baseVersionCode: string | null; effectiveFrom: string | null };

async function cachedRelease(db: Queryable, namespace: DirectoryNamespace, versionCode: string): Promise<CachedRelease | null> {
  const { rows } = await db.query<{ base: string | null; effective_from: string | Date | null }>(
    `select base_version_code as base, effective_from from directory_releases where namespace = $1 and version_code = $2`,
    [namespace, versionCode],
  );
  const row = rows[0];
  if (!row) return null;
  return { versionCode, baseVersionCode: row.base, effectiveFrom: row.effective_from ? new Date(row.effective_from).toISOString() : null };
}

/** Every page of one release's changes, checked for completeness, then kept (releases never change). */
async function fetchRelease(db: Db, api: DirectoryApi, versionCode: string): Promise<CachedRelease> {
  const pages: ApiChangesPage[] = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES_PER_RELEASE) throw new SyncError('too_many_pages', `Release ${versionCode} has more pages than expected`);
    const result = await api.releaseChanges(versionCode, page, PER_PAGE);
    const first = pages[0];
    if (result.versionCode !== versionCode || (first && (result.baseVersionCode !== first.baseVersionCode || result.total !== first.total))) {
      throw new SyncError('inconsistent_pages', `Release ${versionCode}'s pages don't agree with each other`);
    }
    pages.push(result);
    if (!result.hasMore) break;
    if (!result.items.length) throw new SyncError('inconsistent_pages', `Release ${versionCode} sent an empty page before its last`);
  }
  const head = pages[0]!;
  const items = pages.flatMap((page) => page.items);
  const counted = head.counts.created + head.counts.moved + head.counts.renamed + head.counts.retired;
  // A partial download must never look like a complete release.
  if (items.length !== head.total || counted !== head.total) {
    throw new SyncError('incomplete_release', `Release ${versionCode} arrived incomplete (${items.length} of ${head.total} changes)`);
  }
  await inTransaction(db, async (connection) => {
    await connection.query(
      `insert into directory_releases (namespace, version_code, release_id, base_version_code, effective_from, counts)
       values ($1, $2, $3, $4, $5, $6) on conflict (namespace, version_code) do nothing`,
      [api.namespace, versionCode, head.releaseId, head.baseVersionCode, head.effectiveFrom, JSON.stringify(head.counts)],
    );
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH).map((change, index) => ({ seq: start + index, change }));
      await connection.query(
        `insert into directory_release_changes (namespace, version_code, seq, change)
         select $1, $2, r.seq, r.change from jsonb_to_recordset($3::jsonb) as r(seq int, change jsonb)
         on conflict do nothing`,
        [api.namespace, versionCode, JSON.stringify(batch)],
      );
    }
  });
  return { versionCode, baseVersionCode: head.baseVersionCode, effectiveFrom: head.effectiveFrom };
}

/** The releases from the base up to `latest`, oldest first, fetching those not yet kept. */
async function releaseChain(db: Db, api: DirectoryApi, latest: string): Promise<{ chain: CachedRelease[]; fetched: number }> {
  const chain: CachedRelease[] = [];
  const seen = new Set<string>();
  let fetched = 0;
  for (let version: string | null = latest; version; ) {
    if (seen.has(version) || seen.size >= MAX_RELEASES) throw new SyncError('release_chain', 'The releases don’t lead back to a base release');
    seen.add(version);
    let release = await cachedRelease(db, api.namespace, version);
    if (!release) {
      release = await fetchRelease(db, api, version);
      fetched++;
    }
    chain.push(release);
    version = release.baseVersionCode;
  }
  return { chain: chain.reverse(), fetched };
}

// ── Replaying the releases into the hierarchy ────────────────────────────────────────────────

async function replay(db: Queryable, namespace: DirectoryNamespace, chain: CachedRelease[], issues: Issue[]): Promise<Map<string, Entry>> {
  const model = new Map<string, Entry>();
  for (const release of chain) {
    const { rows } = await db.query<{ change: ApiChange }>(
      `select change from directory_release_changes where namespace = $1 and version_code = $2 order by seq`,
      [namespace, release.versionCode],
    );
    for (const { change } of rows) applyChange(model, change, release.versionCode, issues);
  }
  return model;
}

function applyChange(model: Map<string, Entry>, change: ApiChange, release: string, issues: Issue[]) {
  const current = model.get(change.id);
  const note = (code: string, message: string) => issues.push({ code, message, details: { release, id: change.id, code: change.code, type: change.type } });
  switch (change.type) {
    case 'created': {
      const level = change.level ?? current?.level ?? null;
      const name = change.name ?? current?.name ?? null;
      if (!level || !name) return note('incomplete_row', `A created unit has no ${level ? 'name' : 'level'}`);
      model.set(change.id, {
        id: change.id,
        code: change.code ?? current?.code ?? null,
        level,
        name,
        parentId: change.parentId ?? change.toParentId ?? null,
        retired: isRetiredStatus(change.status),
      });
      return;
    }
    case 'moved':
      if (!current) return note('unknown_unit', 'A unit that was moved is not in the earlier releases');
      current.parentId = change.toParentId ?? change.parentId ?? current.parentId;
      if (change.name) current.name = change.name;
      if (change.code) current.code = change.code;
      return;
    case 'renamed':
      if (!current) return note('unknown_unit', 'A unit that was renamed is not in the earlier releases');
      if (change.name) current.name = change.name;
      if (change.code) current.code = change.code;
      return;
    case 'retired':
      if (!current) return note('unknown_unit', 'A unit that was retired is not in the earlier releases');
      current.retired = true;
      return;
  }
}

// ── Writing it: one transaction, with history ────────────────────────────────────────────────

type UnitRow = {
  id: string;
  uuid: string;
  external_id: string;
  level: ChurchLevel;
  name_key: string;
  official_name: string;
  display_name: string;
  parent_id: string | null;
  parent_level: ChurchLevel | null;
  state: string | null;
  status: 'active' | 'inactive';
};
type ParishRow = {
  id: string;
  uuid: string;
  external_id: string;
  unit_id: string;
  name_key: string;
  official_name: string;
  display_name: string;
  status: 'active' | 'inactive';
};
type Kind = 'create' | 'update' | 'move' | 'reactivate' | 'deactivate';
const UNIT_FIELDS = ['official_name', 'display_name', 'parent_id', 'parent_level', 'state', 'status'] as const;
const PARISH_FIELDS = ['unit_id', 'official_name', 'display_name', 'status'] as const;
const pick = <T extends object, K extends keyof T>(row: T, fields: readonly K[]) => Object.fromEntries(fields.map((field) => [field, row[field]])) as Pick<T, K>;

function kindOf(before: { status: string; parent?: string | null } | null, after: { status: string; parent?: string | null }): Kind {
  if (!before) return 'create';
  if (before.status !== after.status) return after.status === 'active' ? 'reactivate' : 'deactivate';
  if (before.parent !== after.parent) return 'move';
  return 'update';
}

async function batches<T>(rows: T[], run: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH) await run(rows.slice(start, start + BATCH));
}

const emptyCounts = () => ({ created: 0, updated: 0, moved: 0, deactivated: 0, reactivated: 0, unchanged: 0, kept: 0 });
const COUNT_FOR: Record<Kind, keyof ReturnType<typeof emptyCounts>> = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  deactivate: 'deactivated',
  reactivate: 'reactivated',
};

async function writeModel(
  connection: Queryable,
  input: { namespace: DirectoryNamespace; model: Map<string, Entry>; release: ApiRelease; importId: string; issues: Issue[] },
): Promise<Pick<SyncCounts, 'units' | 'parishes'>> {
  const { namespace, model, importId, issues } = input;
  const existingUnits = new Map(
    (
      await connection.query<UnitRow>(
        `select id, external_uuid::text as uuid, external_id, level::text as level, name_key, official_name, display_name,
                parent_id, parent_level::text as parent_level, state, status::text as status
           from church_units where external_namespace = $1`,
        [namespace],
      )
    ).rows.map((row) => [row.uuid, row]),
  );
  const existingParishes = new Map(
    (
      await connection.query<ParishRow>(
        `select id, external_uuid::text as uuid, external_id, unit_id, name_key, official_name, display_name, status::text as status
           from parishes where external_namespace = $1`,
        [namespace],
      )
    ).rows.map((row) => [row.uuid, row]),
  );

  // The units the releases describe, parents first. A unit whose parent the provider doesn't give
  // (or gives at a lower level) is left out and reported: nothing is made up to fill the gap.
  const units = new Map<string, UnitRow>();
  const noted = new Set<string>();
  const note = (entry: Entry, code: string, message: string) => {
    noted.add(entry.id);
    issues.push({ code, message, details: { id: entry.id, code: entry.code, level: entry.level, name: entry.name } });
  };
  for (const level of CHURCH_LEVELS) {
    for (const entry of model.values()) {
      if (entry.level !== level) continue;
      if (!entry.code) {
        note(entry, 'missing_code', 'A unit has no canonical code');
        continue;
      }
      const parent = entry.parentId ? model.get(entry.parentId) : undefined;
      let parentRow: UnitRow | null = null;
      if (entry.parentId && !parent) {
        note(entry, 'missing_parent', 'A unit’s parent is not in the releases');
        continue;
      }
      if (parent && parent.level !== 'intercontinental') {
        if (!isUnitLevel(parent.level) || UNIT_LEVELS.indexOf(parent.level) >= UNIT_LEVELS.indexOf(level)) {
          note(entry, 'bad_hierarchy', `A ${level} sits under a ${parent.level}`);
          continue;
        }
        parentRow = units.get(parent.id) ?? null;
        if (!parentRow) {
          note(entry, 'missing_parent', 'A unit’s parent was left out');
          continue;
        }
      }
      const official = cleanName(entry.name);
      if (!official) {
        note(entry, 'bad_name', 'A unit’s name is empty once cleaned');
        continue;
      }
      const display = displayName(official);
      const previous = existingUnits.get(entry.id);
      if (previous && previous.level !== level) {
        note(entry, 'level_changed', `A ${previous.level} became a ${level}: left as it was for staff to check`);
        continue;
      }
      units.set(entry.id, {
        id: previous?.id ?? randomUUID(),
        uuid: entry.id,
        external_id: externalIdOf(namespace, entry.code),
        level,
        name_key: unitKey(official),
        official_name: official,
        display_name: display,
        parent_id: parentRow?.id ?? null,
        parent_level: parentRow?.level ?? null,
        state: level === 'province' ? stateFromProvince(display) : null,
        // Under a retired unit, nothing stays in use (the consistency check requires it).
        status: entry.retired || parentRow?.status === 'inactive' ? 'inactive' : 'active',
      });
    }
  }

  const parishes = new Map<string, ParishRow>();
  for (const entry of model.values()) {
    if (entry.level !== 'parish') continue;
    if (!entry.code) {
      note(entry, 'missing_code', 'A parish has no canonical code');
      continue;
    }
    const parent = entry.parentId ? units.get(entry.parentId) : undefined;
    if (!parent) {
      note(entry, 'missing_parent', 'A parish’s unit is not in the releases (or was left out)');
      continue;
    }
    const official = cleanName(entry.name);
    if (!official) {
      note(entry, 'bad_name', 'A parish’s name is empty once cleaned');
      continue;
    }
    const previous = existingParishes.get(entry.id);
    parishes.set(entry.id, {
      id: previous?.id ?? randomUUID(),
      uuid: entry.id,
      external_id: externalIdOf(namespace, entry.code),
      unit_id: parent.id,
      name_key: parishKey(official),
      official_name: official,
      display_name: displayName(official),
      status: entry.retired || parent.status === 'inactive' ? 'inactive' : 'active',
    });
  }

  // What changes. Only a retirement in a release takes an entry out of use. One the releases no
  // longer describe usably (left out above with an issue, or missing from a chain the provider
  // started again) keeps its last good state and is reported: an absence is never proof of removal.
  const unitCounts = emptyCounts();
  const parishCounts = emptyCounts();
  const keep = (entity: 'unit' | 'parish', before: { uuid: string; external_id: string; status: string }, counts: ReturnType<typeof emptyCounts>) => {
    if (before.status === 'inactive') return;
    counts.kept++;
    if (noted.has(before.uuid)) return; // its issue is already listed
    issues.push({
      code: 'not_in_releases',
      message: `A ${entity} in use here is not in the provider's releases: kept as it was for staff to check`,
      details: { id: before.uuid, code: before.external_id.slice(namespace.length + 1), entity },
    });
  };
  const log: { entity: 'unit' | 'parish'; entity_id: string; change: Kind; before: unknown; after: unknown }[] = [];
  const unitWrites: { row: UnitRow; kind: Kind }[] = [];
  for (const row of units.values()) {
    const before = existingUnits.get(row.uuid) ?? null;
    const same = before && UNIT_FIELDS.every((field) => before[field] === row[field]) && before.external_id === row.external_id && before.name_key === row.name_key;
    if (same) {
      unitCounts.unchanged++;
      continue;
    }
    const kind = kindOf(before && { status: before.status, parent: before.parent_id }, { status: row.status, parent: row.parent_id });
    unitCounts[COUNT_FOR[kind]]++;
    unitWrites.push({ row, kind });
    log.push({ entity: 'unit', entity_id: row.id, change: kind, before: before && pick(before, UNIT_FIELDS), after: pick(row, UNIT_FIELDS) });
  }
  for (const before of existingUnits.values()) if (!units.has(before.uuid)) keep('unit', before, unitCounts);
  const parishWrites: { row: ParishRow; kind: Kind }[] = [];
  for (const row of parishes.values()) {
    const before = existingParishes.get(row.uuid) ?? null;
    const same = before && PARISH_FIELDS.every((field) => before[field] === row[field]) && before.external_id === row.external_id && before.name_key === row.name_key;
    if (same) {
      parishCounts.unchanged++;
      continue;
    }
    const kind = kindOf(before && { status: before.status, parent: before.unit_id }, { status: row.status, parent: row.unit_id });
    parishCounts[COUNT_FOR[kind]]++;
    parishWrites.push({ row, kind });
    log.push({ entity: 'parish', entity_id: row.id, change: kind, before: before && pick(before, PARISH_FIELDS), after: pick(row, PARISH_FIELDS) });
  }
  for (const before of existingParishes.values()) if (!parishes.has(before.uuid)) keep('parish', before, parishCounts);

  // New units level by level (a parent always exists first), then every update, then parishes.
  for (const level of CHURCH_LEVELS) {
    const created = unitWrites.filter((write) => write.kind === 'create' && write.row.level === level).map((write) => write.row);
    await batches(created, (batch) =>
      connection.query(
        `insert into church_units (id, level, name_key, official_name, display_name, parent_id, parent_level, state, status,
                                   external_id, external_namespace, external_uuid, origin)
         select r.id, r.level, r.name_key, r.official_name, r.display_name, r.parent_id, r.parent_level, r.state, r.status,
                r.external_id, $2, r.uuid, 'import'
           from jsonb_to_recordset($1::jsonb) as r(id uuid, level church_level, name_key text, official_name text, display_name text,
                parent_id uuid, parent_level church_level, state text, status directory_status, external_id text, uuid uuid)`,
        [JSON.stringify(batch), namespace],
      ),
    );
  }
  await batches(
    unitWrites.filter((write) => write.kind !== 'create').map((write) => write.row),
    (batch) =>
      connection.query(
        `update church_units u
            set name_key = r.name_key, official_name = r.official_name, display_name = r.display_name, parent_id = r.parent_id,
                parent_level = r.parent_level, state = r.state, status = r.status, external_id = r.external_id, updated_at = now()
           from jsonb_to_recordset($1::jsonb) as r(id uuid, name_key text, official_name text, display_name text, parent_id uuid,
                parent_level church_level, state text, status directory_status, external_id text)
          where u.id = r.id`,
        [JSON.stringify(batch)],
      ),
  );
  await batches(
    parishWrites.filter((write) => write.kind === 'create').map((write) => write.row),
    (batch) =>
      connection.query(
        `insert into parishes (id, unit_id, name_key, official_name, display_name, status, external_id, external_namespace, external_uuid, origin)
         select r.id, r.unit_id, r.name_key, r.official_name, r.display_name, r.status, r.external_id, $2, r.uuid, 'import'
           from jsonb_to_recordset($1::jsonb) as r(id uuid, unit_id uuid, name_key text, official_name text, display_name text,
                status directory_status, external_id text, uuid uuid)`,
        [JSON.stringify(batch), namespace],
      ),
  );
  await batches(
    parishWrites.filter((write) => write.kind !== 'create').map((write) => write.row),
    (batch) =>
      connection.query(
        `update parishes p
            set unit_id = r.unit_id, name_key = r.name_key, official_name = r.official_name, display_name = r.display_name,
                status = r.status, external_id = r.external_id, updated_at = now()
           from jsonb_to_recordset($1::jsonb) as r(id uuid, unit_id uuid, name_key text, official_name text, display_name text,
                status directory_status, external_id text)
          where p.id = r.id`,
        [JSON.stringify(batch)],
      ),
  );
  await batches(log, (batch) =>
    connection.query(
      `insert into directory_changes (import_id, via, entity, entity_id, change, before, after)
       select $1, 'import', r.entity, r.entity_id, r.change, r.before, r.after
         from jsonb_to_recordset($2::jsonb) as r(entity text, entity_id uuid, change text, before jsonb, after jsonb)`,
      [importId, JSON.stringify(batch)],
    ),
  );
  return { units: unitCounts, parishes: parishCounts };
}

/**
 * The first sync in a database that holds the spreadsheet's rows: they stop being used (deactivated,
 * kept with their history, so applications linked to them keep their link and snapshot), and each
 * spreadsheet parish that applications link to is compared with the API's parishes by exact name and
 * chain. Nothing is relinked: the report is for staff, who link applications through Parish review.
 */
async function handOver(connection: Queryable, namespace: DirectoryNamespace, importId: string): Promise<SyncCounts['handover']> {
  const { rows } = await connection.query<{ units: number; parishes: number }>(
    `select (select count(*)::int from church_units where external_id is null and status <> 'inactive') as units,
            (select count(*)::int from parishes where external_id is null and status <> 'inactive') as parishes`,
  );
  const active = rows[0]!;
  const referenced = await connection.query<{ n: number }>(
    `select count(*)::int as n from parishes p where p.external_id is null
        and exists (select 1 from applications a where a.parish_id = p.id)
        and not exists (select 1 from directory_legacy_matches m where m.legacy_parish_id = p.id and m.namespace = $1)`,
    [namespace],
  );
  if (!active.units && !active.parishes && !referenced.rows[0]!.n) return null;

  for (const [table, entity, fields] of [
    ['church_units', 'unit', `'official_name', official_name, 'display_name', display_name, 'parent_id', parent_id, 'parent_level', parent_level, 'state', state`],
    ['parishes', 'parish', `'unit_id', unit_id, 'official_name', official_name, 'display_name', display_name`],
  ] as const) {
    await connection.query(
      `with gone as (
         update ${table} set status = 'inactive', updated_at = now()
          where external_id is null and status = 'active'
          returning id, jsonb_build_object(${fields}) as fields)
       insert into directory_changes (import_id, via, entity, entity_id, change, before, after)
       select $1, 'import', '${entity}', id, 'deactivate', fields || '{"status":"active"}', fields || '{"status":"inactive"}' from gone`,
      [importId],
    );
  }

  return refreshLegacyMatches(connection, namespace, active);
}

/**
 * The handover's report, computed again: each spreadsheet parish that applications link to, with
 * the API parishes that have exactly the same name and chain (the same keys imports use, compared
 * level by level; a missing level only matches a missing level). Never "similar" names.
 */
export async function refreshLegacyMatches(
  connection: Queryable,
  namespace: DirectoryNamespace,
  deactivated: { units: number; parishes: number } = { units: 0, parishes: 0 },
): Promise<NonNullable<SyncCounts['handover']>> {
  await connection.query(
    `with legacy as (
       select p.id, p.name_key, c.name_key as continent, r.name_key as region, v.name_key as province,
              (select count(*)::int from applications a where a.parish_id = p.id) as applications
         from parishes p
         left join church_units c on c.id = p.continent_id
         left join church_units r on r.id = p.region_id
         left join church_units v on v.id = p.province_id
        where p.external_id is null and exists (select 1 from applications a where a.parish_id = p.id)),
     candidates as (
       select l.id, l.applications,
              coalesce(array_agg(n.id order by n.id) filter (where n.id is not null), '{}') as ids
         from legacy l
         left join parishes n on n.external_namespace = $1 and n.status = 'active' and n.name_key = l.name_key
               and (select name_key from church_units where id = n.continent_id) is not distinct from l.continent
               and (select name_key from church_units where id = n.region_id) is not distinct from l.region
               and (select name_key from church_units where id = n.province_id) is not distinct from l.province
        group by l.id, l.applications)
     insert into directory_legacy_matches (legacy_parish_id, namespace, status, candidate_ids, applications, checked_at)
     select id, $1,
            (case cardinality(ids) when 0 then 'unmatched' when 1 then 'matched' else 'ambiguous' end)::legacy_match_status,
            ids, applications, now()
       from candidates
     on conflict (legacy_parish_id) do update
        set namespace = excluded.namespace, status = excluded.status, candidate_ids = excluded.candidate_ids,
            applications = excluded.applications, checked_at = excluded.checked_at`,
    [namespace],
  );
  const matches = await connection.query<{ status: string; n: number }>(
    `select status::text as status, count(*)::int as n from directory_legacy_matches where namespace = $1 group by 1`,
    [namespace],
  );
  const by = Object.fromEntries(matches.rows.map((row) => [row.status, row.n]));
  return { units: deactivated.units, parishes: deactivated.parishes, matched: by.matched ?? 0, ambiguous: by.ambiguous ?? 0, unmatched: by.unmatched ?? 0 };
}

// ── The sync, and what the rest of the site asks about it ────────────────────────────────────

export type SyncState = {
  namespace: DirectoryNamespace;
  releaseVersion: string | null;
  releaseName: string | null;
  effectiveFrom: string | null;
  checkedAt: string | null;
  syncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  failures: number;
};

const iso = (value: string | Date | null) => (value ? new Date(value).toISOString() : null);

export async function syncState(db: Queryable, namespace: DirectoryNamespace): Promise<SyncState | null> {
  const { rows } = await db.query<{
    release_version: string | null;
    release_name: string | null;
    effective_from: string | Date | null;
    checked_at: string | Date | null;
    synced_at: string | Date | null;
    last_error: string | null;
    last_error_at: string | Date | null;
    failures: number;
  }>(`select * from directory_sync where namespace = $1`, [namespace]);
  const row = rows[0];
  if (!row) return null;
  return {
    namespace,
    releaseVersion: row.release_version,
    releaseName: row.release_name,
    effectiveFrom: iso(row.effective_from),
    checkedAt: iso(row.checked_at),
    syncedAt: iso(row.synced_at),
    lastError: row.last_error,
    lastErrorAt: iso(row.last_error_at),
    failures: row.failures,
  };
}

/** Whether the provider confirmed the release in use recently enough (`hours`) to rely on it without asking. */
export function isFresh(state: SyncState | null, hours: number, now = new Date()): boolean {
  if (!state?.checkedAt || !state.releaseVersion) return false;
  return now.getTime() - Date.parse(state.checkedAt) <= hours * 3_600_000;
}

async function recordFailure(db: Queryable, namespace: DirectoryNamespace, code: string) {
  await db.query(
    `insert into directory_sync (namespace, last_error, last_error_at, failures, updated_at) values ($1, $2, now(), 1, now())
     on conflict (namespace) do update
        set last_error = excluded.last_error, last_error_at = now(), failures = directory_sync.failures + 1, updated_at = now()`,
    [namespace, code],
  );
}

/**
 * The day the release's structure is correct for, as the church counts days: in Lagos. Releases take
 * effect at local midnight ("17th August 2026 approved list" is effective 2026-08-16T23:00Z), so the
 * UTC date would be a day early.
 */
const structureDate = (effectiveFrom: string | null) =>
  effectiveFrom && Number.isFinite(Date.parse(effectiveFrom)) ? utcToZonedLocal(new Date(effectiveFrom), DEFAULT_TIME_ZONE).slice(0, 10) : null;

const errorCode = (error: unknown): string =>
  error instanceof DirectoryApiError ? `api_${error.kind}` : error instanceof SyncError ? error.code : error instanceof DirectoryError ? 'inconsistent' : 'internal';

/**
 * Brings the directory up to the provider's latest release. `current` when nothing changed (the
 * confirmation time is recorded), `applied` with counts after writing a new release, `failed` with
 * a short code otherwise: then nothing was changed and the last good state stays in use.
 */
export async function syncDirectory(
  db: Db,
  api: DirectoryApi,
  options: { via?: 'sync' | 'cli' | 'admin'; staffId?: string | null; force?: boolean } = {},
): Promise<SyncResult> {
  const { namespace } = api;
  try {
    const latest = await api.latestRelease();
    const state = await syncState(db, namespace);
    if (!latest) {
      await db.query(
        `insert into directory_sync (namespace, checked_at, failures, updated_at) values ($1, now(), 0, now())
         on conflict (namespace) do update set checked_at = now(), failures = 0, last_error = null, updated_at = now()`,
        [namespace],
      );
      return { status: 'current', namespace, release: state?.releaseVersion ?? null };
    }
    if (state?.releaseVersion === latest.versionCode && state.syncedAt && !options.force) {
      await db.query(`update directory_sync set checked_at = now(), failures = 0, last_error = null, updated_at = now() where namespace = $1`, [namespace]);
      return { status: 'current', namespace, release: latest.versionCode };
    }

    const { chain, fetched } = await releaseChain(db, api, latest.versionCode);
    const issues: Issue[] = [];
    const model = await replay(db, namespace, chain, issues);
    if (!model.size) throw new SyncError('empty_release', 'The latest release describes no units');

    const result = await inTransaction(db, async (connection) => {
      // One writer at a time (the worker's schedule, the CLI, an admin's "check now").
      await connection.query(`select pg_advisory_xact_lock(${SYNC_LOCK})`);
      const label = `RCCG directory API (${api.env}), release ${latest.versionCode}`.slice(0, 200);
      const { rows } = await connection.query<{ id: string }>(
        `insert into directory_imports (source, source_label, structure_as_at, status, via, staff_id, finished_at)
         values ('api', $1, $2, 'applied', $3, $4, now()) returning id`,
        [label, structureDate(latest.effectiveFrom), options.via ?? 'sync', options.staffId ?? null],
      );
      const importId = rows[0]!.id;
      const written = await writeModel(connection, { namespace, model, release: latest, importId, issues });
      // Chains first: the handover compares them to find possible matches.
      await rebuildCaches(connection);
      const handover = await handOver(connection, namespace, importId);
      const consistency = await checkConsistency(connection);
      if (!isConsistent(consistency)) throw new DirectoryError(`The directory would be inconsistent after release ${latest.versionCode}`);
      await batches(issues, (batch) =>
        connection.query(
          `insert into directory_issues (import_id, severity, code, message, details)
           select $1, 'warning', r.code, r.message, r.details from jsonb_to_recordset($2::jsonb) as r(code text, message text, details jsonb)`,
          [importId, JSON.stringify(batch.map((issue) => ({ ...issue, message: issue.message.slice(0, 500) })))],
        ),
      );
      const counts: SyncCounts = { release: latest.versionCode, ...written, issues: issues.length, handover, fetchedReleases: fetched };
      await connection.query(`update directory_imports set counts = $2 where id = $1`, [importId, JSON.stringify(counts)]);
      await connection.query(
        `insert into directory_sync (namespace, release_version, release_id, release_name, effective_from, checked_at, synced_at, import_id,
                                     last_error, last_error_at, failures, updated_at)
         values ($1, $2, $3, $4, $5, now(), now(), $6, null, null, 0, now())
         on conflict (namespace) do update
            set release_version = excluded.release_version, release_id = excluded.release_id, release_name = excluded.release_name,
                effective_from = excluded.effective_from, checked_at = now(), synced_at = now(), import_id = excluded.import_id,
                last_error = null, last_error_at = null, failures = 0, updated_at = now()`,
        [namespace, latest.versionCode, latest.id, latest.name.slice(0, 200), latest.effectiveFrom, importId],
      );
      return { importId, counts };
    });
    return { status: 'applied', namespace, release: latest.versionCode, ...result };
  } catch (error) {
    const code = errorCode(error);
    await recordFailure(db, namespace, code).catch(() => undefined);
    return { status: 'failed', namespace, error: code };
  }
}
