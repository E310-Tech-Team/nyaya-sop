/**
 * The parish directory for staff (/api/admin/directory): browse and search it, an entry's
 * details and history, corrections (server/directory/edits.ts), the imports and their issues,
 * and the 2026 changes waiting for updated data. Directory data and counts only: no applicant
 * details.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CHURCH_LEVELS, type ChurchLevel } from '../../src/shared/directory';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import type { Queryable } from '../db';
import {
  createParish,
  createUnit,
  EDITABLE_LEVELS,
  mergeParish,
  mergeUnit,
  splitParish,
  updateParish,
  updateUnit,
  type EditableLevel,
  type ParishChanges,
  type UnitChanges,
} from '../directory/edits';
import { DIRECTORY_SYNC_JOB } from '../directory/api-jobs';
import { isFresh, syncState } from '../directory/api-sync';
import { apiSuppliesDirectory, DirectoryError } from '../directory/store';
import { iso, isUuid, paging, sendError } from '../http';
import { enqueue } from '../jobs/queue';
import { parishDetails, searchParishes } from '../parishes';
import { directoryNamespace, type Services } from '../services';

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Units in their natural order: "Lagos Province 2" before "Lagos Province 10".
const NATURAL = (column: string) => `regexp_replace(${column}, '\\d+$', ''), coalesce(substring(${column} from '(\\d+)$')::numeric, 0), ${column}`;

// Touched by the August 2026 changes: a new unit, or one a new unit was created from (unit_lineage).
const CHANGED_2026 = `exists (select 1 from unit_lineage l
  where (l.level = u.level and l.new_key = u.name_key) or (l.source_level = u.level and l.source_key = u.name_key))`;

type UnitBrief = { id: string; name: string; level: ChurchLevel };

/** The units above this one, from the continent down. */
async function ancestorsOf(db: Queryable, parentId: string | null): Promise<UnitBrief[]> {
  const chain: UnitBrief[] = [];
  for (let next = parentId, hops = 0; next && hops < CHURCH_LEVELS.length; hops++) {
    const { rows } = await db.query<UnitBrief & { parent_id: string | null }>(
      `select id, display_name as name, level::text as level, parent_id from church_units where id = $1`,
      [next],
    );
    if (!rows[0]) break;
    chain.unshift({ id: rows[0].id, name: rows[0].name, level: rows[0].level });
    next = rows[0].parent_id;
  }
  return chain;
}

/**
 * Counts for Settings and the directory screen: what's loaded, from where, and what's waiting. The
 * counts are of the source in use (the RCCG directory API's environment, or the imported list), and
 * `api` says how current the API's copy is: never the key, only its environment and figures.
 */
export async function directoryReadiness(services: Pick<Services, 'db' | 'directory' | 'config'>) {
  const { db } = services;
  const namespace = directoryNamespace(services);
  const levels = await db.query<{ level: ChurchLevel; active: number; total: number }>(
    `select level::text as level, count(*) filter (where status = 'active')::int as active, count(*)::int as total
       from church_units where external_namespace is not distinct from $1::text group by level`,
    [namespace],
  );
  const parishes = await db.query<{ active: number; inactive: number; merged: number; staff_added: number }>(
    `select count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'inactive')::int as inactive,
            count(*) filter (where status = 'merged')::int as merged, count(*) filter (where origin = 'staff')::int as staff_added
       from parishes where external_namespace is not distinct from $1::text`,
    [namespace],
  );
  const latest = await db.query<{ id: string; source: string; source_label: string; structure_as_at: string | null; via: string; finished_at: Date | null }>(
    `select id, source::text as source, source_label, structure_as_at::text as structure_as_at, via, finished_at
       from directory_imports where status = 'applied' order by started_at desc limit 1`,
  );
  const extra = await db.query<{ corrections: number; waiting: number; reviews: number }>(
    `select (select count(*)::int from directory_changes where via = 'staff') as corrections,
            (select count(*)::int from (select distinct level, new_key from unit_lineage l
               where not exists (select 1 from church_units u where u.level = l.level and u.name_key = l.new_key)) w) as waiting,
            (select count(*)::int from parish_reports where status = 'pending')
              + (select count(*)::int from applications where parish_status = 'legacy_text' and parish_id is null and parish_text_reviewed_at is null) as reviews`,
  );
  const byLevel = Object.fromEntries(CHURCH_LEVELS.map((level) => [level, { active: 0, total: 0 }])) as Record<ChurchLevel, { active: number; total: number }>;
  for (const row of levels.rows) byLevel[row.level] = { active: row.active, total: row.total };
  const counts = parishes.rows[0]!;
  const last = latest.rows[0];
  return {
    levels: byLevel,
    parishes: { active: counts.active, inactive: counts.inactive, merged: counts.merged, staffAdded: counts.staff_added },
    latestImport: last
      ? { id: last.id, source: last.source, label: last.source_label, structureAsAt: last.structure_as_at, via: last.via, finishedAt: iso(last.finished_at) }
      : null,
    corrections: extra.rows[0]!.corrections,
    lineageWaiting: extra.rows[0]!.waiting,
    pendingReviews: extra.rows[0]!.reviews,
    api: await apiStatus(services),
  };
}

