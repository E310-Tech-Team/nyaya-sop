import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { csvCell } from './csv';

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

  it('rejects unsafe or malformed values', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });
});

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['has,comma', '"has,comma"'],
    ['has "quotes"', '"has ""quotes"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['@cmd', "'@cmd"],
    ['-2+3+cmd', "'-2+3+cmd"],
    ['+447700900123', '+447700900123'],
    [null, ''],
    [5, '5'],
  ])('%j → %s', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
});
