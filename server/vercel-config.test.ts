/**
 * vercel.json serves the website when it is deployed on Vercel (docs/DEPLOYMENT.md "C. Website on
 * Vercel"). These checks keep it in step with what this server sends for the same paths, so the
 * two deployments behave alike: change both together.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheControlFor } from './app';
import { createTestContext, type TestContext } from './test-helpers';

type Route = { src?: string; dest?: string; headers?: Record<string, string>; continue?: boolean; handle?: string };
const { routes } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as { routes: Route[] };

/** Some files of a build (dist/), as Vercel sees them. */
const FILES = new Set([
  '/index.html',
  '/sw.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/build-id.txt',
  '/assets/index-abc123.js',
  '/assets/brand-lockup-a1b2.webp',
  '/icons/icon-192.png',
  '/og-image.jpg',
  '/robots.txt',
  '/favicon.ico',
]);

/** The routes of one phase: before the first `handle`, or after `{ handle: name }` up to the next. */
function phase(name: string | null): Route[] {
  const list: Route[] = [];
  let current: string | null = null;
  for (const route of routes) {
    if (route.handle) current = route.handle;
    else if (current === name) list.push(route);
  }
  return list;
}

const matches = (route: Route, path: string) => new RegExp(route.src!, 'i').test(path);

/**
 * What Vercel makes of vercel.json's routes for a path (Build Output API phases): routes before
 * `filesystem` apply to every request; an existing file is served and the `hit` routes add to it;
 * otherwise the first matching route after `filesystem` rewrites it (to the app shell); anything
 * else is a 404. The middleware answers /api before any of this.
 *
 * Which of two routes setting the same header wins differs between phases (in `hit` the first one
 * does; deployed and checked 2026-09-29), and `hit` routes may be matched against the requested
 * path or the file served. So vercel.json never lets two routes set one header on a path: any
 * route that could apply counts, and a conflict fails the test.
 */
function serve(path: string): { status: number; file?: string; headers: Record<string, string> } {
  const applicable = phase(null).filter((route) => matches(route, path));
  let file = path === '/' ? '/index.html' : path;
  let status = 200;
  if (!FILES.has(file)) {
    const rewrite = phase('filesystem').find((route) => route.dest && matches(route, path));
    if (rewrite?.dest && FILES.has(rewrite.dest)) file = rewrite.dest;
    else status = 404;
  }
  if (status === 200) applicable.push(...phase('hit').filter((route) => matches(route, path) || matches(route, file)));

  const headers: Record<string, string> = {};
  for (const route of applicable) {
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      const key = name.toLowerCase();
      expect(headers[key] ?? value, `two routes set ${key} on ${path}`).toBe(value);
      headers[key] = value;
    }
  }
  return status === 200 ? { status, file, headers } : { status, headers };
}

/** Set per response or per file by the server, not policy. */
const NOT_POLICY = new Set(['content-type', 'content-length', 'date', 'connection', 'etag', 'last-modified', 'accept-ranges', 'cache-control', 'x-robots-tag']);

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.close();
});

describe('vercel.json (website on Vercel)', () => {
  it('sends the same security headers as the server: pages, files and 404s', async () => {
    const policy = Object.entries((await ctx.app.inject('/about')).headers).filter(([key]) => !NOT_POLICY.has(key));
    expect(policy.map(([key]) => key)).toContain('content-security-policy');
    const paths = ['/', '/about', '/admin/applicants', '/assets/index-abc123.js', '/icons/icon-192.png', '/sw.js', '/og-image.jpg', '/missing.png'];
    for (const path of paths) {
      const { headers } = serve(path);
      for (const [key, value] of policy) expect(headers[key], `${key} on ${path}`).toBe(value);
    }
  });

  it('caches each kind of file the way the server does', () => {
    const cases: [path: string, file: string][] = [
      ['/', 'index.html'],
      ['/about', 'index.html'],
      ['/apply/review', 'index.html'],
      ['/admin/applicants/0a1b', 'index.html'],
      ['/assets/typo', 'index.html'], // extension-less: the app shell, even here
      ['/index.html', 'index.html'],
      ['/sw.js', 'sw.js'],
      ['/manifest.webmanifest', 'manifest.webmanifest'],
      ['/offline.html', 'offline.html'],
      ['/build-id.txt', 'build-id.txt'],
      ['/assets/index-abc123.js', 'assets/index-abc123.js'],
      ['/assets/brand-lockup-a1b2.webp', 'assets/brand-lockup-a1b2.webp'],
      ['/icons/icon-192.png', 'icons/icon-192.png'],
      ['/og-image.jpg', 'og-image.jpg'],
      ['/robots.txt', 'robots.txt'],
      ['/favicon.ico', 'favicon.ico'],
    ];
    for (const [path, file] of cases) expect(serve(path).headers['cache-control'], path).toBe(cacheControlFor(join('/srv/dist', file)));
  });

  it("never caches a missing file (a rollback can bring it back), like the server's 404s", async () => {
    for (const path of ['/missing.png', '/assets/missing-abc.js', '/icons/missing.png']) {
      const served = serve(path);
      expect(served.status, path).toBe(404);
      expect(served.headers['cache-control'], path).toBeUndefined();
      expect((await ctx.app.inject(path)).headers['cache-control'], path).toBeUndefined();
    }
  });

  it('hands deep links the app shell, but never API paths', () => {
    for (const path of ['/about', '/apply/review', '/admin', '/admin/applicants/0a1b', '/account/', '/apiary']) {
      expect(serve(path).file, path).toBe('/index.html');
    }
    for (const path of ['/api', '/api/', '/api/health', '/api/admin/login']) {
      expect(serve(path), path).toEqual({ status: 404, headers: {} }); // the middleware's alone
    }
  });

  it('keeps the admin and account areas out of search results, like the server', async () => {
    for (const path of ['/admin', '/admin/applicants', '/account/settings', '/about', '/administrator']) {
      expect(serve(path).headers['x-robots-tag'], path).toBe((await ctx.app.inject(path)).headers['x-robots-tag']);
    }
  });

  it('lets the service worker control the whole site', () => {
    expect(serve('/sw.js').headers['service-worker-allowed']).toBe('/');
  });
});
