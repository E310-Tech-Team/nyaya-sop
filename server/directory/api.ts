/**
 * The RCCG directory API (the "RCCG Organisation Hierarchy API"), the parish directory's source.
 * Contract: https://directory-api.rccgyaya.org/openapi.yaml (OpenAPI 3.1, version 1.0.0, read on
 * 2026-09-30); docs/05 §2 summarises what the site uses. Only the calls the site needs, each
 * answer checked against that contract before use.
 *
 * The key goes only in the Authorization header of requests to the provider's two fixed addresses
 * (never a URL a request supplies), redirects are refused so it can't be forwarded elsewhere, and
 * it is never logged, returned or put in an error: errors carry a kind and an HTTP status only.
 */
import type { DirectoryApiEnv } from '../config';

/** The provider's addresses, from the contract's `servers`. Staging is the sandbox. */
export const DIRECTORY_API_BASES: Record<DirectoryApiEnv, string> = {
  production: 'https://directory-api.rccgyaya.org/api/v1/org',
  sandbox: 'https://rccg-parish-api-staging.rccgyaya.org/api/v1/org',
};

/** IDs from each environment live in their own namespace: sandbox codes are never production ones. */
export type DirectoryNamespace = `rccg-org:${DirectoryApiEnv}`;
export const namespaceOf = (env: DirectoryApiEnv): DirectoryNamespace => `rccg-org:${env}`;
/** How an entry's canonical code is stored (church_units.external_id, parishes.external_id). */
export const externalIdOf = (namespace: DirectoryNamespace, code: string) => `${namespace}:${code}`;

export const API_LEVELS = ['intercontinental', 'continent', 'region', 'province', 'zone', 'area', 'parish'] as const;
export type ApiLevel = (typeof API_LEVELS)[number];

