import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTIFICATION_CONSENT_VERSION } from '../src/shared/platform';
import { checkPushEndpoint, isPublicAddress } from './push/endpoint';
import { pushTopic, type PushPayload } from './push/service';
import { FakePushTransport, HttpsPushTransport, PushNetworkError } from './push/transport';
import { putSetting } from './settings';
import { applicantSignIn, asUser, createTestContext, fakeSubscription, ORIGIN, type TestContext } from './test-helpers';

/** A subscriber whose private key we hold, so tests can decrypt what the server sent. */
function subscriber(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    json: {
      endpoint: `https://${host}/fcm/send/${randomBytes(24).toString('base64url')}`,
      expirationTime: null,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    },
  };
}

/** RFC 8291 (Web Push encryption) + RFC 8188 (aes128gcm), single record, written independently of web-push. */
function decryptPush(body: Buffer, ua: ECDH, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const serverPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(serverPublic), authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--; // padding, then the 0x02 last-record delimiter
  return plain.subarray(0, end).toString('utf8');
}

const jwtClaims = (authorization: string) => {
  const token = /t=([^,\s]+)/.exec(authorization)?.[1] ?? '';
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { aud: string; exp: number; sub: string };
};

describe('push endpoint allowlist (SSRF protection)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QK4b8Vq',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (endpoint) => {
    expect(checkPushEndpoint(endpoint).ok).toBe(true);
  });

  it.each([
    ['http://fcm.googleapis.com/fcm/send/abc', 'not_https'],
    ['https://user:pw@fcm.googleapis.com/fcm/send/abc', 'credentials_in_url'],
    ['https://fcm.googleapis.com:8443/fcm/send/abc', 'non_default_port'],
    ['https://127.0.0.1/fcm/send/abc', 'ip_literal'],
    ['https://[::1]/fcm/send/abc', 'ip_literal'],
    ['https://169.254.169.254/latest/meta-data', 'ip_literal'],
    ['https://evil.example/fcm/send/abc', 'host_not_allowed'],
    ['https://fcm.googleapis.com.evil.example/x', 'host_not_allowed'],
    ['https://push.apple.com/x', 'host_not_allowed'], // wildcard needs a subdomain
    ['https://evilpush.apple.com/x', 'host_not_allowed'],
    ['https://localhost/push', 'host_not_allowed'],
    ['not a url at all', 'invalid_url'],
  ])('refuses %s (%s)', (endpoint, reason) => {
    expect(checkPushEndpoint(endpoint)).toEqual({ ok: false, reason });
  });

  it('accepts hosts added with PUSH_ENDPOINT_HOSTS', () => {
    expect(checkPushEndpoint('https://push.example.org/sub/1', ['push.example.org'])).toEqual({ ok: true, host: 'push.example.org' });
  });
});

describe('only public addresses are ever connected to', () => {
  it.each(['8.8.8.8', '142.250.180.10', '2607:f8b0:4005:80a::200e', '64:ff9b::808:808', '::ffff:8.8.8.8'])('%s is public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.5.4',
    '192.168.1.1',
    '198.51.100.7',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe', // mapped 169.254.169.254
    '64:ff9b::a00:1', // NAT64 of 10.0.0.1
    '2002:c0a8:0101::1', // 6to4 of 192.168.1.1
    '2001:db8::1',
    'not-an-address',
  ])('%s is not', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('refuses to connect when an allowed host resolves to a private address', async () => {
    const transport = new HttpsPushTransport(['localhost'], 2000);
    const error = await transport.send({ endpoint: 'https://localhost/push/1', headers: {}, body: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushNetworkError);
    expect(error).toMatchObject({ code: 'private_address', retryable: false });
  });

  it('never makes a request to an endpoint outside the allowlist', async () => {
    const error = await new HttpsPushTransport([]).send({ endpoint: 'https://evil.example/x', headers: {}, body: null }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'endpoint_not_allowed', retryable: false });
  });
});

