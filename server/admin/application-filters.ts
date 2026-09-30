/**
 * Application filters shared by the Applicants list and export and by Reports, so every count
 * in Reports opens exactly those applications in the list (docs/05 §3; server/admin-reports.test.ts
 * checks the totals match). Queries alias applications as `a` and left-join its parish as `p`.
 * Dates are calendar days in Lagos time (WAT).
 */
import { isApplicationStatus } from '../../src/shared/platform';
import { isUuid } from '../http';

export type ApplicationFilters = {
  cohort?: string;
  status?: string;
  published?: string;
  /** First and last submission day, YYYY-MM-DD in Lagos time. */
  from?: string;
  to?: string;
  /** A church unit: applications whose parish is anywhere under it (or, with direct=1, directly under it). */
  unit?: string;
  direct?: string;
  /** A parish ID, 'none' (no parish linked) or 'any'. */
  parish?: string;
  parishStatus?: string;
  /** 'region' or 'province': a linked parish that sits outside any unit at that level. */
  without?: string;
};

export const PARISH_ANSWERS = ['listed', 'reported', 'legacy_text', 'not_provided'] as const;
export type ParishAnswerStatus = (typeof PARISH_ANSWERS)[number];
export const isParishAnswerStatus = (value: unknown): value is ParishAnswerStatus => PARISH_ANSWERS.includes(value as ParishAnswerStatus);

/** The levels a linked parish can be missing (the RCCG list skips a level that repeats the one above). */
export const WITHOUT_LEVELS = ['region', 'province'] as const;
export type WithoutLevel = (typeof WITHOUT_LEVELS)[number];
export const isWithoutLevel = (value: unknown): value is WithoutLevel => WITHOUT_LEVELS.includes(value as WithoutLevel);

export const FILTER_KEYS = ['cohort', 'status', 'published', 'from', 'to', 'unit', 'direct', 'parish', 'parishStatus', 'without'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day Postgres can read: JavaScript rolls "2026-02-30" over to March, and allows year 0.
export const isDay = (value: unknown): value is string =>
  typeof value === 'string' && DAY.test(value) && value >= '0001-01-01' && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

type Conditions = { clauses: string[]; params: unknown[] };

function builder(offset: number) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (param: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(`$${offset + params.length}`));
  };
  return { clauses, params, add };
}

/** The part of the filters about the directory (a unit, a parish, a missing level), as conditions on the parish `p` alone. */
export function parishScope(filters: ApplicationFilters, offset = 0): Conditions {
  const { clauses, params, add } = builder(offset);
  // A malformed unit or parish matches nothing: an edited link must never widen to every application.
  if (filters.unit) {
    if (!isUuid(filters.unit)) clauses.push('false');
    else if (filters.direct === '1') add((p) => `p.unit_id = ${p}`, filters.unit);
    else add((p) => `${p}::uuid in (p.continent_id, p.region_id, p.province_id, p.zone_id, p.area_id)`, filters.unit);
  }
  if (filters.parish && filters.parish !== 'any' && filters.parish !== 'none') {
    if (isUuid(filters.parish)) add((p) => `p.id = ${p}`, filters.parish);
    else clauses.push('false');
  }
  if (isWithoutLevel(filters.without)) clauses.push(`p.${filters.without}_id is null`);
  return { clauses, params };
}

/** The SQL condition and parameters for the filters, numbering parameters after `offset`. */
export function applicationConditions(filters: ApplicationFilters, offset = 0): Conditions {
  const { clauses, params, add } = builder(offset);
  if (filters.cohort && isUuid(filters.cohort)) add((p) => `a.cohort_id = ${p}`, filters.cohort);
  if (isApplicationStatus(filters.status)) add((p) => `a.status = ${p}::application_status`, filters.status);
  if (isApplicationStatus(filters.published)) add((p) => `a.published_status = ${p}::application_status`, filters.published);
  if (isDay(filters.from)) add((p) => `a.created_at >= (${p}::date)::timestamp at time zone 'Africa/Lagos'`, filters.from);
  if (isDay(filters.to)) add((p) => `a.created_at < ((${p}::date + 1)::timestamp at time zone 'Africa/Lagos')`, filters.to);
  if (filters.parish === 'none') clauses.push('a.parish_id is null');
  else if (filters.parish === 'any') clauses.push('a.parish_id is not null');
  if (isParishAnswerStatus(filters.parishStatus)) add((p) => `a.parish_status = ${p}::application_parish_status`, filters.parishStatus);
  // The directory part, on the linked parish. A missing level only counts applications that have a parish.
  if (isWithoutLevel(filters.without)) clauses.push('a.parish_id is not null');
  const scope = parishScope(filters, offset + params.length);
  return { clauses: [...clauses, ...scope.clauses], params: [...params, ...scope.params] };
}

/** The filters that were set, by name only (for the audit trail): names the route knows, never any key a URL carries. */
export const filterNames = (filters: Record<string, unknown>, known: readonly string[] = FILTER_KEYS) => known.filter((key) => filters[key]);
