/**
 * The parish directory for applicants (docs/05 §3): search as they type, one parish's current
 * record (to re-check a saved draft), and turning their answer into what the application
 * stores. Returns names and units only: never attendance, addresses or anything staff wrote.
 *
 * With the RCCG directory API configured, only its entries (the configured environment's
 * namespace) are offered or accepted; the old list's are not.
 */
import type { FastifyInstance } from 'fastify';
import { NIGERIAN_STATES, type ParishChoice } from '../src/shared/application';
import {
  CHURCH_LEVELS,
  cleanName,
  isChainComplete,
  PARISH_SEARCH,
  parishKey,
  searchTerms,
  UNIT_SEARCH,
  type ChainUnit,
  type ChurchLevel,
  type DirectoryFreshness,
  type ParishChain,
  type ParishDetailsResponse,
  type ParishSearchResponse,
  type ParishSuggestion,
  type UnitDetails,
  type UnitSearchResponse,
  type UnitSuggestion,
} from '../src/shared/directory';
import type { Queryable } from './db';
import { DirectoryApiError, type DirectoryNamespace } from './directory/api';
import { isFresh, syncState } from './directory/api-sync';
import { enqueue } from './jobs/queue';
import { sendError } from './http';
import { directoryNamespace, type Services } from './services';
import { getSettings } from './settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Suggestions follow typing, and a church hall full of applicants can share one address.
const RATE_LIMIT = { max: 240, timeWindow: 60_000 };

// Every parish query returns the chain: one pair of columns per level.
const CHAIN_COLUMNS = CHURCH_LEVELS.map((level) => `u_${level}.id as ${level}_id, u_${level}.display_name as ${level}_name`).join(', ');
const CHAIN_JOINS = CHURCH_LEVELS.map((level) => `left join church_units u_${level} on u_${level}.id = p.${level}_id`).join(' ');

type ChainRow = Record<`${ChurchLevel}_id` | `${ChurchLevel}_name`, string | null>;
type SuggestionRow = ChainRow & { id: string; name: string; in_state: boolean; lookalikes: number; total: number };

function chainOf(row: ChainRow): ParishChain {
  const unit = (level: ChurchLevel): ChainUnit | null => {
    const id = row[`${level}_id`];
    return id ? { id, name: row[`${level}_name`]! } : null;
  };
  return { continent: unit('continent'), region: unit('region'), province: unit('province'), zone: unit('zone'), area: unit('area') };
}

const suggestion = (row: SuggestionRow): ParishSuggestion => ({
  id: row.id,
  name: row.name,
  chain: chainOf(row),
  inState: row.in_state,
  ...(row.lookalikes > 1 ? { lookalikes: row.lookalikes } : {}),
});

/**
 * Look-alikes (D-55): active parishes of one list that share a name key in one unit. Nothing tells
 * them apart (the RCCG directory API lists 1,500 such groups, each parish with its own code), so
 * the form offers each group once, as its first parish by code: always the same one.
 */
const GROUP_ORDER = 'p.external_id nulls last, p.id';

/**
 * One row per group (`unit_id`, `name_key`) that `matched` found, with the group's first parish as
 * `id` and its size. The whole group counts, not only the parishes the search matched.
 * `$ns` is the namespace parameter (cast in each use: Postgres infers one type per parameter).
 */
const groupsOf = (matched: string, ns: string) => `
  matched as (${matched}),
  grouped as (
    select (array_agg(p.id order by ${GROUP_ORDER}))[1] as id, count(*)::int as lookalikes
      from (select distinct unit_id, name_key from matched) m
      join parishes p on p.unit_id = m.unit_id and p.name_key = m.name_key
                     and p.status = 'active' and p.external_namespace is not distinct from ${ns}::text
     group by m.unit_id, m.name_key)`;

