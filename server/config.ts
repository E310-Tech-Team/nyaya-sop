import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type EmailTransportKind = 'smtp' | 'outbox' | 'none';
export type WorkerMode = 'inline' | 'off';

export type AppConfig = {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  database:
    | { driver: 'postgres'; connectionString?: string; ssl: boolean; poolMax: number }
    | { driver: 'pglite'; dataDir: string };
  /**
   * Which proxies may set X-Forwarded-For (drives request.ip, and so rate limiting):
   * false, true, or addresses/CIDRs/keywords such as "loopback,uniquelocal".
   */
  trustProxy: boolean | string;
  /**
   * Shared with the Vercel project when Vercel serves the website and forwards /api here: requests
   * carrying it may name the visitor's address (server/edge-proxy.ts). Null when not used.
   */
  edgeProxySecret: string | null;
  /** Built SPA (vite build output). Served with an index.html fallback when present. */
  staticDir: string;
  runMigrations: boolean;
  rateLimit: { submitMax: number; submitWindowMs: number };
  logLevel: string;
  /** Public origin, e.g. https://apply.example.org: links in emails, and the only origin allowed to send state-changing requests. */
  siteOrigin: string | null;
  /** Keys for CSRF tokens and at-rest encryption are derived from this (server/crypto.ts). */
  appSecret: string;
  cookieSecure: boolean;
  email: { transport: EmailTransportKind; smtpUrl: string | null; from: string | null };
  push: { publicKey: string | null; privateKey: string | null; subject: string | null; extraHosts: string[] };
  worker: { mode: WorkerMode; pollMs: number };
  auth: {
    /** Staff must set up and use a second factor (on by default in production). */
    staffMfaRequired: boolean;
    staffSessionHours: number;
    staffIdleMinutes: number;
    applicantSessionDays: number;
    applicantIdleDays: number;
  };
  buildId: string;
  /** Non-fatal configuration notes, logged at startup. */
  warnings: string[];
};

export class ConfigError extends Error {}

// server/config.ts in dev, server-dist/index.js when built: both are one level below the repo root.
const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
const DEV_APP_SECRET = 'development-only-app-secret-do-not-use-in-production';

function int(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return value;
}

function bool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new ConfigError(`${name} must be true or false (got "${raw}")`);
}

function trustProxy(raw: string | undefined): AppConfig['trustProxy'] {
  if (raw === undefined || raw.trim() === '' || /^(0|false|no|off)$/i.test(raw)) return false;
  if (/^(true|yes|on)$/i.test(raw)) return true;
  if (/^\d+$/.test(raw.trim())) {
    // Fastify 5 treats a hop count as "trust nothing", which would put every visitor in one rate-limit bucket.
    throw new ConfigError('TRUST_PROXY must list proxy addresses (e.g. "loopback" or "loopback,uniquelocal"), not a hop count');
  }
  return raw.trim(); // e.g. "loopback", "loopback,uniquelocal" or "10.0.0.0/8,127.0.0.1"
}

function siteOrigin(raw: string | undefined, env: AppConfig['env']): string | null {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) {
    if (env === 'production') throw new ConfigError('SITE_URL is required in production (e.g. https://apply.example.org)');
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`SITE_URL must be an origin like https://apply.example.org (got "${raw}")`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== value || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
    throw new ConfigError(`SITE_URL must be an https:// origin with no path (http:// only for localhost); got "${raw}"`);
  }
  return url.origin;
}

// VAPID keys are base64url: a 65-byte uncompressed P-256 public key and a 32-byte private key.
const B64URL = /^[A-Za-z0-9_-]+$/;
const b64urlBytes = (value: string) => Buffer.from(value, 'base64url').length;

function push(env: NodeJS.ProcessEnv): AppConfig['push'] {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || null;
  const subject = env.VAPID_SUBJECT?.trim() || null;
  const extraHosts = (env.PUSH_ENDPOINT_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const host of extraHosts) {
    if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new ConfigError(`PUSH_ENDPOINT_HOSTS: "${host}" is not a host name`);
  }
  if (!publicKey && !privateKey) return { publicKey: null, privateKey: null, subject: null, extraHosts };
  if (!publicKey || !privateKey) throw new ConfigError('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (run "pnpm push:keys"), or neither');
  if (!B64URL.test(publicKey) || b64urlBytes(publicKey) !== 65) throw new ConfigError('VAPID_PUBLIC_KEY is not a base64url P-256 public key');
  if (!B64URL.test(privateKey) || b64urlBytes(privateKey) !== 32) throw new ConfigError('VAPID_PRIVATE_KEY is not a base64url P-256 private key');
  if (!subject || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) {
    throw new ConfigError('VAPID_SUBJECT must be a mailto: address or an https:// URL (push services use it to contact you)');
  }
  return { publicKey, privateKey, subject, extraHosts };
}

