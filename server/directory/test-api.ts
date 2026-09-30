/**
 * Test-only: a fake RCCG directory API that follows the contract (openapi.yaml, docs/05 §2), in
 * memory. Tests never reach the real provider or need a key; they can make it fail on purpose.
 */
import type { ApiLevel } from './api';
import { DIRECTORY_API_BASES } from './api';

export type FakeChange =
  | { type: 'created'; id: string; code: string; level: ApiLevel; name: string; parentId: string | null; status?: string }
  | { type: 'moved'; id: string; toParentId: string; fromParentId?: string }
  | { type: 'renamed'; id: string; name: string; fromName?: string }
  | { type: 'retired'; id: string };
export type FakeRelease = { id: string; versionCode: string; name: string; base: string | null; effectiveFrom: string; changes: FakeChange[] };

/** What the next request answers instead of its normal answer (one per request, in order). */
export type Failure =
  | { status: number; retryAfter?: string; body?: unknown }
  | { network: 'timeout' | 'refused' }
  | { malformed: string };

export type FakeDirectoryApi = {
  fetch: typeof fetch;
  releases: FakeRelease[];
  /** The release /releases/latest names (the last one by default). */
  latest: string | null;
  failures: Failure[];
  /** Each request's path and query, without the host: what tests assert on. */
  calls: string[];
  /** Every header value sent, so tests can check the key only ever travelled in Authorization. */
  seen: { url: string; authorization: string | null }[];
};

type Unit = { id: string; code: string; level: ApiLevel; name: string; parentId: string | null; retired: boolean };