export type ApiRelease = {
  id: string;
  versionCode: string;
  name: string;
  status: string;
  effectiveFrom: string | null;
  publishedAt: string | null;
};
export type ApiUnitRef = { id: string; code: string; name: string; level: ApiLevel };
export type ApiParish = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  /** From the highest ancestor (continent) down to the immediate parent. */
  ancestry: ApiUnitRef[];
};
export type ApiParishPage = { parishes: ApiParish[]; versionCode: string; nextCursor: string | null };
export type ApiChangeType = 'created' | 'moved' | 'renamed' | 'retired';
export type ApiChange = {
  type: ApiChangeType;
  id: string;
  code: string | null;
  level: ApiLevel | null;
  name: string | null;
  status: string | null;
  parentId: string | null;
  fromParentId: string | null;
  toParentId: string | null;
};
export type ApiChangesPage = {
  releaseId: string;
  versionCode: string;
  baseVersionCode: string | null;
  effectiveFrom: string | null;
  counts: Record<ApiChangeType, number>;
  items: ApiChange[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

export type DirectoryApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'invalid_response';

/** What went wrong, safe to log and to store (never the key, a URL with the key, or a payload). */
export class DirectoryApiError extends Error {
  constructor(
    readonly kind: DirectoryApiErrorKind,
    readonly status: number | null,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'DirectoryApiError';
  }
}

export type DirectoryApi = {
  env: DirectoryApiEnv;
  namespace: DirectoryNamespace;
  /** The current operational release, or null when none is published. */
  latestRelease(): Promise<ApiRelease | null>;
  /** One page of a release's changes against its base release (the sync path). */
  releaseChanges(versionCode: string, page: number, perPage?: number): Promise<ApiChangesPage>;
  /** Parishes matching a name or code in the latest release (cursor-paginated). */
  searchParishes(query: string, options?: { cursor?: string; perPage?: number }): Promise<ApiParishPage>;
  /** One parish by canonical code in the latest release, or null when it isn't there (retired or never existed). */
  parishByCode(code: string): Promise<ApiParish | null>;
};

type Policy = { attempts: number; timeoutMs: number; maxWaitMs: number };
/** Background sync: patient. A person waiting on the form: quick, and never a long Retry-After. */
const SYNC: Policy = { attempts: 4, timeoutMs: 20_000, maxWaitMs: 60_000 };
const INTERACTIVE: Policy = { attempts: 2, timeoutMs: 6_000, maxWaitMs: 2_000 };

// A page of 200 changes is well under a megabyte; anything far bigger isn't what the contract describes.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type DirectoryApiOptions = {
  env: DirectoryApiEnv;
  key: string;
  /** For tests: a fake provider. Production uses the global fetch. */
  fetch?: typeof fetch;
  /** For tests: skip the waits between attempts. */
  sleep?: (ms: number) => Promise<void>;
};

export function createDirectoryApi(options: DirectoryApiOptions): DirectoryApi {
  const base = DIRECTORY_API_BASES[options.env];
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const authorization = `Bearer ${options.key}`;

  async function get(path: string, query: Record<string, string | number | undefined>, policy: Policy): Promise<unknown> {
    const url = new URL(base + path);
    for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));
    for (let attempt = 1; ; attempt++) {
      const backoff = Math.min(8_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: { authorization, accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(policy.timeoutMs),
        });
      } catch (error) {
        const kind = (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network';
        if (attempt < policy.attempts) {
          await sleep(backoff);
          continue;
        }
        throw new DirectoryApiError(kind, null, kind === 'timeout' ? 'The directory API did not answer in time' : 'The directory API could not be reached');
      }
      if (response.ok) return readJson(response);
      const { status } = response;
      const retryAfterMs = retryAfter(response.headers.get('retry-after'));
      await response.body?.cancel().catch(() => undefined);
      if (status === 429 || status >= 500) {
        const wait = status === 429 ? (retryAfterMs ?? backoff) : backoff;
        if (attempt < policy.attempts && wait <= policy.maxWaitMs) {
          await sleep(wait);
          continue;
        }
        throw status === 429
          ? new DirectoryApiError('rate_limited', status, 'The directory API is limiting requests', retryAfterMs)
          : new DirectoryApiError('unavailable', status, `The directory API answered ${status}`);
      }
      // Never retried: the same request would fail the same way.
      if (status === 401) throw new DirectoryApiError('unauthorized', status, 'The directory API refused the key (missing, invalid or revoked)');
      if (status === 403) throw new DirectoryApiError('forbidden', status, 'The directory API key does not cover this request (scope)');
      if (status === 404) throw new DirectoryApiError('not_found', status, 'The directory API has no such record');
      throw new DirectoryApiError('bad_request', status, `The directory API refused the request (${status})`);
    }
  }

  return {
    env: options.env,
    namespace: namespaceOf(options.env),

    async latestRelease() {
      const body = envelope(await get('/releases/latest', {}, SYNC));
      return body.data === null ? null : release(body.data);
    },

    async releaseChanges(versionCode, page, perPage = 200) {
      if (!VERSION_RE.test(versionCode)) throw invalid('release version');
      const body = envelope(await get(`/releases/${encodeURIComponent(versionCode)}/changes`, { page, per_page: perPage }, SYNC));
      return changes(body.data);
    },

    async searchParishes(query, searchOptions = {}) {
      const body = envelope(await get('/parishes', { query, cursor: searchOptions.cursor, per_page: searchOptions.perPage }, INTERACTIVE));
      if (!Array.isArray(body.data)) throw invalid('parish list');
      const meta = object(body.meta, 'search meta');
      return {
        parishes: body.data.map(parish),
        versionCode: text(meta.version_code, 'version code', 50),
        nextCursor: meta.next_cursor === null || meta.next_cursor === undefined ? null : text(meta.next_cursor, 'cursor', 2000),
      };
    },

    async parishByCode(code) {
      if (!CODE_RE.test(code)) throw invalid('canonical code');
      try {
        return parish(envelope(await get(`/parishes/${encodeURIComponent(code)}`, {}, INTERACTIVE)).data);
      } catch (error) {
        if (error instanceof DirectoryApiError && error.kind === 'not_found') return null;
        throw error;
      }
    },
  };
}

// ── Reading answers: everything is checked, nothing is trusted by shape alone ──────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The contract's canonical-code pattern (^[A-Za-z0-9._-]+$), with a length bound.
export const CODE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,50}$/;

const invalid = (what: string) => new DirectoryApiError('invalid_response', null, `The directory API sent an unexpected ${what}`);