/** The active parishes that look like this one (itself included), first parish first. */
export async function lookalikeGroup(db: Queryable, parishId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select p.id from parishes p join parishes chosen on chosen.id = $1
      where p.status = 'active' and p.unit_id = chosen.unit_id and p.name_key = chosen.name_key
        and p.external_namespace is not distinct from chosen.external_namespace
      order by ${GROUP_ORDER}`,
    [parishId],
  );
  return rows.map((row) => row.id);
}

/**
 * Step 2 of the parish question (D-59): the parishes of one place, a page at a time. A province's
 * are all those in it (a zone or area below it included); a region's or continent's, those in no
 * province (or no region) below it, so every parish belongs to exactly one place.
 */
export type ParishSearchScope = { place?: { id: string; level: ChurchLevel }; offset?: number };

/** Parish `alias` is in the place `$param` of level `level` (the cached chain columns, kept by the store). */
function inPlace(alias: string, param: string, level: ChurchLevel | undefined): string {
  if (level === 'province') return `${alias}.province_id = ${param}::uuid`;
  if (level === 'region') return `${alias}.region_id = ${param}::uuid and ${alias}.province_id is null`;
  if (level === 'continent') return `${alias}.continent_id = ${param}::uuid and ${alias}.region_id is null and ${alias}.province_id is null`;
  return `${param}::uuid is null`;
}

/**
 * Active parishes matching every search term at the start of a word, in the name or in the
 * province or region. With `scope.place`, only that place's parishes, and `query` may be empty (the
 * whole list, alphabetically); `scope.offset` pages through either. Best first: more of the typed words found in the name (numbers usually mean
 * a province, so they don't count here), a name that starts with the first term, whole-word
 * matches ("12" before "120"), the applicant's state, then name and province order ("Lagos
 * Province 3" before "12"). When nothing matches, the closest spellings instead (trigram
 * similarity), marked `fuzzy`. Only the entries of `namespace` (the API's environment), or of the
 * old list when it is null.
 */
export async function searchParishes(
  db: Queryable,
  query: string,
  state: string | null,
  limit: number,
  namespace: DirectoryNamespace | null,
  scope: ParishSearchScope = {},
): Promise<ParishSearchResponse> {
  const terms = searchTerms(query);
  if (!terms.length && !scope.place) return { results: [], total: 0, fuzzy: false };

  // Terms are A–Z and 0–9 only (searchTerms), so they are safe inside LIKE and regex patterns.
  // $5 is the place (or null): always used, so Postgres can tell its type.
  const params: unknown[] = [state, terms, limit, namespace, scope.place?.id ?? null, scope.offset ?? 0];
  const inUnit = `and ${inPlace('p', '$5', scope.place?.level)}`;
  const conditions = terms.map((term) => {
    params.push(`%${term}%`, `\\m${term}`);
    return `and p.search_text like $${params.length - 1} and p.search_text ~ $${params.length}`;
  });
  const { rows } = await db.query<SuggestionRow>(
    `with ${groupsOf(`select p.unit_id, p.name_key from parishes p
                        where p.status = 'active' and p.external_namespace is not distinct from $4::text ${inUnit} ${conditions.join(' ')}`, '$4')}
     select p.id, p.display_name as name, ${CHAIN_COLUMNS},
            coalesce(u_province.state = $1::text, false) as in_state,
            g.lookalikes,
            (count(*) over ())::int as total
       from grouped g join parishes p on p.id = g.id ${CHAIN_JOINS}
      order by (select count(*) from unnest($2::text[]) as t(term) where t.term ~ '^[A-Z]' and p.name_key ~ ('\\m' || t.term)) desc,
               p.name_key like (($2::text[])[1] || '%') desc,
               (select count(*) from unnest($2::text[]) as t(term) where p.search_text ~ ('\\m' || t.term || '\\M')) desc,
               in_state desc,
               -- Names with their numbers in order ("Jesus House 2" before "10"): browsing a province reads like a list.
               regexp_replace(p.name_key, '\\d+$', ''), coalesce(substring(p.name_key from '(\\d+)$')::numeric, 0),
               p.name_key, p.display_name,
               regexp_replace(coalesce(u_province.name_key, ''), '\\d+$', ''),
               coalesce(substring(u_province.name_key from '(\\d+)$')::numeric, 0),
               p.id
      limit $3 offset $6`,
    params,
  );
  if (rows.length) return { results: rows.map(suggestion), total: rows[0]!.total, fuzzy: false };
  // A page past the end (the list changed between pages) is empty, not a reason to guess at
  // spellings; it still says how many there are now.
  if ((scope.offset ?? 0) > 0) {
    const first = await searchParishes(db, query, state, 1, namespace, { ...scope, offset: 0 });
    return { results: [], total: first.fuzzy ? 0 : first.total, fuzzy: false };
  }

  const phrase = terms.join(' ');
  if (phrase.length < 3) return { results: [], total: 0, fuzzy: false };
  const close = await db.query<SuggestionRow>(
    `with ${groupsOf(`select p.unit_id, p.name_key from parishes p
                        where p.status = 'active' and p.external_namespace is not distinct from $4::text
                          ${inUnit} and $2::text <% p.name_key`, '$4')}
     select p.id, p.display_name as name, ${CHAIN_COLUMNS},
            coalesce(u_province.state = $1::text, false) as in_state,
            g.lookalikes,
            (count(*) over ())::int as total
       from grouped g join parishes p on p.id = g.id ${CHAIN_JOINS}
      -- word_similarity finds candidates but ignores word order ("House Jesus 684" scores above
      -- "Jesus House" for "jesuss house"); whole-name plus strict word similarity ranks them.
      order by similarity($2::text, p.name_key) + strict_word_similarity($2::text, p.name_key) desc, in_state desc, p.name_key, p.display_name
      limit $3`,
    [state, phrase, limit, namespace, scope.place?.id ?? null],
  );
  return { results: close.rows.map(suggestion), total: close.rows[0]?.total ?? 0, fuzzy: close.rows.length > 0 };
}

// ── Step 1: the province (D-59) ──────────────────────────────────────────────

/** Where a parish can be chosen: provinces, and the regions and continents some parishes sit directly under. */
const PLACE_LEVELS = `('province', 'region', 'continent')`;

type PlaceRow = {
  id: string;
  level: ChurchLevel;
  name: string;
  external_id: string | null;
  p_id: string | null;
  p_level: ChurchLevel | null;
  p_name: string | null;
  g_id: string | null;
  g_level: ChurchLevel | null;
  g_name: string | null;
};

/** A unit and the two levels above it (province → region → continent), from parent_id. */
const PLACE_COLUMNS = `u.id, u.level::text as level, u.display_name as name, u.external_id,
  pu.id as p_id, pu.level::text as p_level, pu.display_name as p_name,
  gu.id as g_id, gu.level::text as g_level, gu.display_name as g_name`;
const PLACE_JOINS = `left join church_units pu on pu.id = u.parent_id left join church_units gu on gu.id = pu.parent_id`;

function placeChain(row: PlaceRow): ParishChain {
  const chain: ParishChain = { continent: null, region: null, province: null, zone: null, area: null };
  chain[row.level] = { id: row.id, name: row.name };
  if (row.p_id && row.p_level && row.p_name) chain[row.p_level] = { id: row.p_id, name: row.p_name };
  if (row.g_id && row.g_level && row.g_name) chain[row.g_level] = { id: row.g_id, name: row.g_name };
  return chain;
}

/**
 * The choices step 2 lists for place `u` (look-alikes once, D-55): `$ns`'s active parishes in it,
 * by the rule of `inPlace`. `$ns` is cast in each use.
 */
const placeParishes = (ns: string) =>
  `(select count(distinct dp.unit_id::text || ':' || dp.name_key)::int from parishes dp
     where dp.status = 'active' and dp.external_namespace is not distinct from ${ns}::text
       and ((u.level = 'province' and ${inPlace('dp', 'u.id', 'province')})
         or (u.level = 'region' and ${inPlace('dp', 'u.id', 'region')})
         or (u.level = 'continent' and ${inPlace('dp', 'u.id', 'continent')})))`;

/**
 * Places with parishes (provinces, and the regions and continents with parishes in no lower place) whose name, or a name above them, has every term at
 * the start of a word ("Lagos 12", "Region 13", "LP 12"). Best first: more of the typed words in the
 * unit's own name ("Lagos 3" finds Lagos Province 3 before a Lagos province in Continent 3), whole
 * words ("3" before "30"), the applicant's state, then names with their numbers in order ("Lagos
 * Province 3" before "Lagos Province 12"). Only the entries of `namespace` (the API's environment),
 * or of the old list when it is null.
 */
export async function searchUnits(
  db: Queryable,
  query: string,
  state: string | null,
  limit: number,
  offset: number,
  namespace: DirectoryNamespace | null,
): Promise<UnitSearchResponse> {
  const terms = searchTerms(query);
  if (!terms.length) return { results: [], total: 0 };
  // Terms are A–Z and 0–9 only (searchTerms), so they are safe inside regex patterns. One pattern
  // per term, in parameters from $from on; the namespace is `ns` (cast in each use).
  const patterns = terms.map((term) => `\\m${term}`);
  const found = (ns: string, from: number) =>
    `u.status = 'active' and u.external_namespace is not distinct from ${ns}::text and u.level in ${PLACE_LEVELS}
     ${patterns.map((_, index) => `and (u.name_key || ' ' || coalesce(pu.name_key, '') || ' ' || coalesce(gu.name_key, '')) ~ $${from + index}`).join(' ')}
     and ${placeParishes(ns)} > 0`;
  const { rows } = await db.query<PlaceRow & { parishes: number; in_state: boolean }>(
    `select ${PLACE_COLUMNS}, ${placeParishes('$4')} as parishes, coalesce(u.state = $1::text, false) as in_state
       from church_units u ${PLACE_JOINS}
      where ${found('$4', 6)}
      order by (select count(*) from unnest($5::text[]) as t(term) where u.name_key ~ ('\\m' || t.term)) desc,
               (select count(*) from unnest($5::text[]) as t(term) where u.name_key ~ ('\\m' || t.term || '\\M')) desc,
               in_state desc,
               regexp_replace(u.name_key, '\\d+$', ''),
               coalesce(substring(u.name_key from '(\\d+)$')::numeric, 0),
               u.name_key, u.id
      limit $2 offset $3`,
    [state, limit, offset, namespace, terms, ...patterns],
  );
  // Counted apart, so a page past the end still says how many there are.
  const { rows: counted } = await db.query<{ total: number }>(
    `select count(*)::int as total from church_units u ${PLACE_JOINS} where ${found('$1', 2)}`,
    [namespace, ...patterns],
  );
  const results: UnitSuggestion[] = rows.map((row) => ({
    id: row.id,
    level: row.level,
    name: row.name,
    chain: placeChain(row),
    parishes: row.parishes,
    inState: row.in_state,
  }));
  return { results, total: counted[0]?.total ?? 0 };
}

export type ParishPlace = UnitDetails & { externalId: string | null };

/**
 * A unit an applicant may choose a parish in: active, in the directory in use, a province, region
 * or continent, with active parishes in it (`inPlace`). Null otherwise (unknown, gone, empty).
 */
export async function unitPlace(db: Queryable, unitId: string, namespace: DirectoryNamespace | null): Promise<ParishPlace | null> {
  if (!UUID_RE.test(unitId)) return null;
  const { rows } = await db.query<PlaceRow & { parishes: number }>(
    `select * from (
       select ${PLACE_COLUMNS}, ${placeParishes('$2')} as parishes from church_units u ${PLACE_JOINS}
        where u.id = $1 and u.status = 'active' and u.external_namespace is not distinct from $2::text and u.level in ${PLACE_LEVELS}) place
      where place.parishes > 0`,
    [unitId, namespace],
  );
  const row = rows[0];
  return row ? { id: row.id, level: row.level, name: row.name, chain: placeChain(row), parishes: row.parishes, externalId: row.external_id } : null;
}

/** One parish as it stands now, or null. A merged parish names the one it was merged into. */
export async function parishDetails(db: Queryable, id: string): Promise<ParishDetailsResponse | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query<ChainRow & { id: string; name: string; status: ParishDetailsResponse['status']; merged_into_id: string | null; lookalikes: number }>(
    `select p.id, p.display_name as name, p.status::text as status, p.merged_into_id, ${CHAIN_COLUMNS},
            (select count(*)::int from parishes q
              where p.status = 'active' and q.status = 'active' and q.unit_id = p.unit_id and q.name_key = p.name_key
                and q.external_namespace is not distinct from p.external_namespace) as lookalikes
       from parishes p ${CHAIN_JOINS}
      where p.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  let mergedInto: ChainUnit | null = null;
  for (let next = row.merged_into_id, hops = 0; next && hops < 10; hops++) {
    const target = (await db.query<{ id: string; name: string; merged_into_id: string | null }>(
      `select id, display_name as name, merged_into_id from parishes where id = $1`,
      [next],
    )).rows[0];
    if (!target) break;
    mergedInto = { id: target.id, name: target.name };
    next = target.merged_into_id;
  }
  return { id: row.id, name: row.name, status: row.status, mergedInto, chain: chainOf(row), ...(row.lookalikes > 1 ? { lookalikes: row.lookalikes } : {}) };
}