function replay(releases: FakeRelease[], upTo: string | null): Map<string, Unit> {
  const units = new Map<string, Unit>();
  const byVersion = new Map(releases.map((release) => [release.versionCode, release]));
  const chain: FakeRelease[] = [];
  for (let version = upTo; version; version = byVersion.get(version)?.base ?? null) chain.unshift(byVersion.get(version)!);
  for (const release of chain) {
    for (const change of release.changes) {
      const unit = units.get(change.id);
      if (change.type === 'created') units.set(change.id, { id: change.id, code: change.code, level: change.level, name: change.name, parentId: change.parentId, retired: !!change.status && change.status !== 'active' });
      else if (unit && change.type === 'moved') unit.parentId = change.toParentId;
      else if (unit && change.type === 'renamed') unit.name = change.name;
      else if (unit && change.type === 'retired') unit.retired = true;
    }
  }
  return units;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function changeRow(change: FakeChange, units: Map<string, Unit>) {
  if (change.type === 'created') {
    return { type: 'created', id: change.id, canonical_code: change.code, level: change.level, name: change.name, status: change.status ?? 'active', parent_id: change.parentId, parent_name: change.parentId ? (units.get(change.parentId)?.name ?? null) : null };
  }
  const unit = units.get(change.id);
  if (change.type === 'moved') {
    return { type: 'moved', id: change.id, canonical_code: unit?.code ?? null, level: unit?.level ?? null, name: unit?.name ?? null, from_parent_id: change.fromParentId ?? null, to_parent_id: change.toParentId };
  }
  if (change.type === 'renamed') return { type: 'renamed', id: change.id, canonical_code: unit?.code ?? null, level: unit?.level ?? null, name: change.name, from_name: change.fromName ?? unit?.name ?? null };
  return { type: 'retired', id: change.id, canonical_code: unit?.code ?? null, level: unit?.level ?? null, name: unit?.name ?? null, status: 'retired' };
}

function parishView(unit: Unit, units: Map<string, Unit>) {
  const ancestry: { id: string; canonical_code: string; name: string; level: string }[] = [];
  for (let parent = unit.parentId ? units.get(unit.parentId) : undefined; parent; parent = parent.parentId ? units.get(parent.parentId) : undefined) {
    if (parent.level === 'intercontinental') break;
    ancestry.unshift({ id: parent.id, canonical_code: parent.code, name: parent.name, level: parent.level });
  }
  return {
    id: unit.id,
    canonical_code: unit.code,
    name: unit.name,
    level: 'parish',
    levels: ['parish'],
    parent_id: unit.parentId,
    type: 'conventional',
    membership_completeness: null,
    headquarters_name: null,
    ancestry,
  };
}

export function fakeDirectoryApi(options: { key: string; env?: 'production' | 'sandbox'; releases: FakeRelease[] }): FakeDirectoryApi {
  const base = DIRECTORY_API_BASES[options.env ?? 'sandbox'];
  const fake: FakeDirectoryApi = {
    releases: options.releases,
    latest: options.releases.at(-1)?.versionCode ?? null,
    failures: [],
    calls: [],
    seen: [],
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      fake.seen.push({ url: url.toString(), authorization: headers.get('authorization') });
      if (!url.toString().startsWith(base)) throw new TypeError(`unexpected host ${url.host}`);
      const path = url.pathname.slice(new URL(base).pathname.length);
      fake.calls.push(path + url.search);
      const failure = fake.failures.shift();
      if (failure) {
        if ('network' in failure) {
          throw failure.network === 'timeout' ? Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }) : new TypeError('fetch failed');
        }
        if ('malformed' in failure) return new Response(failure.malformed, { status: 200, headers: { 'content-type': 'application/json' } });
        return json(failure.status, failure.body ?? { success: false, message: 'Failure for a test.' }, failure.retryAfter ? { 'retry-after': failure.retryAfter } : {});
      }
      if (headers.get('authorization') !== `Bearer ${options.key}`) return json(401, { success: false, message: 'Invalid or revoked API key.' });

      const summary = (release: FakeRelease) => ({ id: release.id, version_code: release.versionCode, name: release.name, status: 'published', effective_from: release.effectiveFrom, published_at: release.effectiveFrom });
      if (path === '/releases/latest') {
        const release = fake.releases.find((candidate) => candidate.versionCode === fake.latest);
        return json(200, { success: true, data: release ? summary(release) : null });
      }
      const changes = path.match(/^\/releases\/([^/]+)\/changes$/);
      if (changes) {
        const release = fake.releases.find((candidate) => candidate.versionCode === decodeURIComponent(changes[1]!));
        if (!release) return json(404, { success: false, message: 'Release not found.' });
        const page = Number(url.searchParams.get('page') ?? 1);
        const perPage = Number(url.searchParams.get('per_page') ?? 100);
        const before = replay(fake.releases, release.base);
        const rows = release.changes.map((change) => changeRow(change, before));
        const items = rows.slice((page - 1) * perPage, page * perPage);
        const counted = (type: string) => release.changes.filter((change) => change.type === type).length;
        const hasMore = page * perPage < rows.length;
        return json(200, {
          success: true,
          data: {
            release_id: release.id,
            version_code: release.versionCode,
            base_version_code: release.base,
            effective_from: release.effectiveFrom,
            created_count: counted('created'),
            moved_count: counted('moved'),
            renamed_count: counted('renamed'),
            retired_count: counted('retired'),
            items,
            page,
            per_page: perPage,
            total: rows.length,
            has_more: hasMore,
          },
          meta: { page, per_page: perPage, total: rows.length, has_more: hasMore },
        });
      }
      const units = replay(fake.releases, fake.latest);
      const active = [...units.values()].filter((unit) => unit.level === 'parish' && !unit.retired);
      if (path === '/parishes') {
        const query = (url.searchParams.get('query') ?? '').toUpperCase();
        if (query.length < 2) return json(422, { success: false, message: 'The query field must be at least 2 characters.', errors: { query: ['too short'] } });
        const matches = active
          .filter((unit) => unit.code.toUpperCase().startsWith(query) || unit.name.toUpperCase().includes(query))
          .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
        const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 20), 50);
        const offset = Number(url.searchParams.get('cursor') ?? 0);
        const page = matches.slice(offset, offset + perPage);
        const next = offset + perPage < matches.length ? String(offset + perPage) : null;
        return json(200, { success: true, data: page.map((unit) => parishView(unit, units)), meta: { version_code: fake.latest, effective_from: null, per_page: perPage, next_cursor: next } });
      }
      const byCode = path.match(/^\/parishes\/([^/]+)$/);
      if (byCode) {
        const unit = active.find((candidate) => candidate.code === decodeURIComponent(byCode[1]!));
        return unit ? json(200, { success: true, data: { ...parishView(unit, units), seat_of_org_unit_id: null } }) : json(404, { success: false, message: 'Parish not found.' });
      }
      return json(404, { success: false, message: 'Not found.' });
    },
  };
  return fake;
}

// ── A small hierarchy in the provider's shape, with the cases the site has to handle ────────────

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const FIXTURE = {
  root: id(1),
  continent1: id(10),
  continent2: id(20),
  continent3: id(30),
  region5: id(105),
  region54: id(154),
  region19: id(119),
  region14: id(114),
  rivers4: id(504),
  lagos3: id(403),
  lagos2: id(402),
  lagos135: id(435),
  jesusRivers: id(1001),
  jesusLagos3A: id(1002),
  jesusLagos3B: id(1003),
  grace: id(1004),
  prayer: id(1005),
  jesusLagos2: id(1006),
  abundance: id(1007),
  central: id(1008),
  newDawn: id(1009),
} as const;
const F = FIXTURE;

