import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware, { apiOrigin, config, forwardToApi } from './middleware';
import { releaseId } from './src/shared/edge-proxy';

const SECRET = 'edge-proxy-secret-for-tests-0123456789abcdef';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const ENV = { API_ORIGIN: 'https://api.example.org', EDGE_PROXY_SECRET: SECRET, VERCEL_GIT_COMMIT_SHA: COMMIT };

/** A request as Vercel hands it to the middleware (x-real-ip is Vercel's own record of the visitor). */
const visit = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://school-of-purpose.vercel.app${path}`, {
    headers: { host: 'school-of-purpose.vercel.app', 'x-real-ip': '203.0.113.9', cookie: '__Host-sop_account=abc', ...headers },
  });

/** What the upstream request will carry (the x-middleware-request-* protocol behind rewrite()). */
const upstreamHeaders = (response: Response) => {
  const names = response.headers.get('x-middleware-override-headers')?.split(',') ?? [];
  return Object.fromEntries(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]));
};

afterEach(() => void vi.restoreAllMocks());

describe('Vercel middleware: /api → the VPS', () => {
  it('runs for the API only, on Node.js', () => {
    expect(config).toEqual({ matcher: '/api/:path*', runtime: 'nodejs' });
  });

  it('forwards the path and query to the API origin', () => {
    const response = forwardToApi(visit('/api/account/notifications?page=2'), ENV);
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://api.example.org/api/account/notifications?page=2');
  });

  it('never sends a request (or the secret) to another host, whatever the path normalises to', () => {
    // Paths that the URL parser turns into "//evil.example/…" (backslashes, encoded dots) or that
    // start with "//" would otherwise resolve as protocol-relative URLs.
    for (const url of [
      'https://school-of-purpose.vercel.app/api/x/..\\..\\\\evil.example/probe',
      'https://school-of-purpose.vercel.app/api/%2e%2e/%2e%2e/\\evil.example/probe',
      'https://school-of-purpose.vercel.app//evil.example/api/x',
      'https://school-of-purpose.vercel.app/apix/health',
    ]) {
      const response = forwardToApi(new Request(url, { headers: { 'x-real-ip': '203.0.113.9' } }), ENV);
      expect({ url, status: response.status, rewrite: response.headers.get('x-middleware-rewrite') }).toEqual({ url, status: 404, rewrite: null });
      expect(upstreamHeaders(response)).not.toHaveProperty('x-edge-proxy-secret');
    }
    // Ordinary API paths, including encoded characters, still go to the API origin.
    expect(forwardToApi(visit('/api/parishes/search?q=jesus%20house'), ENV).headers.get('x-middleware-rewrite')).toBe(
      'https://api.example.org/api/parishes/search?q=jesus%20house',
    );
    expect(forwardToApi(visit('/api'), ENV).headers.get('x-middleware-rewrite')).toBe('https://api.example.org/api');
  });

  it("sends the visitor's address with the shared secret, replacing anything the visitor sent", () => {
    const response = forwardToApi(visit('/api/applications', { 'x-edge-client-ip': '10.0.0.1', 'x-edge-proxy-secret': 'guess' }), ENV);
    const upstream = upstreamHeaders(response);
    expect(upstream['x-edge-proxy-secret']).toBe(SECRET);
    expect(upstream['x-edge-client-ip']).toBe('203.0.113.9');
    expect(upstream.cookie).toBe('__Host-sop_account=abc');
    // Caddy on the VPS picks its site by Host, so the VPS's own name goes upstream.
    expect(upstream).not.toHaveProperty('host');
  });

  it("drops a visitor-supplied address when Vercel didn't record one", () => {
    const request = new Request('https://school-of-purpose.vercel.app/api/health', { headers: { 'x-edge-client-ip': '10.0.0.1' } });
    expect(upstreamHeaders(forwardToApi(request, ENV))).not.toHaveProperty('x-edge-client-ip');
  });

  it("stamps this deployment's release id, the one its pages were built with", () => {
    expect(forwardToApi(visit('/api/health'), ENV).headers.get('x-app-build')).toBe('0123456');
    expect(forwardToApi(visit('/api/health'), { ...ENV, BUILD_ID: 'r42' }).headers.get('x-app-build')).toBe('r42');
    expect(forwardToApi(visit('/api/health'), { ...ENV, VERCEL_GIT_COMMIT_SHA: '' }).headers.has('x-app-build')).toBe(false);
    expect(releaseId({ BUILD_ID: ' r42 ', VERCEL_GIT_COMMIT_SHA: COMMIT })).toBe('r42');
    expect(releaseId({})).toBeNull();
  });

  it('answers 503 in the API error format until the API origin and secret are set', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const env of [{}, { ...ENV, EDGE_PROXY_SECRET: '' }, { ...ENV, API_ORIGIN: 'http://api.example.org' }]) {
      const response = forwardToApi(visit('/api/health'), env);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.has('x-middleware-rewrite')).toBe(false);
      expect(await response.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }
    expect(error).toHaveBeenCalledTimes(1); // only the malformed origin is a mistake worth logging
    // The deployed entry point reads the project's environment (none in tests).
    expect(middleware(visit('/api/health')).status).toBe(503);
  });

  it('imports its own files with their extension: Vercel runs them as Node ES modules, unbundled', () => {
    for (const file of ['middleware.ts', 'src/shared/edge-proxy.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const [, specifier] of source.matchAll(/^import (?!type\b)[^;]*? from '(\.[^']+)'/gm)) expect(specifier, file).toMatch(/\.js$/);
    }
  });

  it('accepts only an https origin with no path', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(apiOrigin(' https://api.example.org/ ')).toBe('https://api.example.org');
    expect(apiOrigin('https://srv123.hstgr.cloud:8443')).toBe('https://srv123.hstgr.cloud:8443');
    for (const bad of ['http://api.example.org', 'https://api.example.org/api', 'api.example.org', 'https://api.example.org?x=1']) {
      expect(apiOrigin(bad), bad).toBeNull();
    }
  });
});