/** What the application stores about the parish (docs/05 §2). */
/** The unit an applicant chose before saying their parish isn't listed, and the units above it (D-59). */
export type PlaceSnapshot = { unit: ChainUnit & { level: ChurchLevel }; importId: string | null; externalId: string | null } & ParishChain;

export type ParishLink = {
  status: 'listed' | 'reported' | 'legacy_text' | 'not_provided';
  parishId: string | null;
  /** applications.parish_name: the directory's name, or what the applicant typed. */
  name: string | null;
  /**
   * The parish and its chain as the applicant confirmed them, the import they came from and, for a
   * parish from the RCCG directory API, its canonical code in the environment's namespace.
   */
  snapshot: ({ parish: ChainUnit; importId: string | null; externalId: string | null; lookalikes?: string[] } & ParishChain) | null;
  /** "I can't find my parish" after choosing a province (D-59): where they said it is, as the directory names it. */
  place: PlaceSnapshot | null;
  /** For staff in Parish review: at most one of each kind. */
  reports: ParishReport[];
};

export type ParishReport =
  | { kind: 'not_listed'; name: string }
  | { kind: 'details_wrong'; parishId: string }
  /** The applicant chose a look-alike group: which of its parishes is theirs is for staff to settle. */
  | { kind: 'lookalike'; parishId: string };

