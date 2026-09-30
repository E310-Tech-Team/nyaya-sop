import { describe, expect, it } from 'vitest';
import { createDirectoryApi, DIRECTORY_API_BASES, DirectoryApiError } from './api';
import { BASE_RELEASE, fakeDirectoryApi, SECOND_RELEASE } from './test-api';

const KEY = 'fake-api-key-0123456789abcdef-SECRET';

function setup(options: { env?: 'production' | 'sandbox' } = {}) {
  const fake = fakeDirectoryApi({ key: KEY, env: options.env, releases: [BASE_RELEASE, SECOND_RELEASE] });
  const waits: number[] = [];
  const api = createDirectoryApi({ env: options.env ?? 'sandbox', key: KEY, fetch: fake.fetch, sleep: async (ms) => void waits.push(ms) });
  return { fake, api, waits };
}

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as DirectoryApiError;
  }
  throw new Error('expected a failure');
};

describe('the RCCG directory API client', () => {
  it('sends the key only as a bearer header, to the fixed address of the configured environment', async () => {
    for (const env of ['sandbox', 'production'] as const) {
      const { api, fake } = setup({ env });
      await api.latestRelease();
      expect(fake.seen).toEqual([{ url: `${DIRECTORY_API_BASES[env]}/releases/latest`, authorization: `Bearer ${KEY}` }]);
      expect(fake.seen[0]!.url).not.toContain(KEY);
      expect(api.namespace).toBe(`rccg-org:${env}`);
    }
    expect(DIRECTORY_API_BASES).toEqual({
      production: 'https://directory-api.rccgyaya.org/api/v1/org',
      sandbox: 'https://rccg-parish-api-staging.rccgyaya.org/api/v1/org',
    });
  });

  it('reads the latest release, and null when none is published', async () => {
    const { api, fake } = setup();
    expect(await api.latestRelease()).toMatchObject({ versionCode: 'SANDBOX.2', name: 'Sandbox changes', effectiveFrom: '2026-09-20T23:00:00Z' });
    fake.latest = null;
    expect(await api.latestRelease()).toBeNull();
  });

  it('pages through a release’s changes with their counts', async () => {
    const { api, fake } = setup();
    const first = await api.releaseChanges('SANDBOX.1', 1, 10);
    const second = await api.releaseChanges('SANDBOX.1', 2, 10);
    expect(first).toMatchObject({ versionCode: 'SANDBOX.1', baseVersionCode: null, total: 19, hasMore: true, counts: { created: 19, moved: 0, renamed: 0, retired: 0 } });
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(9);
    expect(second.hasMore).toBe(false);
    expect(fake.calls).toEqual(['/releases/SANDBOX.1/changes?page=1&per_page=10', '/releases/SANDBOX.1/changes?page=2&per_page=10']);
  });

  it('searches parishes with their ancestry and follows the provider’s cursor', async () => {
    const { api } = setup();
    const first = await api.searchParishes('JESUS', { perPage: 2 });
    expect(first.parishes).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.parishes[0]!.ancestry.map((unit) => unit.level)).toEqual(['continent', 'region', 'province']);
    const second = await api.searchParishes('JESUS', { perPage: 2, cursor: first.nextCursor! });
    expect(second.parishes.map((parish) => parish.code)).not.toContain(first.parishes[0]!.code);
  });

  it('looks a parish up by its canonical code, and answers null when the release doesn’t have it', async () => {
    const { api } = setup();
    expect(await api.parishByCode('SANDBOX-1004')).toMatchObject({ code: 'SANDBOX-1004', name: 'GRACE CHAPEL' });
    expect(await api.parishByCode('SANDBOX-1001')).toBeNull(); // retired in SANDBOX.2
    expect(await api.parishByCode('SANDBOX-9999')).toBeNull();
  });

  it('refuses codes and versions outside the contract’s patterns without calling the provider', async () => {
    const { api, fake } = setup();
    expect((await failure(() => api.parishByCode('../releases/latest'))).kind).toBe('invalid_response');
    expect((await failure(() => api.releaseChanges('1 OR 1', 1))).kind).toBe('invalid_response');
    expect(fake.calls).toEqual([]);
  });

  it('retries rate limits and server errors within bounds, waiting as the provider asks', async () => {
    const { api, fake, waits } = setup();
    fake.failures.push({ status: 429, retryAfter: '3' }, { status: 503 });
    expect(await api.latestRelease()).toMatchObject({ versionCode: 'SANDBOX.2' });
    expect(fake.calls).toHaveLength(3);
    expect(waits[0]).toBe(3000);
    expect(waits[1]).toBeGreaterThanOrEqual(1000);

    fake.failures.push(...Array.from({ length: 4 }, () => ({ status: 500 })));
    expect(await failure(() => api.latestRelease())).toMatchObject({ kind: 'unavailable', status: 500 });
  });

  it('never keeps a person waiting on a long Retry-After, and tries a search at most twice', async () => {
    const { api, fake, waits } = setup();
    fake.failures.push({ status: 429, retryAfter: '30' });
    expect(await failure(() => api.searchParishes('GRACE'))).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 30_000 });
    expect(waits).toEqual([]);
    fake.failures.push({ network: 'timeout' }, { network: 'timeout' }, { network: 'timeout' });
    expect((await failure(() => api.searchParishes('GRACE'))).kind).toBe('timeout');
    expect(fake.calls.filter((call) => call.startsWith('/parishes'))).toHaveLength(3); // 1 + 2 attempts
  });

  it('never retries a refused key, a request outside its scope or a bad request', async () => {
    const { api, fake } = setup();
    for (const [status, kind] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [422, 'bad_request'],
    ] as const) {
      fake.calls.length = 0;
      fake.failures.push({ status });
      expect((await failure(() => api.latestRelease())).kind).toBe(kind);
      expect(fake.calls).toHaveLength(1);
    }
    const wrongKey = createDirectoryApi({ env: 'sandbox', key: 'another-key-0123456789', fetch: fake.fetch, sleep: async () => {} });
    expect((await failure(() => wrongKey.latestRelease())).kind).toBe('unauthorized');
  });

  it('refuses answers that don’t match the contract', async () => {
    const { api, fake } = setup();
    for (const body of ['not json', JSON.stringify({ success: false, data: null }), JSON.stringify({ success: true, data: { id: 'x', version_code: '2026.1' } })]) {
      fake.failures.push({ malformed: body });
      expect((await failure(() => api.latestRelease())).kind).toBe('invalid_response');
    }
    fake.failures.push({ malformed: JSON.stringify({ success: true, data: [{ id: 'nope', canonical_code: 'X', name: 'Y', level: 'parish', ancestry: [] }], meta: {} }) });
    expect((await failure(() => api.searchParishes('GRACE'))).kind).toBe('invalid_response');
  });

  it('never puts the key in an error', async () => {
    const { api, fake } = setup();
    fake.failures.push({ status: 401 }, { status: 403 }, { network: 'refused' }, { network: 'refused' }, { malformed: '{' });
    const errors = [
      await failure(() => api.latestRelease()),
      await failure(() => api.latestRelease()),
      await failure(() => api.searchParishes('GRACE')),
      await failure(() => api.latestRelease()),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(DirectoryApiError);
      expect(`${error.message} ${JSON.stringify(error)} ${error.stack}`).not.toContain(KEY);
    }
  });
});
