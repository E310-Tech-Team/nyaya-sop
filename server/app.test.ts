import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validPayload } from '../src/shared/test-fixtures';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPgliteDb, type Db } from './db';
import { migrate } from './migrate';

const ADMIN_PASSWORD = 'correct horse battery staple';
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

let db: Db;
let app: FastifyInstance;
let staticDir: string;

const configFor = (overrides: Record<string, string> = {}) =>
  loadConfig({ NODE_ENV: 'test', STATIC_DIR: staticDir, ADMIN_PASSWORD, RATE_LIMIT_SUBMIT_MAX: '1000', ...overrides });

const submit = (body: unknown, target: FastifyInstance = app) =>
  target.inject({ method: 'POST', url: '/api/applications', payload: body as object });

beforeAll(async () => {
  staticDir = await mkdtemp(join(tmpdir(), 'sop-static-'));
  await mkdir(join(staticDir, 'assets'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>SOP</title><div id="root"></div>');
  await writeFile(join(staticDir, 'assets', 'index-abc123.js'), 'console.log("app")');
  await writeFile(join(staticDir, 'robots.txt'), 'User-agent: *');

  db = await createPgliteDb('memory://');
  await migrate(db);
  app = await buildApp({ config: configFor(), db });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`delete from applications; update cohorts set is_accepting_applications = true;`);
});

describe('migrations', () => {
  it('are idempotent', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/cohorts/current', () => {
  it('returns the seeded, open cohort', async () => {
    const res = await app.inject('/api/cohorts/current');
    expect(res.json()).toEqual({
      cohort: {
        slug: 'called-generation-1',
        name: 'The Called Generation',
        edition: 1,
        isAcceptingApplications: true,
        applicationsCloseAt: null,
      },
    });
  });

  it('reports a closed cohort', async () => {
    await db.exec('update cohorts set is_accepting_applications = false');
    const res = await app.inject('/api/cohorts/current');
    expect(res.json().cohort.isAcceptingApplications).toBe(false);
  });
});

describe('POST /api/applications', () => {
  it('stores a valid application in normalised form', async () => {
    const res = await submit({ ...validPayload(), meta: { utmSource: 'whatsapp' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.reference).toMatch(/^SOP-[0-9A-F]{8}$/);
    expect(new Date(body.submittedAt).toString()).not.toBe('Invalid Date');

    const { rows } = await db.query('select * from applications where id = $1', [body.id]);
    expect(rows[0]).toMatchObject({
      full_name: 'Adaeze Okafor',
      email: 'ada.okafor@example.com',
      phone_e164: '+2348012345678',
      parish_name: null,
      status: 'submitted',
      consent_version: '2026-09-v1',
      submission_meta: { utmSource: 'whatsapp' },
    });
  });

  it('rejects a second application from the same email (any casing)', async () => {
    expect((await submit(validPayload())).statusCode).toBe(201);
    const res = await submit(validPayload({ email: 'ADA.OKAFOR@example.com', fullName: 'Someone Else' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ALREADY_APPLIED');
  });

  it('returns field errors for invalid answers', async () => {
    const res = await submit(validPayload({ email: 'nope', phone: '12', purposeClarity: 9 }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(Object.keys(res.json().fieldErrors).sort()).toEqual(['email', 'phone', 'purposeClarity']);
  });

  it('rejects malformed JSON and non-JSON bodies', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { 'content-type': 'application/json' },
      payload: '{"fullName":',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('BAD_REQUEST');

    // Fastify parses text/plain natively; a bare string simply fails validation.
    const text = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(text.statusCode).toBe(400);
    expect(text.json().code).toBe('VALIDATION_FAILED');

    const xml = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { 'content-type': 'application/xml' },
      payload: '<application/>',
    });
    expect(xml.statusCode).toBe(415);
    expect(xml.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('refuses submissions while the cohort is closed', async () => {
    await db.exec('update cohorts set is_accepting_applications = false');
    const res = await submit(validPayload());
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('APPLICATIONS_CLOSED');
  });

  it('rejects an unknown consent version', async () => {
    const res = await submit(validPayload({ consentVersion: '1999-01-v0' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors).toHaveProperty('consentVersion');
  });

  it('pretends to accept honeypot submissions but stores nothing', async () => {
    const res = await submit(validPayload({ website: 'https://spam.example' }));
    expect(res.statusCode).toBe(201);
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from applications');
    expect(rows[0]?.n).toBe(0);
  });

  it('behind a trusted proxy, limits each visitor separately (not the proxy as a whole)', async () => {
    const proxied = await buildApp({
      config: configFor({ RATE_LIMIT_SUBMIT_MAX: '1', TRUST_PROXY: 'loopback,uniquelocal' }),
      db,
    });
    const fromVisitor = (ip: string, email: string) =>
      proxied.inject({
        method: 'POST',
        url: '/api/applications',
        remoteAddress: '172.18.0.3', // the reverse proxy's container address
        headers: { 'x-forwarded-for': ip },
        payload: validPayload({ email }),
      });
    try {
      expect((await fromVisitor('203.0.113.10', 'a@example.com')).statusCode).toBe(201);
      expect((await fromVisitor('203.0.113.10', 'b@example.com')).statusCode).toBe(429);
      expect((await fromVisitor('198.51.100.7', 'c@example.com')).statusCode).toBe(201);
    } finally {
      await proxied.close();
    }
  });

  it('rate-limits repeated submissions from one address', async () => {
    const limited = await buildApp({ config: configFor({ RATE_LIMIT_SUBMIT_MAX: '2' }), db });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await submit(validPayload({ email: `p${i}@example.com` }), limited)).statusCode);
      expect(statuses).toEqual([201, 201, 429]);
      const res = await submit(validPayload({ email: 'p9@example.com' }), limited);
      expect(res.json().code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBeDefined();
    } finally {
      await limited.close();
    }
  });
});

describe('GET /api/admin/applications.csv (retired Basic-auth export)', () => {
  it('no longer accepts Basic auth: it needs a signed-in staff session with export permission', async () => {
    const res = await app.inject({ url: '/api/admin/applications.csv', headers: { authorization: basic('admin', ADMIN_PASSWORD) } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

describe('website', () => {
  it('serves the app shell for client-side routes', async () => {
    const res = await app.inject('/apply/review');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<div id="root">');
  });

  it('caches fingerprinted assets forever and 404s missing ones', async () => {
    const res = await app.inject('/assets/index-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject('/assets/index-old999.js')).statusCode).toBe(404);
  });

  it('sends security headers', async () => {
    const res = await app.inject('/');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000');
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await app.inject('/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