/** The RCCG directory API's side of the readiness: environment, release, freshness, last failure, handover report. */
async function apiStatus(services: Pick<Services, 'db' | 'directory' | 'config'>) {
  const namespace = directoryNamespace(services);
  if (!namespace || !services.config.directoryApi) return null;
  const state = await syncState(services.db, namespace);
  const legacy = await services.db.query<{ status: string; n: number }>(
    `select status::text as status, count(*)::int as n from directory_legacy_matches where namespace = $1 group by 1`,
    [namespace],
  );
  const handover = Object.fromEntries(legacy.rows.map((row) => [row.status, row.n]));
  return {
    env: services.config.directoryApi.env,
    release: state?.releaseVersion ?? null,
    releaseName: state?.releaseName ?? null,
    effectiveFrom: state?.effectiveFrom ?? null,
    checkedAt: state?.checkedAt ?? null,
    syncedAt: state?.syncedAt ?? null,
    fresh: isFresh(state, services.config.directoryApi.freshnessHours),
    freshnessHours: services.config.directoryApi.freshnessHours,
    syncIntervalMinutes: services.config.directoryApi.syncIntervalMinutes,
    lastError: state?.lastError ?? null,
    lastErrorAt: state?.lastErrorAt ?? null,
    failures: state?.failures ?? 0,
    oldList: { matched: handover.matched ?? 0, ambiguous: handover.ambiguous ?? 0, unmatched: handover.unmatched ?? 0 },
  };
}

type HistoryRow = { id: string; created_at: Date; via: string; change: string; before: Record<string, unknown> | null; after: Record<string, unknown>; staff: string | null; import_label: string | null };

/** An entry's changes, newest first, with the names of the units and parishes they mention. */
async function historyOf(db: Queryable, entity: 'unit' | 'parish', id: string) {
  const { rows } = await db.query<HistoryRow>(
    `select c.id::text as id, c.created_at, c.via, c.change, c.before, c.after, s.display_name as staff, i.source_label as import_label
       from directory_changes c
       left join staff_users s on s.id = c.staff_id
       left join directory_imports i on i.id = c.import_id
      where c.entity = $1 and c.entity_id = $2
      order by c.id desc limit 50`,
    [entity, id],
  );
  const ids = new Set<string>();
  for (const row of rows) {
    for (const values of [row.before, row.after]) {
      for (const key of ['unit_id', 'parent_id', 'merged_into_id', 'split_from']) {
        const value = values?.[key];
        if (isUuid(value)) ids.add(value);
      }
    }
  }
  const names: Record<string, string> = {};
  if (ids.size) {
    const found = await db.query<{ id: string; name: string }>(
      `select id, display_name as name from church_units where id in (select value::uuid from jsonb_array_elements_text($1::jsonb))
       union all
       select id, display_name from parishes where id in (select value::uuid from jsonb_array_elements_text($1::jsonb))`,
      [JSON.stringify([...ids])],
    );
    for (const row of found.rows) names[row.id] = row.name;
  }
  return {
    items: rows.map((row) => ({
      id: row.id,
      at: iso(row.created_at),
      via: row.via,
      change: row.change,
      before: row.before,
      after: row.after,
      by: row.via === 'staff' ? (row.staff ?? 'Former staff member') : `Import: ${row.import_label ?? 'unknown file'}`,
    })),
    names,
  };
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof DirectoryError) return sendError(reply, 400, 'VALIDATION_FAILED', error.message);
  throw error;
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