export const PARISH_ERRORS = {
  unknown: 'We couldn’t find that parish. Search for it again.',
  inactive: 'That parish is no longer on our list. Search for it again, or tell us it isn’t listed.',
  merged: 'That parish’s details have changed. Search for it again and confirm it.',
  otherList: 'That parish is from an earlier list. Search for it again.',
  placeGone: 'That province is no longer on our list. Choose your province again.',
} as const;

/** Unavailable: the RCCG directory couldn't confirm the parish just now, so nothing may be stored. */
export type ParishResolution = { ok: true; link: ParishLink } | { ok: false; error: string } | { ok: false; unavailable: true };

/**
 * Checks a listed parish is still on the list (a draft may be days old) and builds the link. The
 * chain always comes from the directory, never from the browser. A parish the directory doesn't
 * place under a continent is kept as it is (nothing is filled in) and reported for staff to complete.
 *
 * With the RCCG directory API, the parish must come from its entries, and be current: the local
 * copy counts when the provider confirmed its release recently enough (`isFresh`); otherwise the
 * parish is looked up live by its canonical code. If the provider can't answer, the result is
 * `unavailable` (never a silent acceptance); if it has changed since the last sync, the applicant
 * is asked to choose it again and a sync is queued.
 */
export async function resolveParish(services: Pick<Services, 'db' | 'directory' | 'config'>, choice: ParishChoice): Promise<ParishResolution> {
  const { db } = services;
  if (choice.kind === 'typed') {
    return { ok: true, link: { status: choice.name ? 'legacy_text' : 'not_provided', parishId: null, name: choice.name, snapshot: null, place: null, reports: [] } };
  }
  if (choice.kind === 'not_listed') {
    const link: ParishLink = { status: 'reported', parishId: null, name: choice.name, snapshot: null, place: null, reports: [{ kind: 'not_listed', name: choice.name }] };
    if (!choice.unitId) return { ok: true, link };
    // The province they chose first (D-59): checked against the list, and kept as the list names it.
    // No parish is accepted, so a stale copy needs no live check: staff review every such answer.
    const place = await unitPlace(db, choice.unitId, directoryNamespace(services));
    if (!place) return { ok: false, error: PARISH_ERRORS.placeGone };
    const { rows } = await db.query<{ id: string }>(`select id from directory_imports where status = 'applied' order by started_at desc limit 1`);
    const unit = { id: place.id, name: place.name, level: place.level };
    return { ok: true, link: { ...link, place: { unit, importId: rows[0]?.id ?? null, externalId: place.externalId, ...place.chain } } };
  }
  const parish = await parishDetails(db, choice.parishId);
  if (!parish) return { ok: false, error: PARISH_ERRORS.unknown };
  if (parish.status !== 'active') return { ok: false, error: parish.status === 'merged' ? PARISH_ERRORS.merged : PARISH_ERRORS.inactive };
  const namespace = directoryNamespace(services);
  const source = (
    await db.query<{ namespace: string | null; external_id: string | null; name_key: string; unit_uuid: string | null }>(
      `select p.external_namespace as namespace, p.external_id, p.name_key, u.external_uuid::text as unit_uuid
         from parishes p join church_units u on u.id = p.unit_id where p.id = $1`,
      [parish.id],
    )
  ).rows[0]!;
  // Only the directory in use: never a parish from the old list (or from the other environment).
  if (source.namespace !== namespace) return { ok: false, error: PARISH_ERRORS.otherList };
  if (namespace && services.directory && services.config.directoryApi && source.external_id) {
    const state = await syncState(db, namespace);
    if (!isFresh(state, services.config.directoryApi.freshnessHours)) {
      let live;
      try {
        live = await services.directory.parishByCode(source.external_id.slice(namespace.length + 1));
      } catch (error) {
        if (error instanceof DirectoryApiError) return { ok: false, unavailable: true };
        throw error;
      }
      if (!live) return { ok: false, error: PARISH_ERRORS.inactive };
      if (live.parentId !== source.unit_uuid || parishKey(cleanName(live.name)) !== source.name_key) {
        // Newer than the copy here: bring the directory up to date, and ask for the choice again.
        await enqueue(db, { kind: 'directory.sync', dedupeKey: `directory.sync:changed:${new Date().toISOString().slice(0, 13)}`, maxAttempts: 1 });
        return { ok: false, error: PARISH_ERRORS.merged };
      }
    }
  }
  // A look-alike group was offered as one choice: link its first parish (the same unit, so every
  // count above the parish is right), keep the whole group, and let staff settle which is meant.
  const group = await lookalikeGroup(db, parish.id);
  const chosen = group.length > 1 && group[0] !== parish.id ? ((await parishDetails(db, group[0]!)) ?? parish) : parish;
  const chosenCode =
    chosen.id === parish.id
      ? source.external_id
      : ((await db.query<{ external_id: string | null }>(`select external_id from parishes where id = $1`, [chosen.id])).rows[0]?.external_id ?? null);
  const { rows } = await db.query<{ id: string }>(`select id from directory_imports where status = 'applied' order by started_at desc limit 1`);
  const reports: ParishReport[] = [];
  if (choice.detailsWrong || !isChainComplete(chosen.chain)) reports.push({ kind: 'details_wrong', parishId: chosen.id });
  if (group.length > 1) reports.push({ kind: 'lookalike', parishId: chosen.id });
  return {
    ok: true,
    link: {
      status: 'listed',
      parishId: chosen.id,
      name: chosen.name,
      snapshot: {
        parish: { id: chosen.id, name: chosen.name },
        importId: rows[0]?.id ?? null,
        externalId: chosenCode,
        ...chosen.chain,
        ...(group.length > 1 ? { lookalikes: group } : {}),
      },
      place: null,
      reports,
    },
  };
}

