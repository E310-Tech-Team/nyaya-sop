/**
 * Vercel Routing Middleware. It runs only when the website is deployed on Vercel (vercel.json,
 * docs/DEPLOYMENT.md "C. Website on Vercel"); the VPS never loads this file. It forwards /api/*
 * to the VPS that runs the API, database and worker (API_ORIGIN), so the browser still talks to
 * one origin: sign-in cookies stay first-party and the server's Origin checks (SITE_URL) hold.
 *
 * - The visitor's address goes along in x-edge-client-ip with the shared EDGE_PROXY_SECRET.
 *   Without them the VPS would only see Vercel's addresses and every visitor would share one
 *   rate limit. Whatever a visitor sends in these headers is replaced.
 * - The response carries this deployment's release id (x-app-build), which an open page compares
 *   with its own to offer an update (src/lib/pwa.ts). The VPS leaves its own out of requests
 *   that come through here.
 * - Until both settings are present, /api answers 503 with the API's usual error body.
 */
import { ipAddress } from '@vercel/functions/headers';
import { rewrite } from '@vercel/functions/middleware';
import type { ApiErrorBody } from './src/shared/application';
// Vercel compiles this file and its imports one by one and runs them as Node ES modules, which
// need the file extension (Vite and Vitest would resolve it either way).
import { EDGE_CLIENT_IP_HEADER, EDGE_PROXY_SECRET_HEADER, releaseId } from './src/shared/edge-proxy.js';

export const config = { matcher: '/api/:path*', runtime: 'nodejs' };

export type EdgeEnv = {
  API_ORIGIN?: string;
  EDGE_PROXY_SECRET?: string;
  BUILD_ID?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

/** The VPS's address: https://host[:port] and nothing more, or null. */
export function apiOrigin(raw: string | undefined): string | null {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.origin === value) return url.origin;
  } catch {
    // reported below
  }
  console.error('API_ORIGIN must be an https:// origin with no path, such as https://api.example.org');
  return null;
}

const unavailable = () =>
  Response.json(
    { code: 'SERVICE_UNAVAILABLE', message: 'This service is temporarily unavailable. Please try again later.' } satisfies ApiErrorBody,
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );

export function forwardToApi(request: Request, env: EdgeEnv): Response {
  const origin = apiOrigin(env.API_ORIGIN);
  const secret = env.EDGE_PROXY_SECRET?.trim();
  if (!origin || !secret) return unavailable();

  const { pathname, search } = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete('host'); // the VPS's own host name goes upstream (Caddy picks its site by it)
  headers.set(EDGE_PROXY_SECRET_HEADER, secret);
  const visitor = ipAddress(request);
  if (visitor) headers.set(EDGE_CLIENT_IP_HEADER, visitor);
  else headers.delete(EDGE_CLIENT_IP_HEADER);

  const build = releaseId(env);
  return rewrite(new URL(`${pathname}${search}`, origin), {
    request: { headers },
    headers: build ? { 'x-app-build': build } : {},
  });
}

export default function middleware(request: Request): Response {
  return forwardToApi(request, process.env);
}
