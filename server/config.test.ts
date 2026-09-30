import { describe, expect, it } from 'vitest';
import { assertSafeToListen, ConfigError, isLoopbackAddress, loadConfig } from './config';
import { csvCell } from './csv';
import { smtpConnection } from './email';

describe('the RCCG directory API settings', () => {
  const KEY = 'fake-config-key-0123456789-SECRET';

  it('is off unless configured, and takes one of the two environments with a key', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).directoryApi).toBeNull();
    expect(loadConfig({ NODE_ENV: 'development', DIRECTORY_API_ENV: 'Sandbox', DIRECTORY_API_KEY: ` ${KEY} ` }).directoryApi).toEqual({
      env: 'sandbox',
      key: KEY,
      syncIntervalMinutes: 15,
      freshnessHours: 24,
    });
    expect(
      loadConfig({ NODE_ENV: 'development', DIRECTORY_API_ENV: 'production', DIRECTORY_API_KEY: KEY, DIRECTORY_SYNC_INTERVAL_MINUTES: '60', DIRECTORY_FRESHNESS_HOURS: '12' })
        .directoryApi,
    ).toMatchObject({ env: 'production', syncIntervalMinutes: 60, freshnessHours: 12 });
  });

  it('refuses half a configuration, an unknown environment or a malformed key, without echoing the key', () => {
    const errorOf = (env: Record<string, string>) => {
      try {
        loadConfig({ NODE_ENV: 'development', ...env });
      } catch (error) {
        return error as Error;
      }
      throw new Error('expected a configuration error');
    };
    expect(errorOf({ DIRECTORY_API_KEY: KEY }).message).toMatch(/DIRECTORY_API_ENV must be production or sandbox/);
    expect(errorOf({ DIRECTORY_API_ENV: 'staging', DIRECTORY_API_KEY: KEY }).message).toMatch(/production or sandbox/);
    expect(errorOf({ DIRECTORY_API_ENV: 'production' }).message).toMatch(/DIRECTORY_API_KEY is required/);
    for (const bad of ['short', `${KEY} with spaces`, `${KEY}\u0007`]) {
      const error = errorOf({ DIRECTORY_API_ENV: 'production', DIRECTORY_API_KEY: bad });
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).not.toContain(bad.trim());
    }
    expect(errorOf({ DIRECTORY_API_ENV: 'production', DIRECTORY_API_KEY: KEY, DIRECTORY_SYNC_INTERVAL_MINUTES: '1' }).message).toMatch(/DIRECTORY_SYNC_INTERVAL_MINUTES/);
  });

  it('warns when a production server would use the sandbox directory', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://sop:pw@db:5432/sop',
      APP_SECRET: 'a-long-random-production-secret-0123456789abcdef',
      SITE_URL: 'https://apply.example.org',
    };
    expect(loadConfig({ ...production, DIRECTORY_API_ENV: 'sandbox', DIRECTORY_API_KEY: KEY }).warnings.join(' ')).toMatch(/sandbox in production/);
    expect(loadConfig({ ...production, DIRECTORY_API_ENV: 'production', DIRECTORY_API_KEY: KEY }).warnings.join(' ')).not.toMatch(/sandbox/);
  });

  it('keeps the key out of the browser: no client code reads it, and Vite only exposes VITE_ variables', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const files = (await readdir('src', { recursive: true })).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file));
    // Naming the setting in help text is fine (the admin area says which one to check); reading it is not.
    const reads = /(?:import\.meta\.env|process\.env)\s*(?:\.|\[\s*['"`])DIRECTORY_API/;
    for (const file of files) expect(await readFile(join('src', file), 'utf8'), file).not.toMatch(reads);
    // Vite exposes VITE_* by default; a wider envPrefix or a define naming the key would leak it.
    expect(await readFile('vite.config.ts', 'utf8')).not.toMatch(/envPrefix|DIRECTORY_API/);
  });
});