/**
 * The parish question uses the directory: switched on in Settings, and there is a list to search
 * (the RCCG directory API's entries when it is configured, otherwise the old list's).
 */
export async function parishDirectoryEnabled(db: Queryable, namespace: DirectoryNamespace | null): Promise<boolean> {
  if (!(await getSettings(db)).parish_directory_enabled) return false;
  const { rows } = await db.query<{ ready: boolean }>(
    `select exists (select 1 from parishes where status = 'active' and external_namespace is not distinct from $1::text) as ready`,
    [namespace],
  );
  return rows[0]!.ready;
}

/** How current the directory is, when it comes from the RCCG directory API (null otherwise). */
export async function directoryFreshness(services: Pick<Services, 'db' | 'directory' | 'config'>): Promise<DirectoryFreshness | null> {
  const namespace = directoryNamespace(services);
  if (!namespace || !services.config.directoryApi) return null;
  const state = await syncState(services.db, namespace);
  return { source: 'api', release: state?.releaseVersion ?? null, checkedAt: state?.checkedAt ?? null, stale: !isFresh(state, services.config.directoryApi.freshnessHours) };
}

export async function parishRoutes(app: FastifyInstance, services: Services) {
  const { db } = services;

  /** A whole number from the query string, within [min, max]; `fallback` when missing or not a number. */
  const whole = (value: unknown, fallback: number, min: number, max: number) => {
    const number = typeof value === 'string' && value.trim() !== '' ? Math.trunc(Number(value)) : fallback;
    return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
  };
  const rankingState = (value: unknown) => (typeof value === 'string' && (NIGERIAN_STATES as readonly string[]).includes(value) ? value : null);

  // Step 1 of the parish question (D-59): provinces, and the regions and continents with parishes directly under them.
  app.get('/units', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    const namespace = directoryNamespace(services);
    if (!(await parishDirectoryEnabled(db, namespace))) return sendError(reply, 404, 'NOT_FOUND', 'The parish list is not in use.');
    const query = request.query as Record<string, unknown>;
    const text = typeof query.q === 'string' ? query.q.trim() : '';
    if (text.length < UNIT_SEARCH.minLength || text.length > PARISH_SEARCH.maxLength) {
      return sendError(reply, 400, 'BAD_REQUEST', 'Type your province’s name or number.');
    }
    const limit = whole(query.limit, UNIT_SEARCH.pageSize, 1, UNIT_SEARCH.pageSize);
    const offset = whole(query.offset, 0, 0, UNIT_SEARCH.maxOffset);
    const found = await searchUnits(db, text, rankingState(query.state), limit, offset, namespace);
    const directory = await directoryFreshness(services);
    return directory ? { ...found, directory } : found;
  });

  // A saved draft's province, re-checked like its parish (D-59). Open like the parish lookup below.
  app.get<{ Params: { id: string } }>('/units/:id', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    const place = await unitPlace(db, request.params.id, directoryNamespace(services));
    if (!place) return sendError(reply, 404, 'NOT_FOUND', 'That province isn’t on the list.');
    const details: UnitDetails = { id: place.id, level: place.level, name: place.name, chain: place.chain, parishes: place.parishes };
    return details;
  });

  app.get('/search', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    // Searchable only once the directory is switched on: an imported list may still be under review.
    // (Looking a parish up by its ID stays open: IDs can't be guessed, and saved answers are re-checked.)
    const namespace = directoryNamespace(services);
    if (!(await parishDirectoryEnabled(db, namespace))) return sendError(reply, 404, 'NOT_FOUND', 'The parish list is not in use.');
    const query = request.query as Record<string, unknown>;
    const text = typeof query.q === 'string' ? query.q.trim() : '';
    // Step 2 (D-59): one place's parishes, filtered by what's typed or all of them, a page at a time.
    if (query.unit !== undefined) {
      const place = typeof query.unit === 'string' ? await unitPlace(db, query.unit, namespace) : null;
      if (!place) return sendError(reply, 404, 'NOT_FOUND', 'That province isn’t on the list.');
      if (text.length > PARISH_SEARCH.maxLength) return sendError(reply, 400, 'BAD_REQUEST', `Type at most ${PARISH_SEARCH.maxLength} characters.`);
      const limit = whole(query.limit, PARISH_SEARCH.pageSize, 1, PARISH_SEARCH.pageSize);
      const offset = whole(query.offset, 0, 0, PARISH_SEARCH.maxOffset);
      const found = await searchParishes(db, text, null, limit, namespace, { place, offset });
      const directory = await directoryFreshness(services);
      return directory ? { ...found, directory } : found;
    }
    if (text.length < PARISH_SEARCH.minLength || text.length > PARISH_SEARCH.maxLength) {
      return sendError(reply, 400, 'BAD_REQUEST', `Type between ${PARISH_SEARCH.minLength} and ${PARISH_SEARCH.maxLength} characters.`);
    }
    // Only ranks the results. Query strings are never logged (server/app.ts).
    const state = rankingState(query.state);
    const limit = Math.min(Math.max(Math.trunc(Number(query.limit)) || PARISH_SEARCH.maxResults, 1), PARISH_SEARCH.maxResults);
    // Searched here, in the copy kept in step with the provider: fast, and within its rate limits.
    const found = await searchParishes(db, text, state, limit, namespace);
    const directory = await directoryFreshness(services);
    return directory ? { ...found, directory } : found;
  });

  app.get<{ Params: { id: string } }>('/:id', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    const parish = await parishDetails(db, request.params.id);
    return parish ?? sendError(reply, 404, 'NOT_FOUND', 'There is no parish with that ID.');
  });
}
