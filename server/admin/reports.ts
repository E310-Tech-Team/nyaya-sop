/**
 * Reports and analytics (/api/admin/reports): a summary of the applications in scope, the
 * applications by continent, region, province and parish (paged, searchable, sortable: the
 * drill-down from continents to a parish's applications), the submissions over time, the cohorts,
 * and a CSV of any listing.
 *
 * Counts follow today's directory: an application counts wherever its parish is now (D-32); the
 * chain each applicant confirmed stays on their application. Every endpoint takes the Applicants
 * list's filters (./application-filters.ts), so each count opens exactly those applications there
 * (server/admin-reports.test.ts reconciles them). Nothing in scope is left out: applications with no
 * directory parish are an "Unassigned" group at the top, and parishes a level skips are grouped
 * under the unit above, so every listing adds up to its parent. Applications are not people: one
 * email address can apply once per cohort, so "unique applicants" counts email addresses. Roles
 * without applications.view_all see counts of 1 to 4 as "fewer than 5".
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CHURCH_LEVELS, type ChurchLevel } from '../../src/shared/directory';
import { can, type StaffRole } from '../../src/shared/permissions';
import { APPLICATION_STATUSES, PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS, type ApplicationStatus } from '../../src/shared/platform';
import { utcToZonedLocal } from '../../src/shared/time';
import { audit } from '../audit';
import { staffGuard } from '../auth/guards';
import { staffActor } from '../auth/staff-routes';
import { toCsv } from '../csv';
import type { Queryable } from '../db';
import { isUuid, sendError } from '../http';
import type { Services } from '../services';
import { applicationConditions, FILTER_KEYS, filterNames, isDay, isWithoutLevel, parishScope, type ApplicationFilters, type WithoutLevel } from './application-filters';

type Query = ApplicationFilters & {
  interval?: string;
  level?: string;
  q?: string;
  sort?: string;
  dir?: string;
  include?: string;
  page?: string;
  pageSize?: string;
};

const QUERY_KEYS = [...FILTER_KEYS, 'interval', 'level', 'q', 'sort', 'dir', 'include', 'page', 'pageSize'] as const;

/** Only the filter keys: listing options (level, search, sort, page) never become conditions. */
const filtersOf = (query: Query): ApplicationFilters => ({
  cohort: query.cohort,
  status: query.status,
  published: query.published,
  from: query.from,
  to: query.to,
  unit: query.unit,
  direct: query.direct,
  parish: query.parish,
  parishStatus: query.parishStatus,
  without: query.without,
});

/** Counts from 1 to 4 are shown as "fewer than 5" to roles that can't see applicants' details. */
export const SMALL_COUNT = 5;
export const maskCount = (masked: boolean, count: number): number | null => (masked && count > 0 && count < SMALL_COUNT ? null : count);

export type StatusCounts = Record<ApplicationStatus, number>;
const noStatuses = (): StatusCounts => Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, 0])) as StatusCounts;

const maskStatuses = (masked: boolean, counts: StatusCounts) =>
  Object.fromEntries(Object.entries(counts).map(([status, n]) => [status, maskCount(masked, n)])) as Record<ApplicationStatus, number | null>;

// Units in their natural order: "Lagos Province 2" before "Lagos Province 10".
const NATURAL = (column: string, dir: SortDirection = 'asc') =>
  [`regexp_replace(${column}, '\\d+$', '')`, `coalesce(substring(${column} from '(\\d+)$')::numeric, 0)`, column].map((part) => `${part} ${dir}`).join(', ');

/**
 * How a listing can be ordered: by name, by applications, by parishes with applications, or by
 * one review status. Numbers sort most first unless asked otherwise; names A to Z.
 */
export const LISTING_SORTS = ['applications', 'name', 'parishes', ...APPLICATION_STATUSES] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];
export type SortDirection = 'asc' | 'desc';
const isListingSort = (value: unknown): value is ListingSort => typeof value === 'string' && (LISTING_SORTS as readonly string[]).includes(value);
/** Sorts that only order by exact counts: withheld from roles that see small counts as "fewer than 5", since the order would give them away. */
const EXACT_SORTS: readonly ListingSort[] = ['parishes', ...APPLICATION_STATUSES];
const STATUS_COUNT_COLUMNS = APPLICATION_STATUSES.map((status) => `count(*) filter (where a.status = '${status}')::int as s_${status}`).join(', ');
const STATUS_LISTED_COLUMNS = APPLICATION_STATUSES.map((status) => `coalesce(c.s_${status}, 0) as s_${status}`).join(', ');

/** The ORDER BY for a listing; the key breaks ties so pages never overlap. */
function listingOrder(sort: ListingSort, dir: SortDirection, name: string): string {
  if (sort === 'name') return `${name.replace(/\basc\b/g, dir)}, key`;
  const column = sort === 'applications' ? 'applications' : sort === 'parishes' ? 'represented' : `s_${sort}`;
  const then = sort === 'applications' ? '' : 'applications desc, ';
  return `${column} ${dir}, ${then}${name}, key`;
}
// Touched by the August 2026 changes: a new unit, or one a new unit was created from (unit_lineage).
const CHANGED_2026 = `exists (select 1 from unit_lineage l
  where (l.level = u.level and l.new_key = u.name_key) or (l.source_level = u.level and l.source_key = u.name_key))`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const IDS = (param: string) => `(select value from jsonb_array_elements_text(${param}::jsonb))`;

type Where = { sql: string; params: unknown[]; add: (value: unknown) => string };
type UnitRef = { id: string; name: string; level: ChurchLevel };

/** The filters as a WHERE clause, plus a way to add more parameters after them. */
function whereOf(filters: ApplicationFilters, extra: string[] = []): Where {
  const { clauses, params } = applicationConditions(filters);
  const all = [...clauses, ...extra];
  return {
    sql: all.length ? `where ${all.join(' and ')}` : '',
    params,
    add: (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    },
  };
}

