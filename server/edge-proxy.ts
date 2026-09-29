/**
 * Website on Vercel, API here (docs/DEPLOYMENT.md "C. Website on Vercel"). API requests then
 * arrive through Vercel and Caddy, so X-Forwarded-For names a Vercel address and every visitor
 * would share one rate limit. Vercel's middleware (middleware.ts) sends the visitor's address
 * with a shared secret. With the right secret, that address replaces the forwarded chain, so
 * request.ip (rate limits, request logs) is the visitor again, and the request is marked so the
 * API leaves the release id to the edge (server/app.ts). Either way both headers are removed:
 * nobody can choose their own address by sending them.
 *
 * It runs from Fastify's rewriteUrl option: the one hook that sees a request before Fastify logs
 * it and works out its address (onRequest hooks only run after the request has been logged).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { EDGE_CLIENT_IP_HEADER, EDGE_PROXY_SECRET_HEADER } from '../src/shared/edge-proxy';

const viaEdge = new WeakSet<IncomingMessage>();
const digest = (value: string) => createHash('sha256').update(value).digest();

export function edgeProxyCheck(secret: string | null): (req: IncomingMessage, log: FastifyBaseLogger) => void {
  const expected = secret ? digest(secret) : null;
  const warned = new Set<string>();
  const warnOnce = (log: FastifyBaseLogger, message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    log.warn(message);
  };

  return (req, log) => {
    const sent = req.headers[EDGE_PROXY_SECRET_HEADER];
    const visitor = req.headers[EDGE_CLIENT_IP_HEADER];
    delete req.headers[EDGE_PROXY_SECRET_HEADER];
    delete req.headers[EDGE_CLIENT_IP_HEADER];
    if (sent === undefined) return;
    if (!expected) {
      warnOnce(log, 'A request came with an edge proxy secret, but EDGE_PROXY_SECRET is not set: if the website is on Vercel, set it (docs/DEPLOYMENT.md), or every visitor shares one rate limit');
      return;
    }
    if (typeof sent !== 'string' || !timingSafeEqual(digest(sent), expected)) {
      warnOnce(log, "A request's edge proxy secret did not match EDGE_PROXY_SECRET, so its visitor address was ignored: check the value set in Vercel");
      return;
    }
    viaEdge.add(req);
    const address = typeof visitor === 'string' ? visitor.trim() : '';
    if (isIP(address)) req.headers['x-forwarded-for'] = address;
  };
}

/** The request came through the website's edge proxy (its secret matched). */
export const cameViaEdgeProxy = (request: FastifyRequest) => viaEdge.has(request.raw);
