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
  type ChainUnit,
  type ChurchLevel,
  type DirectoryFreshness,
  type ParishChain,
  type ParishDetailsResponse,
  type ParishSearchResponse,
  type ParishSuggestion,
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
type SuggestionRow = ChainRow & { id: string; name: string; in_state: boolean; total: number };

function chainOf(row: ChainRow): ParishChain {
  const unit = (level: ChurchLevel): ChainUnit | null => {
    const id = row[`${level}_id`];
    return id ? { id, name: row[`${level}_name`]! } : null;
  };
  return { continent: unit('continent'), region: unit('region'), province: unit('province'), zone: unit('zone'), area: unit('area') };
}

const suggestion = (row: SuggestionRow): ParishSuggestion => ({ id: row.id, name: row.name, chain: chainOf(row), inState: row.in_state });

/**
 * Active parishes matching every search term at the start of a word, in the name or in the
 * province or region. Best first: more of the typed words found in the name (numbers usually mean
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
): Promise<ParishSearchResponse> {
  const terms = searchTerms(query);
  if (!terms.length) return { results: [], total: 0, fuzzy: false };

  // Terms are A–Z and 0–9 only (searchTerms), so they are safe inside LIKE and regex patterns.
  const params: unknown[] = [state, terms, limit, namespace];
  const conditions = terms.map((term) => {
    params.push(`%${term}%`, `\\m${term}`);
    return `and p.search_text like $${params.length - 1} and p.search_text ~ $${params.length}`;
  });
  const { rows } = await db.query<SuggestionRow>(
    `select p.id, p.display_name as name, ${CHAIN_COLUMNS},
            coalesce(u_province.state = $1::text, false) as in_state,
            (count(*) over ())::int as total
       from parishes p ${CHAIN_JOINS}
      where p.status = 'active' and p.external_namespace is not distinct from $4::text ${conditions.join(' ')}
      order by (select count(*) from unnest($2::text[]) as t(term) where t.term ~ '^[A-Z]' and p.name_key ~ ('\\m' || t.term)) desc,
               p.name_key like (($2::text[])[1] || '%') desc,
               (select count(*) from unnest($2::text[]) as t(term) where p.search_text ~ ('\\m' || t.term || '\\M')) desc,
               in_state desc,
               p.name_key, p.display_name,
               regexp_replace(coalesce(u_province.name_key, ''), '\\d+$', ''),
               coalesce(substring(u_province.name_key from '(\\d+)$')::numeric, 0)
      limit $3`,
    params,
  );
  if (rows.length) return { results: rows.map(suggestion), total: rows[0]!.total, fuzzy: false };

  const phrase = terms.join(' ');
  if (phrase.length < 3) return { results: [], total: 0, fuzzy: false };
  const close = await db.query<SuggestionRow>(
    `select p.id, p.display_name as name, ${CHAIN_COLUMNS},
            coalesce(u_province.state = $1::text, false) as in_state,
            (count(*) over ())::int as total
       from parishes p ${CHAIN_JOINS}
      where p.status = 'active' and p.external_namespace is not distinct from $4::text and $2::text <% p.name_key
      -- word_similarity finds candidates but ignores word order ("House Jesus 684" scores above
      -- "Jesus House" for "jesuss house"); whole-name plus strict word similarity ranks them.
      order by similarity($2::text, p.name_key) + strict_word_similarity($2::text, p.name_key) desc, in_state desc, p.name_key, p.display_name
      limit $3`,
    [state, phrase, limit, namespace],
  );
  return { results: close.rows.map(suggestion), total: close.rows[0]?.total ?? 0, fuzzy: close.rows.length > 0 };
}

/** One parish as it stands now, or null. A merged parish names the one it was merged into. */
export async function parishDetails(db: Queryable, id: string): Promise<ParishDetailsResponse | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query<ChainRow & { id: string; name: string; status: ParishDetailsResponse['status']; merged_into_id: string | null }>(
    `select p.id, p.display_name as name, p.status::text as status, p.merged_into_id, ${CHAIN_COLUMNS}
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
  return { id: row.id, name: row.name, status: row.status, mergedInto, chain: chainOf(row) };
}

/** What the application stores about the parish (docs/05 §2). */
export type ParishLink = {
  status: 'listed' | 'reported' | 'legacy_text' | 'not_provided';
  parishId: string | null;
  /** applications.parish_name: the directory's name, or what the applicant typed. */
  name: string | null;
  /**
   * The parish and its chain as the applicant confirmed them, the import they came from and, for a
   * parish from the RCCG directory API, its canonical code in the environment's namespace.
   */
  snapshot: ({ parish: ChainUnit; importId: string | null; externalId: string | null } & ParishChain) | null;
  report: { kind: 'not_listed'; name: string } | { kind: 'details_wrong'; parishId: string } | null;
};

export const PARISH_ERRORS = {
  unknown: 'We couldn’t find that parish. Search for it again.',
  inactive: 'That parish is no longer on our list. Search for it again, or tell us it isn’t listed.',
  merged: 'That parish’s details have changed. Search for it again and confirm it.',
  otherList: 'That parish is from an earlier list. Search for it again.',
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
    return { ok: true, link: { status: choice.name ? 'legacy_text' : 'not_provided', parishId: null, name: choice.name, snapshot: null, report: null } };
  }
  if (choice.kind === 'not_listed') {
    return { ok: true, link: { status: 'reported', parishId: null, name: choice.name, snapshot: null, report: { kind: 'not_listed', name: choice.name } } };
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
  const { rows } = await db.query<{ id: string }>(`select id from directory_imports where status = 'applied' order by started_at desc limit 1`);
  return {
    ok: true,
    link: {
      status: 'listed',
      parishId: parish.id,
      name: parish.name,
      snapshot: { parish: { id: parish.id, name: parish.name }, importId: rows[0]?.id ?? null, externalId: source.external_id, ...parish.chain },
      report: choice.detailsWrong || !isChainComplete(parish.chain) ? { kind: 'details_wrong', parishId: parish.id } : null,
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

  app.get('/search', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    // Searchable only once the directory is switched on: an imported list may still be under review.
    // (Looking a parish up by its ID stays open: IDs can't be guessed, and saved answers are re-checked.)
    const namespace = directoryNamespace(services);
    if (!(await parishDirectoryEnabled(db, namespace))) return sendError(reply, 404, 'NOT_FOUND', 'The parish list is not in use.');
    const query = request.query as Record<string, unknown>;
    const text = typeof query.q === 'string' ? query.q.trim() : '';
    if (text.length < PARISH_SEARCH.minLength || text.length > PARISH_SEARCH.maxLength) {
      return sendError(reply, 400, 'BAD_REQUEST', `Type between ${PARISH_SEARCH.minLength} and ${PARISH_SEARCH.maxLength} characters.`);
    }
    // Only ranks the results. Query strings are never logged (server/app.ts).
    const state = typeof query.state === 'string' && (NIGERIAN_STATES as readonly string[]).includes(query.state) ? query.state : null;
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