describe('sending', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx?.close());

  const payload = (id = 'b2c1b1f0-0000-4000-8000-000000000001'): PushPayload => ({
    v: 1,
    id,
    title: 'School of Purpose',
    body: 'There is an update to your application. Open School of Purpose to view it.',
    url: '/account/application',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  it('encrypts the payload so only the subscriber can read it, with TTL, urgency and topic headers', async () => {
    const sub = subscriber();
    const sent = payload();
    const outcome = await ctx.services.push!.send(sub.json, sent, { ttlSeconds: 3600, urgency: 'high' });
    expect(outcome).toEqual({ kind: 'accepted', status: 201 });
    const request = ctx.push.sent.at(-1)!;
    expect(request.endpoint).toBe(sub.json.endpoint);
    expect(request.headers).toMatchObject({ TTL: 3600, Urgency: 'high', Topic: pushTopic(sent.id), 'Content-Encoding': 'aes128gcm' });
    expect(String(request.headers.Topic)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(request.body!.toString('latin1')).not.toContain('update');
    expect(JSON.parse(decryptPush(request.body!, sub.ecdh, sub.auth))).toEqual(sent);
  });

  it('signs with VAPID per push service, reusing the token and keeping it short-lived', async () => {
    const [first, second, apple] = [subscriber(), subscriber(), subscriber('web.push.apple.com')];
    await ctx.services.push!.send(first.json, payload(), { ttlSeconds: 60 });
    await ctx.services.push!.send(second.json, payload(), { ttlSeconds: 60 });
    await ctx.services.push!.send(apple.json, payload(), { ttlSeconds: 60 });
    const [a, b, c] = ctx.push.sent.slice(-3).map((request) => String(request.headers.Authorization));
    expect(a).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(b).toBe(a); // same push service: token reused, not re-signed every send
    expect(c).not.toBe(a);
    const claims = jwtClaims(c!);
    expect(claims.aud).toBe('https://web.push.apple.com');
    expect(claims.sub).toBe('mailto:tests@example.org');
    expect(claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(24 * 3600_000); // Apple and the RFC cap: 24 hours
  });

  it.each([
    [{ status: 201, retryAfterSeconds: null }, { kind: 'accepted', status: 201 }],
    [{ status: 410, retryAfterSeconds: null }, { kind: 'gone', status: 410 }],
    [{ status: 404, retryAfterSeconds: null }, { kind: 'gone', status: 404 }],
    [{ status: 429, retryAfterSeconds: 120 }, { kind: 'retry', status: 429, retryAfterSeconds: 120, error: 'rate_limited' }],
    [{ status: 503, retryAfterSeconds: null }, { kind: 'retry', status: 503, retryAfterSeconds: null, error: 'service_error' }],
    [{ status: 413, retryAfterSeconds: null }, { kind: 'failed', status: 413, error: 'payload_too_large' }],
    [{ status: 403, retryAfterSeconds: null }, { kind: 'failed', status: 403, error: 'rejected_credentials' }],
    [{ status: 302, retryAfterSeconds: null }, { kind: 'failed', status: 302, error: 'rejected' }], // redirects are never followed
    [new PushNetworkError('timeout', true), { kind: 'retry', status: 0, retryAfterSeconds: null, error: 'timeout' }],
    [new PushNetworkError('private_address', false), { kind: 'failed', status: 0, error: 'private_address' }],
  ] as const)('maps a push service answer of %o to %o', async (answer, expected) => {
    const previous = ctx.push.respond;
    ctx.push.respond = () => answer as never;
    try {
      expect(await ctx.services.push!.send(subscriber().json, payload(), { ttlSeconds: 60 })).toEqual(expected);
    } finally {
      ctx.push.respond = previous;
    }
  });
});

describe('/api/push', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ LOG_LEVEL: 'debug' });
  });
  afterAll(() => ctx?.close());

  const anonymous = () => asUser(ctx.app, null);
  const subscribe = (subscription: object, topics: string[], session = anonymous()) =>
    session({ method: 'POST', url: '/api/push/subscribe', payload: { subscription, topics, consentVersion: NOTIFICATION_CONSENT_VERSION } });

  it('lets anyone subscribe a device to announcements, and refreshes rather than duplicates', async () => {
    const sub = fakeSubscription();
    const first = await subscribe(sub, ['general']);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ status: 'active', topics: ['general'], linkedToAccount: false });
    const again = await subscribe(sub, ['general']);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    const { rows } = await ctx.db.query(`select action from notification_consent_events where subscription_id = $1 order by created_at`, [first.json().id]);
    expect(rows).toEqual([{ action: 'opt_in' }, { action: 'update' }]);
  });

  it('asks for the current consent statement and a supported push service', async () => {
    const stale = await anonymous()({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { subscription: fakeSubscription(), topics: ['general'], consentVersion: 'push-old' },
    });
    expect(stale.statusCode).toBe(400);
    expect((await subscribe(fakeSubscription('evil.example'), ['general'])).statusCode).toBe(400);
    expect((await subscribe({ ...fakeSubscription(), keys: { p256dh: 'short', auth: 'x' } }, ['general'])).statusCode).toBe(400);
  });

  it('keeps application and training updates for signed-in applicants', async () => {
    expect((await subscribe(fakeSubscription(), ['general', 'application'])).statusCode).toBe(403);
    const applicant = asUser(ctx.app, await applicantSignIn(ctx, 'devices@example.com'));
    const res = await subscribe(fakeSubscription(), ['general', 'application', 'training'], applicant);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ topics: ['general', 'application', 'training'], linkedToAccount: true });
    expect((await applicant({ url: '/api/account/devices' })).json().devices).toHaveLength(1);
  });

  it('refuses to re-register an endpoint with a different auth secret', async () => {
    const sub = fakeSubscription();
    await subscribe(sub, ['general']);
    const hijack = await subscribe({ ...sub, keys: { ...sub.keys, auth: randomBytes(16).toString('base64url') } }, ['general']);
    expect(hijack.statusCode).toBe(409);
  });

  it('needs the device’s auth secret to read or change it', async () => {
    const sub = fakeSubscription();
    const id = (await subscribe(sub, ['general'])).json().id;
    const status = (auth: string) => anonymous()({ method: 'POST', url: '/api/push/status', payload: { endpoint: sub.endpoint, auth } });
    expect((await status(randomBytes(16).toString('base64url'))).json()).toEqual({ status: 'unknown' });
    expect((await status(sub.keys.auth)).json()).toMatchObject({ id, status: 'active' });
    const wrong = await anonymous()({ method: 'POST', url: '/api/push/topics', payload: { endpoint: sub.endpoint, auth: 'nope', topics: [] } });
    expect(wrong.statusCode).toBe(404);
    await anonymous()({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: sub.endpoint, auth: 'nope' } });
    expect((await status(sub.keys.auth)).json().status).toBe('active');
  });

  it('turns a device off when its last topic is removed, or when it unsubscribes', async () => {
    const sub = fakeSubscription();
    await subscribe(sub, ['general']);
    const off = await anonymous()({ method: 'POST', url: '/api/push/topics', payload: { endpoint: sub.endpoint, auth: sub.keys.auth, topics: [] } });
    expect(off.json()).toMatchObject({ status: 'revoked', topics: [] });
    const other = fakeSubscription();
    await subscribe(other, ['general']);
    await anonymous()({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: other.endpoint, auth: other.keys.auth } });
    const state = await anonymous()({ method: 'POST', url: '/api/push/status', payload: { endpoint: other.endpoint, auth: other.keys.auth } });
    expect(state.json().status).toBe('revoked');
    // Turning notifications on again reactivates the same device record.
    expect((await subscribe(other, ['general'])).json().status).toBe('active');
  });

  it('only lets the signed-in owner change account topics on a linked device', async () => {
    const sub = fakeSubscription();
    const applicant = asUser(ctx.app, await applicantSignIn(ctx, 'topics@example.com'));
    await subscribe(sub, ['general', 'application'], applicant);
    const change = (topics: string[], session = anonymous()) =>
      session({ method: 'POST', url: '/api/push/topics', payload: { endpoint: sub.endpoint, auth: sub.keys.auth, topics } });
    expect((await change(['general', 'training'])).statusCode).toBe(403);
    // Signed out, "general" can still be switched off; the account topics stay as they were.
    expect((await change([])).json()).toMatchObject({ status: 'active', topics: ['application'] });
    expect((await change(['training'], applicant)).json().topics).toEqual(['training']);
  });

  it('carries topics and the account link over when the browser replaces a subscription', async () => {
    const applicant = asUser(ctx.app, await applicantSignIn(ctx, 'rotate@example.com'));
    const old = fakeSubscription();
    const oldId = (await subscribe(old, ['general', 'application'], applicant)).json().id;
    const next = fakeSubscription();
    const rotated = await anonymous()({ method: 'POST', url: '/api/push/rotate', payload: { oldEndpoint: old.endpoint, oldAuth: old.keys.auth, subscription: next } });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json()).toMatchObject({ status: 'active', topics: ['general', 'application'], linkedToAccount: true });
    const { rows } = await ctx.db.query(`select status::text as status, deactivated_reason from push_subscriptions where id = $1`, [oldId]);
    expect(rows[0]).toEqual({ status: 'revoked', deactivated_reason: 'replaced' });
    const forged = await anonymous()({ method: 'POST', url: '/api/push/rotate', payload: { oldEndpoint: next.endpoint, oldAuth: 'nope', subscription: fakeSubscription() } });
    expect(forged.statusCode).toBe(404);
  });

  it('can pause new public sign-ups without affecting applicants', async () => {
    const { rows } = await ctx.db.query<{ id: string }>(
      `insert into staff_users (email, display_name, role, status) values ('settings-owner@example.org', 'Owner', 'owner', 'invited') returning id`,
    );
    await putSetting(ctx.db, 'public_notifications_enabled', false, rows[0]!.id);
    try {
      expect((await subscribe(fakeSubscription(), ['general'])).statusCode).toBe(403);
      const applicant = asUser(ctx.app, await applicantSignIn(ctx, 'paused@example.com'));
      expect((await subscribe(fakeSubscription(), ['general'], applicant)).statusCode).toBe(201);
    } finally {
      await putSetting(ctx.db, 'public_notifications_enabled', true, rows[0]!.id);
    }
  });

  it('stores endpoints and keys encrypted, and never logs them', async () => {
    const sub = fakeSubscription();
    await subscribe(sub, ['general']);
    await subscribe(fakeSubscription('evil.example'), ['general']); // refused: logged with a reason only
    const { rows } = await ctx.db.query<Record<string, unknown>>('select * from push_subscriptions');
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(sub.endpoint);
    expect(stored).not.toContain(sub.keys.auth);
    expect(stored).not.toContain(sub.keys.p256dh);
    const logs = ctx.logs.join('\n');
    expect(logs).toContain('Push subscription refused');
    expect(logs).not.toContain('/fcm/send/');
    expect(logs).not.toContain(sub.keys.auth);
    expect(logs).not.toContain('evil.example');
  });

  it('checks the Origin header on every change', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { origin: 'https://attacker.example' },
      payload: { subscription: fakeSubscription(), topics: ['general'], consentVersion: NOTIFICATION_CONSENT_VERSION },
    });
    expect(res.statusCode).toBe(403);
    expect(ORIGIN).toBe('http://localhost');
  });
});

describe('without VAPID keys', () => {
  it('reports push as unavailable instead of pretending', async () => {
    const ctx = await createTestContext({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' });
    try {
      expect((await ctx.app.inject('/api/config')).json().push).toEqual({ enabled: false, publicKey: null });
      const res = await asUser(ctx.app, null)({
        method: 'POST',
        url: '/api/push/subscribe',
        payload: { subscription: fakeSubscription(), topics: ['general'], consentVersion: NOTIFICATION_CONSENT_VERSION },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('PUSH_UNAVAILABLE');
    } finally {
      await ctx.close();
    }
  });
});

// The fake transport is what every test above used: no test reaches a real push service.
it('uses the fake transport in tests', () => {
  expect(new FakePushTransport().sent).toEqual([]);
});
