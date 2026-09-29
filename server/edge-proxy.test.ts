import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validPayload } from '../src/shared/test-fixtures';
import { createTestContext, type TestContext } from './test-helpers';

const SECRET = 'edge-proxy-secret-for-tests-0123456789abcdef';
const CADDY = '172.18.0.3'; // the reverse proxy's container address (trusted)

let edge: TestContext;
let plain: TestContext;
let submissions = 0;

/** An application as it reaches the app through Vercel and then Caddy. */
const viaEdge = (ctx: TestContext, headers: Record<string, string>, vercelAddress = '76.76.21.21') =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/applications',
    remoteAddress: CADDY,
    headers: { 'x-forwarded-for': vercelAddress, ...headers },
    payload: validPayload({ email: `edge${submissions++}@example.com` }),
  });

const fromVisitor = (ip: string, secret = SECRET, vercelAddress?: string) =>
  viaEdge(edge, { 'x-edge-proxy-secret': secret, 'x-edge-client-ip': ip }, vercelAddress);

beforeAll(async () => {
  const env = { TRUST_PROXY: 'loopback,uniquelocal', RATE_LIMIT_SUBMIT_MAX: '1', LOG_LEVEL: 'info' };
  edge = await createTestContext({ ...env, EDGE_PROXY_SECRET: SECRET });
  plain = await createTestContext(env);
});

afterAll(async () => {
  await edge?.close();
  await plain?.close();
});

describe('website on Vercel: requests through the edge proxy', () => {
  it('limits each visitor separately when the shared secret matches', async () => {
    expect((await fromVisitor('203.0.113.10')).statusCode).toBe(201);
    expect((await fromVisitor('203.0.113.10')).statusCode).toBe(429);
    expect((await fromVisitor('2001:db8::7')).statusCode).toBe(201);
    // The request log shows the visitor, not Vercel.
    expect(edge.logs.some((line) => line.includes('"remoteAddress":"203.0.113.10"'))).toBe(true);
  });

  it('ignores the address without the right secret: those visitors share the address they came from', async () => {
    const vercelAddress = '76.76.21.98';
    expect((await fromVisitor('203.0.113.20', 'not-the-secret', vercelAddress)).statusCode).toBe(201);
    expect((await fromVisitor('203.0.113.21', 'not-the-secret', vercelAddress)).statusCode).toBe(429);
    expect((await viaEdge(edge, { 'x-edge-client-ip': '203.0.113.22' }, vercelAddress)).statusCode).toBe(429);
    expect(edge.logs.filter((line) => line.includes('did not match EDGE_PROXY_SECRET'))).toHaveLength(1);
  });

  it('leaves the release id to the edge, and still sends it to everyone else', async () => {
    const proxied = await edge.app.inject({
      url: '/api/health',
      remoteAddress: CADDY,
      headers: { 'x-edge-proxy-secret': SECRET, 'x-edge-client-ip': '203.0.113.30' },
    });
    expect(proxied.headers['x-app-build']).toBeUndefined();
    expect((await edge.app.inject('/api/health')).headers['x-app-build']).toBe('dev');
    expect((await edge.app.inject({ url: '/api/health', headers: { 'x-edge-proxy-secret': 'guess' } })).headers['x-app-build']).toBe('dev');
  });

  it('never trusts the headers when no secret is configured, and says why once', async () => {
    const vercelAddress = '76.76.21.99';
    const send = (ip: string) => viaEdge(plain, { 'x-edge-proxy-secret': SECRET, 'x-edge-client-ip': ip }, vercelAddress);
    expect((await send('203.0.113.40')).statusCode).toBe(201);
    expect((await send('203.0.113.41')).statusCode).toBe(429);
    expect(plain.logs.filter((line) => line.includes('EDGE_PROXY_SECRET is not set'))).toHaveLength(1);
  });

  it('never logs the secret', () => {
    expect(edge.logs.length).toBeGreaterThan(0);
    for (const line of [...edge.logs, ...plain.logs]) expect(line).not.toContain(SECRET);
  });
});