async function directoryVersion(db: Queryable) {
  const { rows } = await db.query<{ id: string; source_label: string; structure_as_at: string | null }>(
    `select id, source_label, structure_as_at::text as structure_as_at from directory_imports where status = 'applied' order by started_at desc limit 1`,
  );
  const row = rows[0];
  return row ? { importId: row.id, label: row.source_label, structureAsAt: row.structure_as_at } : null;
}

// ── Dates (Lagos calendar days) ─────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60_000;
export const todayInLagos = () => utcToZonedLocal(new Date(), 'Africa/Lagos').slice(0, 10);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
/** The Monday of the week containing the day (Postgres date_trunc('week') weeks). */
const weekOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * The period just before the filtered one, of the same length, when there is a real period to
 * compare: it needs a first day (an open start has nothing before it); an open end means today.
 */
export function previousPeriod(filters: ApplicationFilters): { from: string; to: string; days: number } | null {
  if (!isDay(filters.from)) return null;
  const to = isDay(filters.to) ? filters.to : todayInLagos();
  if (to < filters.from) return null;
  const days = daysBetween(filters.from, to) + 1;
  return { from: addDays(filters.from, -days), to: addDays(filters.from, -1), days };
}

// ── Summary ────────────────────────────────────────────────────────────────────

type Split = { linked: number; unlinked: number };

export type ParishPlace = {
  id: string;
  name: string;
  status: string;
  mergedInto: { id: string; name: string } | null;
  /** The unit it sits directly under. */
  unit: UnitRef;
  /** Its units, continent first. */
  chain: UnitRef[];
};