/** SANDBOX.1: the base release. Two parishes named Jesus House in one province (distinct codes). */
export const BASE_RELEASE: FakeRelease = {
  id: id(9001),
  versionCode: 'SANDBOX.1',
  name: 'Sandbox base list',
  base: null,
  effectiveFrom: '2026-08-16T23:00:00Z',
  changes: [
    { type: 'created', id: F.root, code: 'SANDBOX-ROOT', level: 'intercontinental', name: 'RCCG WORLDWIDE', parentId: null },
    { type: 'created', id: F.continent1, code: 'SANDBOX-C1', level: 'continent', name: 'CONTINENT 1', parentId: F.root },
    { type: 'created', id: F.continent2, code: 'SANDBOX-C2', level: 'continent', name: 'CONTINENT 2', parentId: F.root },
    { type: 'created', id: F.continent3, code: 'SANDBOX-C3', level: 'continent', name: 'CONTINENT 3', parentId: F.root },
    { type: 'created', id: F.region5, code: 'SANDBOX-R5', level: 'region', name: 'REGION 5', parentId: F.continent1 },
    { type: 'created', id: F.region54, code: 'SANDBOX-R54', level: 'region', name: 'REGION 54', parentId: F.continent3 },
    { type: 'created', id: F.region19, code: 'SANDBOX-R19', level: 'region', name: 'REGION 19', parentId: F.continent3 },
    { type: 'created', id: F.region14, code: 'SANDBOX-R14', level: 'region', name: 'REGION 14', parentId: F.continent3 },
    { type: 'created', id: F.rivers4, code: 'SANDBOX-P504', level: 'province', name: 'RIVERS PROVINCE 4', parentId: F.region5 },
    { type: 'created', id: F.lagos3, code: 'SANDBOX-P403', level: 'province', name: 'LAGOS PROVINCE 3', parentId: F.region54 },
    { type: 'created', id: F.lagos2, code: 'SANDBOX-P402', level: 'province', name: 'LAGOS PROVINCE 2', parentId: F.region19 },
    { type: 'created', id: F.jesusRivers, code: 'SANDBOX-1001', level: 'parish', name: 'JESUS HOUSE', parentId: F.rivers4 },
    { type: 'created', id: F.jesusLagos3A, code: 'SANDBOX-1002', level: 'parish', name: 'JESUS HOUSE', parentId: F.lagos3 },
    { type: 'created', id: F.jesusLagos3B, code: 'SANDBOX-1003', level: 'parish', name: 'JESUS HOUSE', parentId: F.lagos3 },
    { type: 'created', id: F.grace, code: 'SANDBOX-1004', level: 'parish', name: 'GRACE CHAPEL', parentId: F.lagos3 },
    { type: 'created', id: F.prayer, code: 'SANDBOX-1005', level: 'parish', name: 'HOUSE OF PRAYER', parentId: F.lagos3 },
    { type: 'created', id: F.jesusLagos2, code: 'SANDBOX-1006', level: 'parish', name: 'JESUS HOUSE', parentId: F.lagos2 },
    { type: 'created', id: F.abundance, code: 'SANDBOX-1007', level: 'parish', name: 'ABUNDANCE MEGA', parentId: F.region14 },
    { type: 'created', id: F.central, code: 'SANDBOX-1008', level: 'parish', name: 'RCCG CENTRAL PARISH', parentId: F.continent2 },
  ],
};

/** SANDBOX.2: a move, a rename, a retirement and a new parish. */
export const SECOND_RELEASE: FakeRelease = {
  id: id(9002),
  versionCode: 'SANDBOX.2',
  name: 'Sandbox changes',
  base: 'SANDBOX.1',
  effectiveFrom: '2026-09-20T23:00:00Z',
  changes: [
    { type: 'moved', id: F.grace, fromParentId: F.lagos3, toParentId: F.lagos2 },
    { type: 'renamed', id: F.prayer, name: 'HOUSE OF PRAYER CHAPEL', fromName: 'HOUSE OF PRAYER' },
    { type: 'retired', id: F.jesusRivers },
    { type: 'created', id: F.newDawn, code: 'SANDBOX-1009', level: 'parish', name: 'NEW DAWN', parentId: F.lagos3 },
  ],
};

/** SANDBOX.3: a new province (a parish moves into it), and a region retired with its parish. */
export const THIRD_RELEASE: FakeRelease = {
  id: id(9003),
  versionCode: 'SANDBOX.3',
  name: 'Sandbox new province',
  base: 'SANDBOX.2',
  effectiveFrom: '2026-10-05T23:00:00Z',
  changes: [
    { type: 'created', id: F.lagos135, code: 'SANDBOX-P435', level: 'province', name: 'LAGOS PROVINCE 135', parentId: F.region54 },
    { type: 'moved', id: F.jesusLagos3B, fromParentId: F.lagos3, toParentId: F.lagos135 },
    { type: 'retired', id: F.abundance },
    { type: 'retired', id: F.region14 },
  ],
};