export async function directoryRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const canView = staffGuard(services, { permission: 'directory.view' });
  const canManage = staffGuard(services, { permission: 'directory.manage' });

  app.get('/overview', { preHandler: canView }, async () => directoryReadiness(services));

  /** "Check for updates now": queues a sync of the RCCG directory API for the worker (never runs it in the request). */
  app.post('/sync', { preHandler: canManage, config: { rateLimit: { max: 6, timeWindow: 60_000 } } }, async (request, reply) => {
    if (!services.directory) return sendError(reply, 409, 'CONFLICT', 'The RCCG directory API isn’t configured on this server (docs/DEPLOYMENT.md, “Directory API”).');
    await enqueue(db, { kind: DIRECTORY_SYNC_JOB, dedupeKey: `${DIRECTORY_SYNC_JOB}:manual:${new Date().toISOString().slice(0, 16)}`, maxAttempts: 1 });
    await audit(db, { type: 'staff', id: request.staff!.id }, 'directory.sync_requested', { type: 'directory', id: services.directory.namespace });
    return reply.code(202).send({ queued: true });
  });

  /** One level of the tree: the units under a unit (continents at the top) and the parishes directly under it. */
  app.get<{ Querystring: { unit?: string; q?: string; page?: string; pageSize?: string; show?: string } }>('/browse', { preHandler: canView }, async (request, reply) => {
    const { unit: unitId, q, show } = request.query;
    const everything = show === 'all';
    type BrowsedUnit = UnitBrief & { parent_id: string | null; status: string; state: string | null; origin: string; staff_fields: string[] };
    let unit: BrowsedUnit | null = null;
    if (unitId) {
      if (!isUuid(unitId)) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
      const { rows } = await db.query<BrowsedUnit>(
        `select id, display_name as name, level::text as level, parent_id, status::text as status, state, origin::text as origin,
                to_jsonb(staff_fields) as staff_fields
           from church_units where id = $1`,
        [unitId],
      );
      unit = rows[0] ?? null;
      if (!unit) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
    }
    const children = await db.query<{
      id: string;
      name: string;
      level: ChurchLevel;
      status: string;
      state: string | null;
      origin: string;
      corrected: boolean;
      units: number;
      parishes: number;
      changed_2026: boolean;
    }>(
      `select u.id, u.display_name as name, u.level::text as level, u.status::text as status, u.state, u.origin::text as origin,
              cardinality(u.staff_fields) > 0 as corrected,
              (select count(*)::int from church_units c where c.parent_id = u.id and c.status = 'active') as units,
              (select count(*)::int from parishes p where p.status = 'active'
                 and u.id in (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)) as parishes,
              ${CHANGED_2026} as changed_2026
         from church_units u
        where u.parent_id is not distinct from $1::uuid and ($2::boolean or u.status = 'active')
        order by u.level, ${NATURAL('u.name_key')}`,
      [unit?.id ?? null, everything],
    );
    const { page, pageSize, offset } = paging(request.query, 100);
    const search = q?.trim().slice(0, 100);
    const parishes = unit
      ? await db.query<{
          id: string;
          name: string;
          status: string;
          listed_rows: number;
          origin: string;
          corrected: boolean;
          applications: number;
          total: number;
        }>(
          `select p.id, p.display_name as name, p.status::text as status, p.listed_rows, p.origin::text as origin,
                  cardinality(p.staff_fields) > 0 as corrected,
                  (select count(*)::int from applications a where a.parish_id = p.id) as applications,
                  count(*) over ()::int as total
             from parishes p
            where p.unit_id = $1 and ($2::boolean or p.status = 'active') and ($3::text is null or p.display_name ilike $3::text)
            order by p.name_key, p.id
            limit ${pageSize} offset ${offset}`,
          [unit.id, everything, search ? `%${escapeLike(search)}%` : null],
        )
      : { rows: [] };
    return {
      apiManaged: await apiSuppliesDirectory(db),
      unit: unit
        ? {
            id: unit.id,
            name: unit.name,
            level: unit.level,
            status: unit.status,
            state: unit.state,
            origin: unit.origin,
            corrected: unit.staff_fields,
          }
        : null,
      ancestors: unit ? await ancestorsOf(db, unit.parent_id) : [],
      children: children.rows.map((row) => ({
        id: row.id,
        name: row.name,
        level: row.level,
        status: row.status,
        state: row.state,
        origin: row.origin,
        corrected: row.corrected,
        units: row.units,
        parishes: row.parishes,
        changed2026: row.changed_2026,
      })),
      parishes: {
        page,
        pageSize,
        total: parishes.rows[0]?.total ?? 0,
        items: parishes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          listedRows: row.listed_rows,
          origin: row.origin,
          corrected: row.corrected,
          applications: row.applications,
        })),
      },
    };
  });

  /** For pickers: active units by name, or active parishes as applicants find them. */
  app.get<{ Querystring: { q?: string; kind?: string; level?: string } }>('/search', { preHandler: canView }, async (request, reply) => {
    const query = request.query.q?.trim() ?? '';
    if (query.length < 2 || query.length > 60) return sendError(reply, 400, 'BAD_REQUEST', 'Type between 2 and 60 characters.');
    if (request.query.kind === 'parish') return { parishes: (await searchParishes(db, query, null, 10, directoryNamespace(services))).results, units: [] };
    const level = CHURCH_LEVELS.includes(request.query.level as ChurchLevel) ? request.query.level : null;
    const { rows } = await db.query<{ id: string; name: string; level: ChurchLevel; parent: string | null }>(
      `select u.id, u.display_name as name, u.level::text as level, parent.display_name as parent
         from church_units u left join church_units parent on parent.id = u.parent_id
        where u.status = 'active' and ($2::church_level is null or u.level = $2::church_level)
          and (u.display_name ilike $1::text or u.name_key ilike $1::text)
        order by u.level, ${NATURAL('u.name_key')}
        limit 12`,
      [`%${escapeLike(query)}%`, level],
    );
    return { units: rows, parishes: [] };
  });

  app.get<{ Params: { id: string } }>('/units/:id', { preHandler: canView }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
    const { rows } = await db.query<{
      id: string;
      level: ChurchLevel;
      name: string;
      name_key: string;
      official_name: string;
      state: string | null;
      status: string;
      external_id: string | null;
      origin: string;
      staff_fields: string[];
      parent_id: string | null;
      merged_into_id: string | null;
      merged_into: string | null;
      units: number;
      active_parishes: number;
      parishes: number;
      applications: number;
    }>(
      `select u.id, u.level::text as level, u.display_name as name, u.name_key, u.official_name, u.state, u.status::text as status, u.external_id,
              u.origin::text as origin, to_jsonb(u.staff_fields) as staff_fields, u.parent_id, u.merged_into_id, m.display_name as merged_into,
              (select count(*)::int from church_units c where c.parent_id = u.id and c.status = 'active') as units,
              (select count(*)::int from parishes p where p.status = 'active' and u.id in (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)) as active_parishes,
              (select count(*)::int from parishes p where p.unit_id = u.id) as parishes,
              (select count(*)::int from applications a join parishes p on p.id = a.parish_id
                where u.id in (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)) as applications
         from church_units u left join church_units m on m.id = u.merged_into_id
        where u.id = $1`,
      [request.params.id],
    );
    const unit = rows[0];
    if (!unit) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
    const lineage = await db.query<{ role: 'new' | 'source'; name: string; level: ChurchLevel; approved_on: string | null }>(
      `select 'new' as role, source_name as name, source_level::text as level, approved_on::text as approved_on
         from unit_lineage where level = $1::church_level and new_key = $2::text
       union all
       select 'source', new_name, level::text, approved_on::text from unit_lineage where source_level = $1::church_level and source_key = $2::text`,
      [unit.level, unit.name_key],
    );
    return {
      unit: {
        id: unit.id,
        level: unit.level,
        name: unit.name,
        officialName: unit.official_name,
        state: unit.state,
        status: unit.status,
        origin: unit.origin,
        corrected: unit.staff_fields,
        mergedInto: unit.merged_into_id ? { id: unit.merged_into_id, name: unit.merged_into } : null,
        externalId: unit.external_id,
      },
      apiManaged: await apiSuppliesDirectory(db),
      ancestors: await ancestorsOf(db, unit.parent_id),
      counts: { units: unit.units, activeParishes: unit.active_parishes, parishesDirectly: unit.parishes, applications: unit.applications },
      lineage: {
        createdFrom: lineage.rows.filter((row) => row.role === 'new').map(({ name, level, approved_on }) => ({ name, level, approvedOn: approved_on })),
        sourceOf: lineage.rows.filter((row) => row.role === 'source').map(({ name, level, approved_on }) => ({ name, level, approvedOn: approved_on })),
      },
      history: await historyOf(db, 'unit', unit.id),
    };
  });

  app.get<{ Params: { id: string } }>('/parishes/:id', { preHandler: canView }, async (request, reply) => {
    const details = await parishDetails(db, request.params.id);
    if (!details) return sendError(reply, 404, 'NOT_FOUND', 'There is no parish with that ID.');
    const { rows } = await db.query<{
      official_name: string;
      origin: string;
      listed_rows: number;
      staff_fields: string[];
      external_id: string | null;
      unit_id: string;
      unit_name: string;
      unit_level: ChurchLevel;
      source_unit_id: string | null;
      source_unit: string | null;
      applications: number;
    }>(
      `select p.official_name, p.origin::text as origin, p.listed_rows, to_jsonb(p.staff_fields) as staff_fields, p.external_id,
              p.unit_id, u.display_name as unit_name, u.level::text as unit_level, p.source_unit_id, s.display_name as source_unit,
              (select count(*)::int from applications a where a.parish_id = p.id) as applications
         from parishes p join church_units u on u.id = p.unit_id left join church_units s on s.id = p.source_unit_id
        where p.id = $1`,
      [details.id],
    );
    const extra = rows[0]!;
    const aliases = await db.query<{ alias: string }>(`select alias from parish_aliases where parish_id = $1 order by alias`, [details.id]);
    return {
      parish: {
        ...details,
        officialName: extra.official_name,
        origin: extra.origin,
        listedRows: extra.listed_rows,
        corrected: extra.staff_fields,
        unit: { id: extra.unit_id, name: extra.unit_name, level: extra.unit_level },
        listedUnder: extra.source_unit_id ? { id: extra.source_unit_id, name: extra.source_unit } : null,
        externalId: extra.external_id,
      },
      aliases: aliases.rows.map((row) => row.alias).filter((alias) => alias !== details.name && alias !== extra.official_name),
      applications: extra.applications,
      history: await historyOf(db, 'parish', details.id),
      // Entries come from the RCCG directory API: staff correct them there, not here.
      apiManaged: await apiSuppliesDirectory(db),
    };
  });

  // ── Corrections (directory.manage) ─────────────────────────────────────────

  app.post('/units', { preHandler: canManage }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!EDITABLE_LEVELS.includes(body.level as EditableLevel)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose a continent, region or province.');
    if (body.parentId !== null && body.parentId !== undefined && !isUuid(body.parentId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the unit it sits under.');
    try {
      const id = await createUnit(
        db,
        {
          level: body.level as EditableLevel,
          name: text(body.name) ?? '',
          parentId: (body.parentId as string | null | undefined) ?? null,
          ...('state' in body ? { state: body.state as string | null } : {}),
        },
        request.staff!.id,
      );
      return reply.code(201).send({ id });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/units/:id', { preHandler: canManage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const changes: UnitChanges = {};
    if ('displayName' in body) changes.displayName = text(body.displayName) ?? '';
    if ('parentId' in body) {
      if (!isUuid(body.parentId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the unit it sits under.');
      changes.parentId = body.parentId;
    }
    if ('state' in body) changes.state = body.state as string | null;
    try {
      return { ok: true, changed: await updateUnit(db, request.params.id, changes, request.staff!.id) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/units/:id/merge', { preHandler: canManage }, async (request, reply) => {
    const intoId = (request.body as { intoId?: unknown } | null)?.intoId;
    if (!isUuid(request.params.id) || !isUuid(intoId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the unit to merge into.');
    try {
      return { ok: true, ...(await mergeUnit(db, request.params.id, intoId, request.staff!.id)) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/parishes', { preHandler: canManage }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!isUuid(body.unitId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the unit the parish is in.');
    try {
      const id = await createParish(db, { unitId: body.unitId, name: text(body.name) ?? '' }, request.staff!.id);
      return reply.code(201).send({ id });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/parishes/:id', { preHandler: canManage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'There is no parish with that ID.');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const changes: ParishChanges = {};
    if ('displayName' in body) changes.displayName = text(body.displayName) ?? '';
    if ('unitId' in body) {
      if (!isUuid(body.unitId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the unit to move it to.');
      changes.unitId = body.unitId;
    }
    if ('status' in body) {
      if (body.status !== 'active' && body.status !== 'inactive') return sendError(reply, 400, 'VALIDATION_FAILED', 'Status must be active or inactive.');
      changes.status = body.status;
    }
    try {
      return { ok: true, changed: await updateParish(db, request.params.id, changes, request.staff!.id) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/parishes/:id/merge', { preHandler: canManage }, async (request, reply) => {
    const intoId = (request.body as { intoId?: unknown } | null)?.intoId;
    if (!isUuid(request.params.id) || !isUuid(intoId)) return sendError(reply, 400, 'VALIDATION_FAILED', 'Choose the parish to merge into.');
    try {
      return { ok: true, ...(await mergeParish(db, request.params.id, intoId, request.staff!.id)) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/parishes/:id/split', { preHandler: canManage }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'There is no parish with that ID.');
    try {
      const id = await splitParish(db, request.params.id, text((request.body as Record<string, unknown> | null)?.name) ?? '', request.staff!.id);
      return reply.code(201).send({ id });
    } catch (error) {
      return fail(reply, error);
    }
  });

  // ── Imports and the 2026 changes ─────────────────────────────────────────

  app.get<{ Querystring: { page?: string; pageSize?: string } }>('/imports', { preHandler: canView }, async (request) => {
    const { page, pageSize, offset } = paging(request.query, 50);
    const { rows } = await db.query<{
      id: string;
      source: string;
      source_label: string;
      structure_as_at: string | null;
      status: string;
      via: string;
      started_at: Date;
      finished_at: Date | null;
      reverted_at: Date | null;
      counts: Record<string, unknown>;
      error: string | null;
      staff: string | null;
      issues: Record<string, number> | null;
      total: number;
    }>(
      `select i.id, i.source::text as source, i.source_label, i.structure_as_at::text as structure_as_at, i.status::text as status, i.via,
              i.started_at, i.finished_at, i.reverted_at, i.counts, i.error, s.display_name as staff,
              (select jsonb_object_agg(severity, n) from (select severity, count(*)::int as n from directory_issues where import_id = i.id group by severity) x) as issues,
              count(*) over ()::int as total
         from directory_imports i left join staff_users s on s.id = i.staff_id
        order by i.started_at desc limit ${pageSize} offset ${offset}`,
    );
    return {
      page,
      pageSize,
      total: rows[0]?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        source: row.source,
        label: row.source_label,
        structureAsAt: row.structure_as_at,
        status: row.status,
        via: row.via,
        by: row.staff,
        startedAt: iso(row.started_at),
        finishedAt: iso(row.finished_at),
        revertedAt: iso(row.reverted_at),
        counts: row.counts,
        error: row.error,
        issues: { error: row.issues?.error ?? 0, warning: row.issues?.warning ?? 0, info: row.issues?.info ?? 0 },
      })),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { code?: string; page?: string; pageSize?: string } }>('/imports/:id', { preHandler: canView }, async (request, reply) => {
    if (!isUuid(request.params.id)) return sendError(reply, 404, 'NOT_FOUND', 'There is no import with that ID.');
    const found = await db.query<{ id: string; source_label: string; structure_as_at: string | null; status: string; started_at: Date; counts: Record<string, unknown> }>(
      `select id, source_label, structure_as_at::text as structure_as_at, status::text as status, started_at, counts from directory_imports where id = $1`,
      [request.params.id],
    );
    const record = found.rows[0];
    if (!record) return sendError(reply, 404, 'NOT_FOUND', 'There is no import with that ID.');
    const codes = await db.query<{ code: string; severity: string; n: number }>(
      `select code, severity, count(*)::int as n from directory_issues where import_id = $1 group by code, severity
        order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, n desc`,
      [record.id],
    );
    const { page, pageSize, offset } = paging(request.query, 100);
    const code = request.query.code && /^[a-z_]{1,40}$/.test(request.query.code) ? request.query.code : null;
    const issues = await db.query<{ line: number | null; severity: string; code: string; message: string; details: Record<string, unknown>; total: number }>(
      `select line, severity, code, message, details, count(*) over ()::int as total
         from directory_issues where import_id = $1 and ($2::text is null or code = $2::text)
        order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, line nulls last, id
        limit ${pageSize} offset ${offset}`,
      [record.id, code],
    );
    return {
      import: { id: record.id, label: record.source_label, structureAsAt: record.structure_as_at, status: record.status, startedAt: iso(record.started_at), counts: record.counts },
      codes: codes.rows,
      issues: { page, pageSize, total: issues.rows[0]?.total ?? 0, items: issues.rows.map(({ total: _total, ...issue }) => issue) },
    };
  });

  /** New units from the 2026 list and where they came from: in the directory yet, or waiting for updated data. */
  app.get('/lineage', { preHandler: canView }, async () => {
    const { rows } = await db.query<{
      level: ChurchLevel;
      new_key: string;
      new_name: string;
      source_name: string;
      approved_on: string | null;
      new_id: string | null;
      new_display: string | null;
      source_id: string | null;
      source_display: string | null;
      source_status: string | null;
    }>(
      `select l.level::text as level, l.new_key, l.new_name, l.source_name, l.approved_on::text as approved_on,
              nu.id as new_id, nu.display_name as new_display, su.id as source_id, su.display_name as source_display, su.status::text as source_status
         from unit_lineage l
         left join church_units nu on nu.level = l.level and nu.name_key = l.new_key
         left join church_units su on su.level = l.source_level and su.name_key = l.source_key
        order by l.level, ${NATURAL('l.new_key')}, l.source_key`,
    );
    const groups = new Map<string, { level: ChurchLevel; name: string; approvedOn: string | null; unit: { id: string; name: string } | null; sources: { name: string; unit: { id: string; name: string; status: string } | null }[] }>();
    for (const row of rows) {
      const key = `${row.level}:${row.new_key}`;
      let group = groups.get(key);
      if (!group) {
        group = { level: row.level, name: row.new_display ?? row.new_name, approvedOn: row.approved_on, unit: row.new_id ? { id: row.new_id, name: row.new_display! } : null, sources: [] };
        groups.set(key, group);
      }
      group.sources.push({ name: row.source_display ?? row.source_name, unit: row.source_id ? { id: row.source_id, name: row.source_display!, status: row.source_status! } : null });
    }
    return { items: [...groups.values()] };
  });
}