async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw invalid('response size');
  }
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) throw invalid('response size');
  try {
    return JSON.parse(body);
  } catch {
    throw invalid('response (not JSON)');
  }
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(what);
  return value as Record<string, unknown>;
}
function envelope(value: unknown): Record<string, unknown> {
  const body = object(value, 'response');
  if (body.success !== true || !('data' in body)) throw invalid('response');
  return body;
}
function text(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(what);
  return value;
}
const optionalText = (value: unknown, what: string, max: number): string | null => (value === null || value === undefined ? null : text(value, what, max));
function uuid(value: unknown, what: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid(what);
  return value.toLowerCase();
}
const optionalUuid = (value: unknown, what: string): string | null => (value === null || value === undefined ? null : uuid(value, what));
function code(value: unknown): string {
  if (typeof value !== 'string' || !CODE_RE.test(value)) throw invalid('canonical code');
  return value;
}
function level(value: unknown): ApiLevel {
  if (typeof value !== 'string' || !(API_LEVELS as readonly string[]).includes(value)) throw invalid('level');
  return value as ApiLevel;
}
function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid(what);
  return value;
}
function date(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(what);
  return value;
}

function release(value: unknown): ApiRelease {
  const row = object(value, 'release');
  const versionCode = text(row.version_code, 'release version', 50);
  if (!VERSION_RE.test(versionCode)) throw invalid('release version');
  return {
    id: uuid(row.id, 'release ID'),
    versionCode,
    name: text(row.name, 'release name', 200),
    status: text(row.status, 'release status', 40),
    effectiveFrom: date(row.effective_from, 'release date'),
    publishedAt: date(row.published_at, 'release date'),
  };
}

function unitRef(value: unknown): ApiUnitRef {
  const row = object(value, 'ancestor');
  return { id: uuid(row.id, 'ancestor ID'), code: code(row.canonical_code), name: text(row.name, 'ancestor name', 200), level: level(row.level) };
}

function parish(value: unknown): ApiParish {
  const row = object(value, 'parish');
  if (row.level !== 'parish') throw invalid('parish level');
  if (!Array.isArray(row.ancestry)) throw invalid('parish ancestry');
  return {
    id: uuid(row.id, 'parish ID'),
    code: code(row.canonical_code),
    name: text(row.name, 'parish name', 200),
    parentId: optionalUuid(row.parent_id, 'parent ID'),
    ancestry: row.ancestry.map(unitRef),
  };
}

const CHANGE_TYPES: readonly ApiChangeType[] = ['created', 'moved', 'renamed', 'retired'];

function change(value: unknown): ApiChange {
  const row = object(value, 'change');
  if (typeof row.type !== 'string' || !(CHANGE_TYPES as readonly string[]).includes(row.type)) throw invalid('change type');
  return {
    type: row.type as ApiChangeType,
    id: uuid(row.id, 'unit ID'),
    code: row.canonical_code === null || row.canonical_code === undefined ? null : code(row.canonical_code),
    level: row.level === null || row.level === undefined ? null : level(row.level),
    name: optionalText(row.name, 'unit name', 200),
    status: optionalText(row.status, 'unit status', 40),
    parentId: optionalUuid(row.parent_id, 'parent ID'),
    fromParentId: optionalUuid(row.from_parent_id, 'parent ID'),
    toParentId: optionalUuid(row.to_parent_id, 'parent ID'),
  };
}

function changes(value: unknown): ApiChangesPage {
  const row = object(value, 'changes');
  if (!Array.isArray(row.items)) throw invalid('change list');
  const versionCode = text(row.version_code, 'release version', 50);
  const baseVersionCode = optionalText(row.base_version_code, 'base release version', 50);
  if (!VERSION_RE.test(versionCode) || (baseVersionCode !== null && !VERSION_RE.test(baseVersionCode))) throw invalid('release version');
  return {
    releaseId: uuid(row.release_id, 'release ID'),
    versionCode,
    baseVersionCode,
    effectiveFrom: date(row.effective_from, 'release date'),
    counts: {
      created: count(row.created_count, 'change count'),
      moved: count(row.moved_count, 'change count'),
      renamed: count(row.renamed_count, 'change count'),
      retired: count(row.retired_count, 'change count'),
    },
    items: row.items.map(change),
    page: count(row.page, 'page'),
    perPage: count(row.per_page, 'page size'),
    total: count(row.total, 'change total'),
    hasMore: row.has_more === true,
  };
}

function retryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}