function email(env: NodeJS.ProcessEnv, nodeEnv: AppConfig['env']): AppConfig['email'] {
  const smtpUrl = env.SMTP_URL?.trim() || null;
  const from = env.EMAIL_FROM?.trim() || null;
  const requested = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  const transport: EmailTransportKind =
    requested === 'smtp' || requested === 'outbox' || requested === 'none'
      ? requested
      : requested
        ? (() => {
            throw new ConfigError(`EMAIL_TRANSPORT must be smtp, outbox or none (got "${requested}")`);
          })()
        : smtpUrl
          ? 'smtp'
          : nodeEnv === 'production'
            ? 'none'
            : 'outbox';
  if (transport === 'outbox' && nodeEnv === 'production') {
    throw new ConfigError('EMAIL_TRANSPORT=outbox is a local test adapter and cannot be used in production');
  }
  if (transport === 'smtp') {
    if (!smtpUrl || !/^smtps?:\/\//.test(smtpUrl)) throw new ConfigError('SMTP_URL must look like smtps://user:password@smtp.example.org:465');
    if (!from) throw new ConfigError('EMAIL_FROM is required with SMTP (e.g. "School of Purpose <no-reply@apply.example.org>")');
  }
  return { transport, smtpUrl: transport === 'smtp' ? smtpUrl : null, from };
}

function readBuildId(staticDir: string): string {
  try {
    return readFileSync(resolve(staticDir, 'build-id.txt'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const warnings: string[] = [];

  const connectionString = env.DATABASE_URL?.trim() || undefined;
  const usePostgres = Boolean(connectionString || env.PGHOST);
  if (nodeEnv === 'production' && !usePostgres) {
    throw new ConfigError('DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) is required in production');
  }
  if (connectionString && !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new ConfigError('DATABASE_URL must start with postgres:// or postgresql://');
  }

  let appSecret = env.APP_SECRET?.trim() || '';
  if (!appSecret) {
    if (nodeEnv === 'production') throw new ConfigError('APP_SECRET is required in production (generate one with: openssl rand -base64 48)');
    appSecret = DEV_APP_SECRET;
  } else if (appSecret.length < 32) {
    throw new ConfigError('APP_SECRET must be at least 32 characters (generate one with: openssl rand -base64 48)');
  }

  const edgeProxySecret = env.EDGE_PROXY_SECRET?.trim() || null;
  if (edgeProxySecret && edgeProxySecret.length < 32) {
    throw new ConfigError('EDGE_PROXY_SECRET must be at least 32 characters (generate one with: openssl rand -base64 48)');
  }
  if (edgeProxySecret && edgeProxySecret === appSecret) {
    throw new ConfigError('EDGE_PROXY_SECRET must differ from APP_SECRET: it is shared with the Vercel project');
  }
  const proxies = trustProxy(env.TRUST_PROXY);
  if (edgeProxySecret && proxies === false) {
    warnings.push('EDGE_PROXY_SECRET has no effect without TRUST_PROXY: set it to the proxy in front of the app (e.g. loopback,uniquelocal)');
  }

  if (env.ADMIN_PASSWORD?.trim()) {
    warnings.push('ADMIN_PASSWORD is no longer used: the CSV export needs a staff account with export permission (see docs/DEPLOYMENT.md)');
  }

  const origin = siteOrigin(env.SITE_URL, nodeEnv);
  const staticDir = resolve(env.STATIC_DIR?.trim() || DEFAULT_STATIC_DIR);

  return {
    env: nodeEnv,
    host: env.HOST?.trim() || '127.0.0.1',
    port: int('PORT', env.PORT, 3000, 1, 65535),
    database: usePostgres
      ? {
          driver: 'postgres',
          connectionString,
          ssl: bool('DATABASE_SSL', env.DATABASE_SSL, false),
          poolMax: int('DB_POOL_MAX', env.DB_POOL_MAX, 10, 1, 100),
        }
      : { driver: 'pglite', dataDir: resolve(env.PGLITE_DATA_DIR?.trim() || '.data/pglite') },
    trustProxy: proxies,
    edgeProxySecret,
    staticDir,
    runMigrations: bool('RUN_MIGRATIONS', env.RUN_MIGRATIONS, true),
    rateLimit: {
      submitMax: int('RATE_LIMIT_SUBMIT_MAX', env.RATE_LIMIT_SUBMIT_MAX, 20, 1, 10_000),
      submitWindowMs: int('RATE_LIMIT_SUBMIT_WINDOW_MINUTES', env.RATE_LIMIT_SUBMIT_WINDOW_MINUTES, 10, 1, 1440) * 60_000,
    },
    logLevel: env.LOG_LEVEL?.trim() || (nodeEnv === 'test' ? 'silent' : 'info'),
    siteOrigin: origin,
    appSecret,
    cookieSecure: bool('COOKIE_SECURE', env.COOKIE_SECURE, origin ? origin.startsWith('https:') : nodeEnv === 'production'),
    email: email(env, nodeEnv),
    push: push(env),
    worker: {
      mode: env.WORKER_MODE?.trim() === 'off' ? 'off' : 'inline',
      pollMs: int('WORKER_POLL_MS', env.WORKER_POLL_MS, 2_000, 200, 60_000),
    },
    auth: {
      staffMfaRequired: bool('STAFF_MFA_REQUIRED', env.STAFF_MFA_REQUIRED, nodeEnv === 'production'),
      staffSessionHours: int('STAFF_SESSION_HOURS', env.STAFF_SESSION_HOURS, 12, 1, 72),
      staffIdleMinutes: int('STAFF_IDLE_MINUTES', env.STAFF_IDLE_MINUTES, 120, 5, 1440),
      applicantSessionDays: int('APPLICANT_SESSION_DAYS', env.APPLICANT_SESSION_DAYS, 30, 1, 180),
      applicantIdleDays: int('APPLICANT_IDLE_DAYS', env.APPLICANT_IDLE_DAYS, 14, 1, 90),
    },
    buildId: readBuildId(staticDir),
    warnings,
  };
}

export const hasStaticBuild = (config: AppConfig) => existsSync(resolve(config.staticDir, 'index.html'));

/** Reads ./.env when present. Variables already set in the real environment always win. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