async function parishPlace(db: Queryable, id: string): Promise<ParishPlace | null> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    status: string;
    merged_id: string | null;
    merged_name: string | null;
    unit_id: string;
    unit_name: string;
    unit_level: ChurchLevel;
    chain: string[];
  }>(
    `select x.id, x.display_name as name, x.status::text as status, m.id as merged_id, m.display_name as merged_name,
            uu.id as unit_id, uu.display_name as unit_name, uu.level::text as unit_level,
            array_remove(array[x.continent_id, x.region_id, x.province_id, x.zone_id, x.area_id]::text[], null) as chain
       from parishes x join church_units uu on uu.id = x.unit_id left join parishes m on m.id = x.merged_into_id
      where x.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const units = await db.query<UnitRef>(`select id, display_name as name, level::text as level from church_units where id::text = any($1::text[])`, [row.chain]);
  const chain = units.rows.sort((a, b) => CHURCH_LEVELS.indexOf(a.level) - CHURCH_LEVELS.indexOf(b.level));
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    mergedInto: row.merged_id ? { id: row.merged_id, name: row.merged_name! } : null,
    unit: { id: row.unit_id, name: row.unit_name, level: row.unit_level },
    chain,
  };
}

export type Summary = {
  period: { from: string | null; to: string | null };
  /** The unit the filters limit the report to, named for the filter chips. */
  unit: { id: string; name: string; level: ChurchLevel } | null;
  /** The parish the filters name, as it stands in today's directory, with its units from the continent down. */
  parish: ParishPlace | null;
  applications: number;
  /** Email addresses: one person applying in two cohorts is two applications, one applicant. */
  uniqueApplicants: number;
  byStatus: StatusCounts;
  byPublished: StatusCounts;
  withParish: number;
  /** Of `withParish`, those staff linked (the applicant typed a name, reported it missing or gave none). */
  linkedByStaff: number;
  /** No directory parish linked: `applications` minus `withParish`. */
  withoutParish: number;
  /** How the parish question was answered, and whether a directory parish is linked: these add up to `applications`. */
  answers: { listed: number; reported: Split; legacyText: Split; notProvided: Split };
  /** Linked parishes outside any region, or any province (the RCCG list skips a level that repeats the one above). */
  noRegion: number;
  noProvince: number;
  parishesRepresented: number;
  activeParishes: number;
  /** Waiting in Parish review, among these applications. */
  waiting: { notListed: number; detailsWrong: number; lookalike: number; earlierText: number };
  comparison: { from: string; to: string; days: number; applications: number; uniqueApplicants: number } | null;
  directory: Awaited<ReturnType<typeof directoryVersion>>;
};

async function headline(db: Queryable, filters: ApplicationFilters) {
  const where = whereOf(filters);
  const { rows } = await db.query<Record<string, number>>(
    `select count(*)::int as applications,
            count(distinct a.email)::int as unique_applicants,
            count(*) filter (where a.parish_id is not null)::int as with_parish,
            count(*) filter (where a.parish_status = 'listed')::int as listed,
            count(*) filter (where a.parish_status = 'reported' and a.parish_id is not null)::int as reported_linked,
            count(*) filter (where a.parish_status = 'reported' and a.parish_id is null)::int as reported_unlinked,
            count(*) filter (where a.parish_status = 'legacy_text' and a.parish_id is not null)::int as legacy_linked,
            count(*) filter (where a.parish_status = 'legacy_text' and a.parish_id is null)::int as legacy_unlinked,
            count(*) filter (where a.parish_status = 'not_provided' and a.parish_id is not null)::int as none_linked,
            count(*) filter (where a.parish_status = 'not_provided' and a.parish_id is null)::int as none_unlinked,
            count(*) filter (where a.parish_id is not null and p.region_id is null)::int as no_region,
            count(*) filter (where a.parish_id is not null and p.province_id is null)::int as no_province,
            count(distinct a.parish_id)::int as parishes_represented,
            count(*) filter (where a.parish_status = 'legacy_text' and a.parish_id is null and a.parish_text_reviewed_at is null)::int as earlier_waiting
       from applications a left join parishes p on p.id = a.parish_id
       ${where.sql}`,
    where.params,
  );
  return rows[0]!;
}

export async function reportSummary(db: Queryable, filters: ApplicationFilters): Promise<Summary> {
  const row = await headline(db, filters);
  const where = whereOf(filters);
  const statuses = await db.query<{ status: ApplicationStatus; published: ApplicationStatus; n: number }>(
    `select a.status::text as status, a.published_status::text as published, count(*)::int as n
       from applications a left join parishes p on p.id = a.parish_id ${where.sql} group by 1, 2`,
    where.params,
  );
  const byStatus = noStatuses();
  const byPublished = noStatuses();
  for (const status of statuses.rows) {
    byStatus[status.status] += status.n;
    byPublished[status.published] += status.n;
  }
  const pending = whereOf(filters, [`r.status = 'pending'`]);
  const reports = await db.query<{ not_listed: number; details_wrong: number; lookalike: number }>(
    `select count(*) filter (where r.kind = 'not_listed')::int as not_listed, count(*) filter (where r.kind = 'details_wrong')::int as details_wrong,
            count(*) filter (where r.kind = 'lookalike')::int as lookalike
       from parish_reports r join applications a on a.id = r.application_id left join parishes p on p.id = a.parish_id
       ${pending.sql}`,
    pending.params,
  );
  // Active parishes in the same part of the directory: what "represented" is out of.
  const scope = parishScope(filters);
  const active =
    filters.parish === 'none'
      ? 0
      : (
          await db.query<{ n: number }>(
            `select count(*)::int as n from parishes p where ${['p.status = \'active\'', ...scope.clauses].join(' and ')}`,
            scope.params,
          )
        ).rows[0]!.n;
  const previous = previousPeriod(filters);
  const before = previous ? await headline(db, { ...filters, from: previous.from, to: previous.to }) : null;
  const unit = isUuid(filters.unit)
    ? ((await db.query<{ id: string; name: string; level: ChurchLevel }>(`select id, display_name as name, level::text as level from church_units where id = $1`, [filters.unit])).rows[0] ?? null)
    : null;
  return {
    period: { from: isDay(filters.from) ? filters.from : null, to: isDay(filters.to) ? filters.to : null },
    unit,
    parish: isUuid(filters.parish) ? await parishPlace(db, filters.parish) : null,
    applications: row.applications!,
    uniqueApplicants: row.unique_applicants!,
    byStatus,
    byPublished,
    withParish: row.with_parish!,
    linkedByStaff: row.with_parish! - row.listed!,
    withoutParish: row.applications! - row.with_parish!,
    answers: {
      listed: row.listed!,
      reported: { linked: row.reported_linked!, unlinked: row.reported_unlinked! },
      legacyText: { linked: row.legacy_linked!, unlinked: row.legacy_unlinked! },
      notProvided: { linked: row.none_linked!, unlinked: row.none_unlinked! },
    },
    noRegion: row.no_region!,
    noProvince: row.no_province!,
    parishesRepresented: row.parishes_represented!,
    activeParishes: active,
    waiting: {
      notListed: reports.rows[0]!.not_listed,
      detailsWrong: reports.rows[0]!.details_wrong,
      lookalike: reports.rows[0]!.lookalike,
      earlierText: row.earlier_waiting!,
    },
    comparison: previous && before ? { ...previous, applications: before.applications!, uniqueApplicants: before.unique_applicants! } : null,
    directory: await directoryVersion(db),
  };
}

// ── Applications by unit and parish ─────────────────────────────────────────────

export type ListLevel = ChurchLevel | 'parish';
const isListLevel = (value: unknown): value is ListLevel => value === 'parish' || CHURCH_LEVELS.includes(value as ChurchLevel);

/** Active units directly under a unit, at one level, and how many of them have any of these applications. */
export type ChildCount = { level: ChurchLevel; count: number; withApplications: number };

export type Card = {
  key: string;
  /** A unit, a parish, the parishes directly under the unit, those missing a level, or the applications with no directory parish. */
  kind: 'unit' | 'parish' | 'direct' | 'without' | 'unassigned';
  id: string | null;
  name: string;
  level: ChurchLevel | null;
  status: string | null;
  changed2026: boolean;
  /** A unit's parent, or the unit a parish sits in. */
  parent: UnitRef | null;
  /** A parish's province, region and continent. */
  chain: { province: string | null; region: string | null; continent: string | null } | null;
  applications: number;
  byStatus: StatusCounts;
  byPublished: StatusCounts;
  /** Units: parishes with at least one of these applications, and active parishes in the unit. */
  parishesWithApplications: number | null;
  activeParishes: number | null;
  /** Units: the active units directly under it, by level (a continent can hold regions and, where the list skips a level, provinces). */
  children: ChildCount[];
  /** The Applicants list filters for exactly this card's applications (with the report's own filters). */
  filter: Record<string, string>;
  /** The listing that opens what's under this card, or null. */
  drill: Record<string, string> | null;
};

export type Listing = {
  mode: 'level' | 'children' | 'parishes';
  /** The level listed; null for the units under a unit, which can mix levels. */
  level: ListLevel | null;
  within: (UnitRef & { status: string; childLevel: ChurchLevel | null }) | null;
  ancestors: UnitRef[];
  direct: boolean;
  without: WithoutLevel | null;
  search: string | null;
  sort: ListingSort;
  dir: SortDirection;
  includeAll: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: Card[];
  /** Groups that belong to no card of the listing, so its totals add up: parishes directly under the unit, or with no region/province. */
  extras: Card[];
  totals: { applications: number; parishesWithApplications: number };
};

async function ancestorsOf(db: Queryable, parentId: string | null): Promise<UnitRef[]> {
  const chain: UnitRef[] = [];
  for (let next = parentId, hops = 0; next && hops < CHURCH_LEVELS.length; hops++) {
    const { rows } = await db.query<UnitRef & { parent_id: string | null }>(
      `select id, display_name as name, level::text as level, parent_id from church_units where id = $1`,
      [next],
    );
    if (!rows[0]) break;
    chain.unshift({ id: rows[0].id, name: rows[0].name, level: rows[0].level });
    next = rows[0].parent_id;
  }
  return chain;
}

/** Review and published status counts per card key, for the cards on the page. */
async function statusesBy(db: Queryable, keyExpr: string, filters: ApplicationFilters, keys: string[]) {
  const result = new Map<string, { byStatus: StatusCounts; byPublished: StatusCounts }>();
  if (!keys.length) return result;
  const where = whereOf(filters);
  const ids = where.add(JSON.stringify(keys));
  const { rows } = await db.query<{ key: string; status: ApplicationStatus; published: ApplicationStatus; n: number }>(
    `select ${keyExpr} as key, a.status::text as status, a.published_status::text as published, count(*)::int as n
       from applications a join parishes p on p.id = a.parish_id
       ${where.sql ? `${where.sql} and` : 'where'} ${keyExpr} in ${IDS(ids)}
      group by 1, 2, 3`,
    where.params,
  );
  for (const row of rows) {
    let entry = result.get(row.key);
    if (!entry) result.set(row.key, (entry = { byStatus: noStatuses(), byPublished: noStatuses() }));
    entry.byStatus[row.status] += row.n;
    entry.byPublished[row.published] += row.n;
  }
  return result;
}

/** One group's counts (an extra card): applications, parishes with applications and status counts. */
async function groupCounts(db: Queryable, filters: ApplicationFilters, condition: string, join: 'join' | 'left join' = 'join') {
  const where = whereOf(filters, [condition]);
  const { rows } = await db.query<{ status: ApplicationStatus; published: ApplicationStatus; n: number; parishes: number }>(
    `select a.status::text as status, a.published_status::text as published, count(*)::int as n, count(distinct a.parish_id)::int as parishes
       from applications a ${join} parishes p on p.id = a.parish_id ${where.sql} group by 1, 2`,
    where.params,
  );
  const byStatus = noStatuses();
  const byPublished = noStatuses();
  let applications = 0;
  for (const row of rows) {
    applications += row.n;
    byStatus[row.status] += row.n;
    byPublished[row.published] += row.n;
  }
  const parishes = await db.query<{ n: number }>(
    `select count(distinct a.parish_id)::int as n from applications a ${join} parishes p on p.id = a.parish_id ${where.sql}`,
    where.params,
  );
  return { applications, byStatus, byPublished, parishesWithApplications: parishes.rows[0]!.n };
}

/**
 * For each unit, the active units directly under it by level, and how many of those have any
 * applications under the filters (anywhere beneath them).
 */
async function childCounts(db: Queryable, ids: string[], filters: ApplicationFilters): Promise<Map<string, ChildCount[]>> {
  const result = new Map<string, ChildCount[]>();
  if (!ids.length) return result;
  const where = whereOf(filters);
  const parents = where.add(JSON.stringify(ids));
  const { rows } = await db.query<{ parent: string; level: ChurchLevel; count: number; with_applications: number }>(
    `with hits as (
       select distinct unnest(array[p.region_id, p.province_id, p.zone_id, p.area_id]) as id
         from applications a join parishes p on p.id = a.parish_id ${where.sql})
     select c.parent_id::text as parent, c.level::text as level, count(*)::int as count, count(h.id)::int as with_applications
       from church_units c left join hits h on h.id = c.id
      where c.parent_id::text in ${IDS(parents)} and c.status = 'active'
      group by 1, 2`,
    where.params,
  );
  for (const row of rows) {
    const list = result.get(row.parent) ?? [];
    list.push({ level: row.level, count: row.count, withApplications: row.with_applications });
    result.set(row.parent, list);
  }
  for (const list of result.values()) list.sort((a, b) => CHURCH_LEVELS.indexOf(a.level) - CHURCH_LEVELS.indexOf(b.level));
  return result;
}

type UnitDetail = {
  id: string;
  parent_id: string | null;
  parent_name: string | null;
  parent_level: ChurchLevel | null;
  active_parishes: number;
  changed: boolean;
};

async function unitDetails(db: Queryable, ids: string[]): Promise<Map<string, UnitDetail>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<UnitDetail>(
    `select u.id, u.parent_id, pu.display_name as parent_name, pu.level::text as parent_level,
            (select count(*)::int from parishes x where x.status = 'active' and case u.level
               when 'continent' then x.continent_id = u.id when 'region' then x.region_id = u.id when 'province' then x.province_id = u.id
               when 'zone' then x.zone_id = u.id else x.area_id = u.id end) as active_parishes,
            ${CHANGED_2026} as changed
       from church_units u left join church_units pu on pu.id = u.parent_id
      where u.id::text in ${IDS('$1')}`,
    [JSON.stringify(ids)],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

type ParishDetail = { id: string; unit_id: string; unit_name: string; unit_level: ChurchLevel; province: string | null; region: string | null; continent: string | null };

async function parishDetailsFor(db: Queryable, ids: string[]): Promise<Map<string, ParishDetail>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<ParishDetail>(
    `select x.id, x.unit_id, uu.display_name as unit_name, uu.level::text as unit_level,
            prov.display_name as province, reg.display_name as region, cont.display_name as continent
       from parishes x join church_units uu on uu.id = x.unit_id
       left join church_units prov on prov.id = x.province_id
       left join church_units reg on reg.id = x.region_id
       left join church_units cont on cont.id = x.continent_id
      where x.id::text in ${IDS('$1')}`,
    [JSON.stringify(ids)],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

type ListedRow = { key: string; name: string; status: string; level: ChurchLevel | null; applications: number; represented: number; total: number; listed_applications: number; listed_represented: number };

const LEVEL_WORD: Record<ChurchLevel, string> = { continent: 'continent', region: 'region', province: 'province', zone: 'zone', area: 'area' };

/**
 * One page of cards: every unit at a level (within the unit filter, if any), the units directly
 * under a unit, or parishes (in the filtered part of the directory). Null when the unit doesn't exist.
 */
export async function reportListing(db: Queryable, query: Query, maxPageSize = 48, { exactSorts = true }: { exactSorts?: boolean } = {}): Promise<Listing | null> {
  const filters = filtersOf(query);
  let within: Listing['within'] = null;
  let withinParent: string | null = null;
  if (filters.unit) {
    if (!isUuid(filters.unit)) return null;
    const { rows } = await db.query<UnitRef & { status: string; parent_id: string | null; child_level: ChurchLevel | null }>(
      `select u.id, u.display_name as name, u.level::text as level, u.status::text as status, u.parent_id,
              (select c.level::text from church_units c where c.parent_id = u.id order by c.level limit 1) as child_level
         from church_units u where u.id = $1`,
      [filters.unit],
    );
    const row = rows[0];
    if (!row) return null;
    within = { id: row.id, name: row.name, level: row.level, status: row.status, childLevel: row.child_level };
    withinParent = row.parent_id;
  }
  let level: ListLevel | null = isListLevel(query.level) ? query.level : null;
  let mode: Listing['mode'];
  if (level === 'parish') mode = 'parishes';
  else if (level) mode = 'level';
  else if (within) mode = filters.direct === '1' || !within.childLevel ? 'parishes' : 'children';
  else {
    mode = 'level';
    level = 'continent';
  }
  if (mode === 'parishes') level = 'parish';
  // A level list spans the whole scope: "directly under" only applies when opening one unit.
  const counted: ApplicationFilters = mode === 'level' ? { ...filters, direct: undefined } : filters;
  const without = isWithoutLevel(filters.without) ? filters.without : null;

  const search = query.q?.trim().slice(0, 100) || null;
  const asked = isListingSort(query.sort) ? query.sort : 'applications';
  const sort: ListingSort = !exactSorts && EXACT_SORTS.includes(asked) ? 'applications' : asked;
  const dir: SortDirection = query.dir === 'asc' || query.dir === 'desc' ? query.dir : sort === 'name' ? 'asc' : 'desc';
  // Units and parishes with no applications are listed too, unless asked for those with applications only.
  const includeAll = query.include !== 'applications';
  const page = Math.max(1, Math.min(10_000, Number.parseInt(query.page ?? '1', 10) || 1));
  const pageSize = Math.max(1, Math.min(maxPageSize, Number.parseInt(query.pageSize ?? '24', 10) || 24));
  const offset = (page - 1) * pageSize;

  const where = whereOf(counted);
  const like = search ? where.add(`%${escapeLike(search)}%`) : null;
  const include = where.add(includeAll);
  let keyExpr: string;
  let rows: ListedRow[];

  if (mode === 'parishes') {
    keyExpr = 'p.id::text';
    const scope = parishScope(counted, where.params.length);
    where.params.push(...scope.params);
    ({ rows } = await db.query<ListedRow>(
      `with counts as (
         select a.parish_id, count(*)::int as applications, ${STATUS_COUNT_COLUMNS}
           from applications a join parishes p on p.id = a.parish_id ${where.sql} group by 1),
       listed as (
         select p.id::text as key, p.display_name as name, p.name_key, p.status::text as status, null::text as level,
                coalesce(c.applications, 0) as applications, (c.parish_id is not null)::int as represented, ${STATUS_LISTED_COLUMNS}
           from parishes p left join counts c on c.parish_id = p.id
          where (c.parish_id is not null or (${include}::boolean and ${['p.status = \'active\'', ...scope.clauses].join(' and ')}))
            and (${like ?? 'null'}::text is null or p.display_name ilike ${like ?? 'null'}::text))
       select *, count(*) over ()::int as total, coalesce(sum(applications) over (), 0)::int as listed_applications,
              coalesce(sum(represented) over (), 0)::int as listed_represented
         from listed
        order by ${listingOrder(sort, dir, 'name_key asc, name asc')}
        limit ${pageSize} offset ${offset}`,
      where.params,
    ));
  } else {
    // Units: at one level, or the units directly under the unit (their level is the first one below it each parish has).
    const L = level as ChurchLevel;
    keyExpr =
      mode === 'level'
        ? `p.${L}_id::text`
        : `coalesce(${CHURCH_LEVELS.slice(CHURCH_LEVELS.indexOf(within!.level) + 1).map((below) => `p.${below}_id`).join(', ')})::text`;
    const scopeUnit = mode === 'children' ? within!.id : (filters.unit ?? null);
    const scopeParam = scopeUnit ? where.add(scopeUnit) : null;
    const unitCondition =
      mode === 'children'
        ? `u.parent_id = ${scopeParam}::uuid`
        : `u.level = '${L}'${scopeParam ? ` and u.id in (select id from scope_units)` : ''}`;
    ({ rows } = await db.query<ListedRow>(
      `with recursive scope_units as (
         select id from church_units where ${scopeParam ? `id = ${scopeParam}::uuid` : 'false'}
         union all
         select c.id from church_units c join scope_units s on c.parent_id = s.id),
       counts as (
         select ${keyExpr} as key, count(*)::int as applications, count(distinct a.parish_id)::int as represented, ${STATUS_COUNT_COLUMNS}
           from applications a join parishes p on p.id = a.parish_id ${where.sql} group by 1),
       listed as (
         select u.id::text as key, u.display_name as name, u.name_key, u.status::text as status, u.level::text as level,
                coalesce(c.applications, 0) as applications, coalesce(c.represented, 0) as represented, ${STATUS_LISTED_COLUMNS}
           from church_units u left join counts c on c.key = u.id::text
          where ${unitCondition}
            and (c.key is not null or (${include}::boolean and u.status = 'active'))
            and (${like ?? 'null'}::text is null or u.display_name ilike ${like ?? 'null'}::text))
       select *, count(*) over ()::int as total, coalesce(sum(applications) over (), 0)::int as listed_applications,
              coalesce(sum(represented) over (), 0)::int as listed_represented
         from listed
        order by ${listingOrder(sort, dir, NATURAL('name_key'))}
        limit ${pageSize} offset ${offset}`,
      where.params,
    ));
  }

  const keys = rows.map((row) => row.key);
  const statuses = await statusesBy(db, keyExpr, counted, keys);
  const cards: Card[] = [];
  if (mode === 'parishes') {
    const details = await parishDetailsFor(db, keys);
    for (const row of rows) {
      const detail = details.get(row.key)!;
      cards.push({
        key: row.key,
        kind: 'parish',
        id: row.key,
        name: row.name,
        level: null,
        status: row.status,
        changed2026: false,
        parent: { id: detail.unit_id, name: detail.unit_name, level: detail.unit_level },
        chain: { province: detail.province, region: detail.region, continent: detail.continent },
        applications: row.applications,
        byStatus: statuses.get(row.key)?.byStatus ?? noStatuses(),
        byPublished: statuses.get(row.key)?.byPublished ?? noStatuses(),
        parishesWithApplications: null,
        activeParishes: null,
        children: [],
        filter: { parish: row.key },
        // The parish's own view: its figures and applications.
        drill: { parish: row.key },
      });
    }
  } else {
    const details = await unitDetails(db, keys);
    const children = await childCounts(db, keys, counted);
    for (const row of rows) {
      const detail = details.get(row.key)!;
      const below = children.get(row.key) ?? [];
      cards.push({
        key: row.key,
        kind: 'unit',
        id: row.key,
        name: row.name,
        level: row.level,
        status: row.status,
        changed2026: detail.changed,
        parent: detail.parent_id ? { id: detail.parent_id, name: detail.parent_name!, level: detail.parent_level! } : null,
        chain: null,
        applications: row.applications,
        byStatus: statuses.get(row.key)?.byStatus ?? noStatuses(),
        byPublished: statuses.get(row.key)?.byPublished ?? noStatuses(),
        parishesWithApplications: row.represented,
        activeParishes: detail.active_parishes,
        children: below,
        filter: { unit: row.key },
        drill: below.length || detail.active_parishes || row.applications ? { unit: row.key } : null,
      });
    }
  }

  // The groups outside every card, so the listing's totals add up to the applications in scope.
  const extras: Card[] = [];
  const extra = async (
    kind: 'direct' | 'without',
    name: string,
    /** Which applications belong to the group (no parameters of its own). */
    condition: string,
    /** Which active parishes belong to it, with parameters numbered from $1. */
    parishes: { sql: string; params: unknown[] },
    filter: Record<string, string>,
    drill: Record<string, string>,
  ) => {
    const counts = await groupCounts(db, counted, condition);
    const active = await db.query<{ n: number }>(`select count(*)::int as n from parishes p where p.status = 'active' and ${parishes.sql}`, parishes.params);
    if (!counts.applications && !active.rows[0]!.n) return;
    extras.push({
      key: kind,
      kind,
      id: kind === 'direct' ? within!.id : null,
      name,
      level: null,
      status: null,
      changed2026: false,
      parent: null,
      chain: null,
      ...counts,
      activeParishes: active.rows[0]!.n,
      children: [],
      filter,
      drill,
    });
  };
  if (!search && mode === 'children' && within) {
    const below = within.childLevel ? LEVEL_WORD[within.childLevel] : 'unit';
    await extra(
      'direct',
      `No ${below}: directly under ${within.name}`,
      `${keyExpr} is null`,
      { sql: 'p.unit_id = $1', params: [within.id] },
      { unit: within.id, direct: '1' },
      { unit: within.id, direct: '1' },
    );
  }
  if (!search && mode === 'level' && (level === 'region' || level === 'province')) {
    const scoped: Record<string, string> = filters.unit ? { unit: filters.unit } : {};
    await extra(
      'without',
      `No ${level}`,
      `a.parish_id is not null and p.${level}_id is null`,
      filters.unit
        ? { sql: `p.${level}_id is null and $1::uuid in (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)`, params: [filters.unit] }
        : { sql: `p.${level}_id is null`, params: [] },
      { ...scoped, without: level },
      { ...scoped, level: 'parish', without: level },
    );
  }

  // At the top, the applications with no directory parish: no unit can hold them, so they're a group of their own.
  if (!search && !within && !without && (mode === 'level' || mode === 'parishes')) {
    const counts = await groupCounts(db, counted, 'a.parish_id is null', 'left join');
    if (counts.applications) {
      extras.push({
        key: 'unassigned',
        kind: 'unassigned',
        id: null,
        name: 'Unassigned',
        level: null,
        status: null,
        changed2026: false,
        parent: null,
        chain: null,
        ...counts,
        parishesWithApplications: null,
        activeParishes: null,
        children: [],
        filter: { parish: 'none' },
        drill: null,
      });
    }
  }

  const first = rows[0];
  return {
    mode,
    level: mode === 'children' ? null : level,
    within,
    ancestors: within ? await ancestorsOf(db, withinParent) : [],
    direct: mode === 'parishes' && filters.direct === '1',
    without,
    search,
    sort,
    dir,
    includeAll,
    page,
    pageSize,
    total: first?.total ?? 0,
    items: cards,
    extras,
    totals: {
      applications: (first?.listed_applications ?? 0) + extras.reduce((sum, card) => sum + card.applications, 0),
      parishesWithApplications: (first?.listed_represented ?? 0) + extras.reduce((sum, card) => sum + (card.parishesWithApplications ?? 0), 0),
    },
  };
}

// ── Cohorts ─────────────────────────────────────────────────────────────────────

export type CohortCard = {
  id: string;
  name: string;
  edition: number;
  opensAt: string | null;
  closesAt: string | null;
  openNow: boolean;
  applications: number;
  byStatus: StatusCounts;
  withParish: number;
};

/** Every cohort with its applications under the filters (the cohort filter itself doesn't apply here). */
export async function cohortCards(db: Queryable, filters: ApplicationFilters): Promise<CohortCard[]> {
  const where = whereOf({ ...filters, cohort: undefined });
  const counts = await db.query<{ cohort_id: string; status: ApplicationStatus; n: number; with_parish: number }>(
    `select a.cohort_id, a.status::text as status, count(*)::int as n, count(*) filter (where a.parish_id is not null)::int as with_parish
       from applications a left join parishes p on p.id = a.parish_id ${where.sql} group by 1, 2`,
    where.params,
  );
  const { rows } = await db.query<{ id: string; name: string; edition: number; opens: Date | null; closes: Date | null; open_now: boolean }>(
    `select id, name, edition, applications_open_at as opens, applications_close_at as closes,
            (is_accepting_applications and (applications_open_at is null or applications_open_at <= now())
              and (applications_close_at is null or applications_close_at > now())) as open_now
       from cohorts order by edition desc, created_at desc`,
  );
  return rows.map((cohort) => {
    const mine = counts.rows.filter((row) => row.cohort_id === cohort.id);
    const byStatus = noStatuses();
    for (const row of mine) byStatus[row.status] += row.n;
    return {
      id: cohort.id,
      name: cohort.name,
      edition: cohort.edition,
      opensAt: cohort.opens ? new Date(cohort.opens).toISOString() : null,
      closesAt: cohort.closes ? new Date(cohort.closes).toISOString() : null,
      openNow: cohort.open_now,
      applications: mine.reduce((sum, row) => sum + row.n, 0),
      byStatus,
      withParish: mine.reduce((sum, row) => sum + row.with_parish, 0),
    };
  });
}

// ── Trend ───────────────────────────────────────────────────────────────────────

export async function reportTrend(db: Queryable, query: Query) {
  const interval = query.interval === 'day' ? 'day' : 'week';
  const to = isDay(query.to) ? query.to : todayInLagos();
  const longest = interval === 'day' ? 366 : 7 * 105;
  let from = isDay(query.from) ? query.from : addDays(to, interval === 'day' ? -29 : -7 * 11);
  if (daysBetween(from, to) > longest) from = addDays(to, -longest);
  if (from > to) from = to;
  const where = whereOf({ ...filtersOf(query), from, to });
  const unit = where.add(interval);
  const { rows } = await db.query<{ period: string; n: number }>(
    `select to_char(date_trunc(${unit}, a.created_at at time zone 'Africa/Lagos'), 'YYYY-MM-DD') as period, count(*)::int as n
       from applications a left join parishes p on p.id = a.parish_id ${where.sql}
      group by 1 order by 1`,
    where.params,
  );
  const byPeriod = new Map(rows.map((row) => [row.period, row.n]));
  const points: { period: string; applications: number }[] = [];
  for (let period = interval === 'day' ? from : weekOf(from); period <= to; period = addDays(period, interval === 'day' ? 1 : 7)) {
    points.push({ period, applications: byPeriod.get(period) ?? 0 });
  }
  return { interval, from, to, explicit: isDay(query.from) || isDay(query.to), points };
}

// ── Where a request points ──────────────────────────────────────────────────────

export type ScopeProblem = { status: 400 | 404; message: string };

/**
 * The place a request names must exist and hang together: its unit, a parish inside that unit
 * (directly under it with direct=1), and a level below it. A link someone edited is refused rather
 * than answered with a report about something else.
 */
export async function scopeProblem(db: Queryable, query: { unit?: string; parish?: string; direct?: string; level?: string }): Promise<ScopeProblem | null> {
  let unit: { id: string; level: ChurchLevel } | null = null;
  if (query.unit) {
    if (!isUuid(query.unit)) return { status: 404, message: 'There is no unit with that ID.' };
    unit = (await db.query<{ id: string; level: ChurchLevel }>(`select id, level::text as level from church_units where id = $1`, [query.unit])).rows[0] ?? null;
    if (!unit) return { status: 404, message: 'There is no unit with that ID.' };
  }
  if (query.level) {
    if (!isListLevel(query.level)) return { status: 400, message: 'Choose continents, regions, provinces or parishes.' };
    if (unit && query.level !== 'parish' && CHURCH_LEVELS.indexOf(query.level) <= CHURCH_LEVELS.indexOf(unit.level)) {
      return { status: 400, message: `There are no ${LEVEL_WORD[query.level]}s under a ${LEVEL_WORD[unit.level]}.` };
    }
  }
  if (query.parish && query.parish !== 'any' && query.parish !== 'none') {
    if (!isUuid(query.parish)) return { status: 404, message: 'There is no parish with that ID.' };
    const { rows } = await db.query<{ unit_id: string; chain: string[] }>(
      `select unit_id::text as unit_id, array_remove(array[continent_id, region_id, province_id, zone_id, area_id]::text[], null) as chain from parishes where id = $1`,
      [query.parish],
    );
    const parish = rows[0];
    if (!parish) return { status: 404, message: 'There is no parish with that ID.' };
    if (unit && !(query.direct === '1' ? parish.unit_id === unit.id : parish.chain.includes(unit.id))) {
      return { status: 400, message: "That parish isn't in the chosen place." };
    }
  }
  return null;
}

// ── Routes ──────────────────────────────────────────────────────────────────────

const maskCard = (masked: boolean, card: Card) => ({
  ...card,
  applications: maskCount(masked, card.applications),
  byStatus: maskStatuses(masked, card.byStatus),
  byPublished: maskStatuses(masked, card.byPublished),
  parishesWithApplications: card.parishesWithApplications === null ? null : maskCount(masked, card.parishesWithApplications),
  children: card.children.map((child) => ({ ...child, withApplications: maskCount(masked, child.withApplications) })),
});

const maskSplit = (masked: boolean, split: Split) => ({ linked: maskCount(masked, split.linked), unlinked: maskCount(masked, split.unlinked) });

export async function reportRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;
  const canView = staffGuard(services, { permission: 'reports.view' });
  const maskedFor = (role: StaffRole) => !can(role, 'applications.view_all');
  /** Refuses a request whose unit, parish and level don't hang together (the level only matters to listings). */
  const refuse = async (query: Query, reply: FastifyReply, withLevel = false) => {
    const problem = await scopeProblem(db, { unit: query.unit, parish: query.parish, direct: query.direct, level: withLevel ? query.level : undefined });
    return problem ? sendError(reply, problem.status, problem.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', problem.message) : null;
  };

  app.get<{ Querystring: Query }>('/summary', { preHandler: canView }, async (request, reply) => {
    if (await refuse(request.query, reply)) return reply;
    const masked = maskedFor(request.staff!.role);
    const summary = await reportSummary(db, filtersOf(request.query));
    const m = (n: number) => maskCount(masked, n);
    return {
      ...summary,
      masked,
      applications: m(summary.applications),
      uniqueApplicants: m(summary.uniqueApplicants),
      byStatus: maskStatuses(masked, summary.byStatus),
      byPublished: maskStatuses(masked, summary.byPublished),
      withParish: m(summary.withParish),
      linkedByStaff: m(summary.linkedByStaff),
      withoutParish: m(summary.withoutParish),
      answers: {
        listed: m(summary.answers.listed),
        reported: maskSplit(masked, summary.answers.reported),
        legacyText: maskSplit(masked, summary.answers.legacyText),
        notProvided: maskSplit(masked, summary.answers.notProvided),
      },
      noRegion: m(summary.noRegion),
      noProvince: m(summary.noProvince),
      parishesRepresented: m(summary.parishesRepresented),
      waiting: {
        notListed: m(summary.waiting.notListed),
        detailsWrong: m(summary.waiting.detailsWrong),
        lookalike: m(summary.waiting.lookalike),
        earlierText: m(summary.waiting.earlierText),
      },
      comparison: summary.comparison
        ? { ...summary.comparison, applications: m(summary.comparison.applications), uniqueApplicants: m(summary.comparison.uniqueApplicants) }
        : null,
    };
  });

  app.get<{ Querystring: Query }>('/units', { preHandler: canView }, async (request, reply) => {
    if (await refuse(request.query, reply, true)) return reply;
    const masked = maskedFor(request.staff!.role);
    const listing = await reportListing(db, request.query, 48, { exactSorts: !masked });
    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
    return {
      ...listing,
      masked,
      items: listing.items.map((card) => maskCard(masked, card)),
      extras: listing.extras.map((card) => maskCard(masked, card)),
      totals: { applications: maskCount(masked, listing.totals.applications), parishesWithApplications: maskCount(masked, listing.totals.parishesWithApplications) },
    };
  });

  /** A listing as CSV: every row, not just a page. Totals only, never applicants; audited with the filters' names. */
  app.get<{ Querystring: Query }>('/units.csv', { preHandler: canView, config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    if (await refuse(request.query, reply, true)) return reply;
    const masked = maskedFor(request.staff!.role);
    const listing = await reportListing(db, { ...request.query, page: '1', pageSize: '50000' }, 50_000, { exactSorts: !masked });
    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'There is no unit with that ID.');
    const cell = (n: number) => (maskCount(masked, n) === null ? 'fewer than 5' : n);
    const directory = await directoryVersion(db);
    const filters = filtersOf(request.query);
    // Only dates that were applied: anything else in the URL never reaches the file.
    const from = isDay(filters.from) ? filters.from : null;
    const to = isDay(filters.to) ? filters.to : null;
    const period = from || to ? `${from ?? 'start'} to ${to ?? todayInLagos()}` : 'all time';
    const header = [
      'Level',
      'Name',
      'In',
      'Status',
      'Changed in 2026',
      'Applications',
      ...APPLICATION_STATUSES.map((status) => `Review: ${REVIEW_STATUS_LABELS[status]}`),
      ...APPLICATION_STATUSES.map((status) => `Published: ${PUBLISHED_STATUS_LABELS[status].label}`),
      'Parishes with applications',
      'Active parishes',
      'Period (WAT)',
      'Directory',
    ];
    const line = (card: Card) => [
      card.kind === 'unit' ? card.level : card.kind,
      card.name,
      card.parent?.name ?? '',
      card.status ?? '',
      card.changed2026 ? 'yes' : '',
      cell(card.applications),
      ...APPLICATION_STATUSES.map((status) => cell(card.byStatus[status])),
      ...APPLICATION_STATUSES.map((status) => cell(card.byPublished[status])),
      card.parishesWithApplications === null ? '' : cell(card.parishesWithApplications),
      card.activeParishes ?? '',
      period,
      directory ? `${directory.label}${directory.structureAsAt ? ` (as at ${directory.structureAsAt})` : ''}` : 'none',
    ];
    const total = ['total', listing.within ? listing.within.name : `All ${listing.level === 'parish' ? 'parishes' : `${listing.level}s`}`, '', '', '', cell(listing.totals.applications)];
    const csv = toCsv(header, [...listing.items.map(line), ...listing.extras.map(line), [...total, ...Array<string>(header.length - total.length).fill('')]]);
    await audit(db, staffActor(request.staff!), 'reports.exported', listing.within ? { type: 'church_unit', id: listing.within.id } : null, {
      rows: listing.items.length + listing.extras.length,
      level: listing.level,
      filters: filterNames(request.query as Record<string, unknown>, QUERY_KEYS),
      masked,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="sop-report-${listing.level ?? 'units'}-${todayInLagos()}.csv"`)
      .header('cache-control', 'no-store')
      .send(`﻿${csv}`);
  });

  /** New applications per day or week (Lagos time), with the same filters. */
  app.get<{ Querystring: Query }>('/trend', { preHandler: canView }, async (request, reply) => {
    if (await refuse(request.query, reply)) return reply;
    const masked = maskedFor(request.staff!.role);
    const trend = await reportTrend(db, request.query);
    return { ...trend, masked, points: trend.points.map((point) => ({ ...point, applications: maskCount(masked, point.applications) })) };
  });

  app.get<{ Querystring: Query }>('/cohorts', { preHandler: canView }, async (request, reply) => {
    if (await refuse(request.query, reply)) return reply;
    const masked = maskedFor(request.staff!.role);
    const cohorts = await cohortCards(db, filtersOf(request.query));
    return {
      masked,
      items: cohorts.map((cohort) => ({
        ...cohort,
        applications: maskCount(masked, cohort.applications),
        byStatus: maskStatuses(masked, cohort.byStatus),
        withParish: maskCount(masked, cohort.withParish),
      })),
    };
  });

  /** For the dashboard card: applications by continent, the five busiest regions, and those without a parish. */
  app.get('/overview', { preHandler: canView }, async (request) => {
    const masked = maskedFor(request.staff!.role);
    const summary = await reportSummary(db, {});
    const continents = (await reportListing(db, { level: 'continent', sort: 'name', pageSize: '48' }))!;
    const regions = (await reportListing(db, { level: 'region', include: 'applications', pageSize: '5' }))!;
    return {
      masked,
      total: maskCount(masked, summary.applications),
      unmatched: maskCount(masked, summary.applications - summary.withParish),
      continents: continents.items.map((card) => ({ id: card.id!, name: card.name, applications: maskCount(masked, card.applications) })),
      topRegions: regions.items.map((card) => ({ id: card.id!, name: card.name, applications: maskCount(masked, card.applications) })),
    };
  });
}