describe('loadConfig', () => {
  it('uses the embedded database in development', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.database.driver).toBe('pglite');
    expect(config.port).toBe(3000);
    expect(config.trustProxy).toBe(false);
    expect(config.email.transport).toBe('outbox');
    expect(config.push.publicKey).toBeNull();
    expect(config.warnings).toEqual([]);
  });

  const PRODUCTION = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://sop:pw@db:5432/sop',
    APP_SECRET: 'a-long-random-production-secret-0123456789abcdef',
    SITE_URL: 'https://apply.example.org',
  };

  it('requires a real database, an app secret and the site origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    const config = loadConfig(PRODUCTION);
    expect(config.database).toMatchObject({ driver: 'postgres', poolMax: 10, ssl: false });
    // PG* variables are enough on their own (no URL-encoding worries for passwords).
    expect(loadConfig({ ...PRODUCTION, DATABASE_URL: '', PGHOST: 'db' }).database.driver).toBe('postgres');
    expect(() => loadConfig({ ...PRODUCTION, APP_SECRET: '' })).toThrow(/APP_SECRET/);
    expect(() => loadConfig({ ...PRODUCTION, APP_SECRET: 'too-short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...PRODUCTION, SITE_URL: '' })).toThrow(/SITE_URL/);
    // Secure cookies and required MFA by default.
    expect(config.cookieSecure).toBe(true);
    expect(config.auth.staffMfaRequired).toBe(true);
  });

  it('never allows the local email outbox in production, and turns email off without SMTP', () => {
    expect(loadConfig(PRODUCTION).email.transport).toBe('none');
    expect(() => loadConfig({ ...PRODUCTION, EMAIL_TRANSPORT: 'outbox' })).toThrow(/outbox/);
    expect(() => loadConfig({ ...PRODUCTION, EMAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_URL/);
    const smtp = loadConfig({ ...PRODUCTION, SMTP_URL: 'smtps://u:p@smtp.example.org:465', EMAIL_FROM: 'SOP <no-reply@example.org>' });
    expect(smtp.email.transport).toBe('smtp');
  });

  it('validates the site origin and VAPID keys', () => {
    expect(() => loadConfig({ ...PRODUCTION, SITE_URL: 'http://apply.example.org' })).toThrow(/https/);
    expect(() => loadConfig({ ...PRODUCTION, SITE_URL: 'https://apply.example.org/path' })).toThrow(/origin/);
    expect(loadConfig({ SITE_URL: 'http://localhost:5173' }).siteOrigin).toBe('http://localhost:5173');
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'abc' })).toThrow(/VAPID/);
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'abc', VAPID_PRIVATE_KEY: 'def' })).toThrow(/VAPID_PUBLIC_KEY/);
    expect(() => loadConfig({ PUSH_ENDPOINT_HOSTS: 'not a host' })).toThrow(/PUSH_ENDPOINT_HOSTS/);
  });

  it('warns that the old admin password is no longer used', () => {
    expect(loadConfig({ ADMIN_PASSWORD: 'correct horse battery staple' }).warnings[0]).toMatch(/ADMIN_PASSWORD is no longer used/);
  });

  it('parses proxy trust settings', () => {
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: ' loopback,uniquelocal ' }).trustProxy).toBe('loopback,uniquelocal');
    // Fastify 5 silently ignores hop counts, so they are rejected loudly instead.
    expect(() => loadConfig({ TRUST_PROXY: '1' })).toThrow(/hop count/);
  });

  it('checks the secret shared with the website on Vercel', () => {
    const secret = 'edge-proxy-secret-0123456789abcdefghijkl';
    expect(loadConfig(PRODUCTION).edgeProxySecret).toBeNull();
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY: 'loopback,uniquelocal', EDGE_PROXY_SECRET: ` ${secret} ` })).toMatchObject({
      edgeProxySecret: secret,
      warnings: [],
    });
    expect(() => loadConfig({ ...PRODUCTION, EDGE_PROXY_SECRET: 'too-short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...PRODUCTION, EDGE_PROXY_SECRET: PRODUCTION.APP_SECRET })).toThrow(/differ from APP_SECRET/);
    // Without a trusted proxy the forwarded address can't be used, so say so.
    expect(loadConfig({ ...PRODUCTION, EDGE_PROXY_SECRET: secret }).warnings[0]).toMatch(/TRUST_PROXY/);
  });

  it('keeps development and test servers on this computer (security audit)', () => {
    const listen = (env: NodeJS.ProcessEnv) => () => assertSafeToListen(loadConfig(env));
    expect(listen({})).not.toThrow();
    expect(listen({ HOST: 'localhost', SITE_URL: 'http://localhost:5173' })).not.toThrow();
    expect(listen({ HOST: '::1' })).not.toThrow();
    for (const HOST of ['0.0.0.0', '::', '192.168.1.20', 'apply.example.org']) expect(listen({ HOST })).toThrow(/NODE_ENV=production/);
    expect(listen({ NODE_ENV: 'test', HOST: '0.0.0.0' })).toThrow(/test server/);
    // Behind a proxy on the same computer the host is loopback, but the public address gives it away.
    expect(listen({ SITE_URL: 'https://apply.example.org' })).toThrow(/NODE_ENV must be production/);
    // Production listens wherever it's told; the command-line tools don't check at all.
    expect(listen({ ...PRODUCTION, HOST: '0.0.0.0' })).not.toThrow();
    expect(() => loadConfig({ SITE_URL: 'https://apply.example.org' })).not.toThrow();
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1'].map(isLoopbackAddress)).toEqual([true, true, true]);
    expect(['203.0.113.7', '::ffff:10.0.0.1', '', undefined].map(isLoopbackAddress)).toEqual([false, false, false, false]);
  });

  it('warns about production settings that weaken the defaults (security audit)', () => {
    expect(loadConfig(PRODUCTION).warnings).toEqual([]);
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY: 'true', COOKIE_SECURE: 'false', STAFF_MFA_REQUIRED: 'false' }).warnings).toEqual([
      expect.stringMatching(/TRUST_PROXY=true/),
      expect.stringMatching(/COOKIE_SECURE=false/),
      expect.stringMatching(/STAFF_MFA_REQUIRED=false/),
    ]);
    expect(loadConfig({ TRUST_PROXY: 'true', COOKIE_SECURE: 'false' }).warnings).toEqual([]);
  });

  it('insists on TLS for an SMTP relay on another computer (security audit)', () => {
    expect(smtpConnection('smtp://u:p@smtp.example.org:587')).toEqual({ url: 'smtp://u:p@smtp.example.org:587', requireTLS: true });
    expect(smtpConnection('smtps://u:p@smtp.example.org:465')).toEqual({ url: 'smtps://u:p@smtp.example.org:465', requireTLS: true });
    expect(smtpConnection('smtp://127.0.0.1:25')).toBe('smtp://127.0.0.1:25');
    expect(smtpConnection('smtp://localhost:1025')).toBe('smtp://localhost:1025');
  });

  it('rejects unsafe or malformed values', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });
});

describe('csvCell', () => {
  it.each([
    ['plain', '"plain"'],
    ['has,comma', '"has,comma"'],
    ['has "quotes"', '"has ""quotes"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['=SUM(A1)', `"'=SUM(A1)"`],
    ['@cmd', `"'@cmd"`],
    ['-2+3+cmd', `"'-2+3+cmd"`],
    ['+447700900123', '"+447700900123"'],
    // A semicolon never starts a new cell in a spreadsheet set to semicolons (security audit).
    ['Ade;=1+2', '"Ade;=1+2"'],
    [null, '""'],
    [5, '"5"'],
  ])('%j → %s', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
});
