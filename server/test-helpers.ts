/**
 * Test fixtures: an app on an in-memory database with the outbox email adapter and a fake
 * push transport (no test ever reaches a real email or push service), plus sign-in helpers.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { Secret, TOTP } from 'otpauth';
import webpush from 'web-push';
import type { StaffRole } from '../src/shared/permissions';
import { buildApp, createServices } from './app';
import { loadConfig } from './config';
import { hashPassword } from './crypto';
import { createPgliteDb, type Db } from './db';
import { createEmailTransport, OutboxTransport } from './email';
import { migrate } from './migrate';
import { FakePushTransport } from './push/transport';
import type { Services } from './services';
import { clearSettingsCache } from './settings';

export const ORIGIN = 'http://localhost';

let visitor = 0;
/** A different documentation-range address per call, so per-IP rate limits don't mix up separate simulated visitors. */
export const nextVisitor = () => `198.51.100.${(visitor++ % 250) + 1}`;
export const VAPID = webpush.generateVAPIDKeys();

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  services: Services;
  outbox: OutboxTransport;
  push: FakePushTransport;
  /** Every log line the app wrote (set LOG_LEVEL in `env` to capture more than errors). */
  logs: string[];
  close: () => Promise<void>;
};

/**
 * `directoryFetch`: the RCCG directory API the app talks to when DIRECTORY_API_ENV/KEY are set in
 * `env` (a fake: server/directory/test-api.ts). Tests never reach the real provider.
 */
export async function createTestContext(env: Record<string, string> = {}, options: { directoryFetch?: typeof fetch } = {}): Promise<TestContext> {
  const staticDir = await mkdtemp(join(tmpdir(), 'sop-static-'));
  await mkdir(join(staticDir, 'assets'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>SOP</title><div id="root"></div>');
  const db = await createPgliteDb('memory://');
  await migrate(db);
  // Settings are cached for a few seconds per process: a new database mustn't see the last test's.
  clearSettingsCache();
  const config = loadConfig({
    NODE_ENV: 'test',
    STATIC_DIR: staticDir,
    APP_SECRET: 'test-secret-that-is-long-enough-for-hkdf-0123456789',
    RATE_LIMIT_SUBMIT_MAX: '1000',
    VAPID_PUBLIC_KEY: VAPID.publicKey,
    VAPID_PRIVATE_KEY: VAPID.privateKey,
    VAPID_SUBJECT: 'mailto:tests@example.org',
    STAFF_MFA_REQUIRED: 'true',
    LOG_LEVEL: 'error',
    ...env,
  });
  const outbox = new OutboxTransport();
  const push = new FakePushTransport();
  // EMAIL_TRANSPORT=none tests the "email not configured" behaviour; otherwise the outbox.
  const email = env.EMAIL_TRANSPORT === 'none' ? createEmailTransport(config) : outbox;
  const services = createServices(config, db, {
    email,
    pushTransport: push,
    // Never the network: a test that configures the API passes its fake provider.
    directoryFetch: options.directoryFetch ?? (async () => Promise.reject(new TypeError('no directory API in tests'))),
    directorySleep: async () => {},
  });
  const logs: string[] = [];
  const app = await buildApp({ config, db, services, logStream: { write: (line) => void logs.push(line) } });
  return {
    app,
    db,
    services,
    outbox,
    push,
    logs,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

/** Cookie header value from a response's set-cookie. */
export function cookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

export type Session = { cookie: string; csrf: string };

/** A request as our own page would send it (Origin + cookie + CSRF token). */
export function asUser(app: FastifyInstance, session: Session | null) {
  return (options: InjectOptions) =>
    app.inject({
      ...options,
      headers: {
        origin: ORIGIN,
        ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
        ...(options.headers ?? {}),
      },
    });
}

export const totpCode = (secretBase32: string, offsetSteps = 0) =>
  new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30, algorithm: 'SHA1' }).generate({
    timestamp: Date.now() + offsetSteps * 30_000,
  });

/** An active staff member with a password and (by default) a confirmed TOTP secret. */
export async function createStaff(
  ctx: TestContext,
  input: { role: StaffRole; email?: string; password?: string; mfa?: boolean },
): Promise<{ id: string; email: string; password: string; totpSecret: string | null }> {
  const email = input.email ?? `${input.role}-${Math.random().toString(36).slice(2, 8)}@example.org`;
  const password = input.password ?? 'correct horse battery staple';
  const secret = input.mfa === false ? null : new Secret({ size: 20 }).base32;
  const { rows } = await ctx.db.query<{ id: string }>(
    `insert into staff_users (email, display_name, role, status, password_hash, mfa_secret_enc, mfa_enabled_at)
     values ($1, $2, $3, 'active', $4, $5, $6) returning id`,
    [email, `Test ${input.role}`, input.role, await hashPassword(password), secret ? ctx.services.secrets.encrypt(secret) : null, secret ? new Date() : null],
  );
  return { id: rows[0]!.id, email, password, totpSecret: secret };
}

/** Password + second factor, as the admin UI does. */
export async function staffSignIn(ctx: TestContext, staff: { email: string; password: string; totpSecret: string | null }): Promise<Session> {
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/admin/login',
    remoteAddress: nextVisitor(),
    headers: { origin: ORIGIN },
    payload: { email: staff.email, password: staff.password },
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const session = { cookie: cookieFrom(login), csrf: login.json().csrfToken as string };
  if (!staff.totpSecret) return session;
  const mfa = await asUser(ctx.app, session)({ method: 'POST', url: '/api/admin/mfa/verify', remoteAddress: nextVisitor(), payload: { code: totpCode(staff.totpSecret) } });
  if (mfa.statusCode !== 200) throw new Error(`mfa failed: ${mfa.statusCode} ${mfa.body}`);
  // Passing the second factor starts a new session.
  return { cookie: cookieFrom(mfa), csrf: mfa.json().csrfToken as string };
}

/** Applicant sign-in through the emailed link (read from the outbox). */
export async function applicantSignIn(ctx: TestContext, email: string): Promise<Session> {
  const start = await ctx.app.inject({ method: 'POST', url: '/api/account/sign-in', remoteAddress: nextVisitor(), headers: { origin: ORIGIN }, payload: { email } });
  if (start.statusCode !== 202) throw new Error(`sign-in failed: ${start.statusCode} ${start.body}`);
  const link = /token=([A-Za-z0-9_-]+)/.exec(ctx.outbox.latest(email)?.text ?? '')?.[1];
  if (!link) throw new Error('no sign-in link in outbox');
  const verify = await ctx.app.inject({ method: 'POST', url: '/api/account/verify', remoteAddress: nextVisitor(), headers: { origin: ORIGIN }, payload: { token: link } });
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);
  return { cookie: cookieFrom(verify), csrf: verify.json().csrfToken as string };
}

/** A browser-like push subscription for a known push service. */
export function fakeSubscription(host = 'fcm.googleapis.com') {
  const random = Math.random().toString(36).slice(2);
  const ecdh = webpush.generateVAPIDKeys(); // any valid P-256 public key will do for p256dh
  return {
    endpoint: `https://${host}/fcm/send/${random}${random}`,
    expirationTime: null,
    keys: { p256dh: ecdh.publicKey, auth: Buffer.from(random.padEnd(16, 'x').slice(0, 16)).toString('base64url') },
  };
}
