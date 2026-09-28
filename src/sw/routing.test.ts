import { describe, expect, it } from 'vitest';
import { FALLBACK_NOTIFICATION, isCacheable, notificationTarget, readPushPayload, strategyFor } from './routing';

const ORIGIN = 'https://apply.example.org';
const get = (path: string, mode = 'cors') => ({ method: 'GET', url: `${ORIGIN}${path}`, mode });

describe('what the service worker caches', () => {
  it.each([
    // Never cached: the API (applications, accounts, auth, CSV, admin data)…
    [get('/api/applications'), 'bypass'],
    [get('/api/account/me'), 'bypass'],
    [get('/api/admin/applicants/export.csv'), 'bypass'],
    [get('/api/admin/session'), 'bypass'],
    [get('/api/push/status'), 'bypass'],
    // …any change…
    [{ method: 'POST', url: `${ORIGIN}/api/applications`, mode: 'cors' }, 'bypass'],
    [{ method: 'POST', url: `${ORIGIN}/`, mode: 'navigate' }, 'bypass'],
    [{ method: 'PUT', url: `${ORIGIN}/assets/app-abc.js`, mode: 'cors' }, 'bypass'],
    // …other origins, update checks, and files under the private areas.
    [{ method: 'GET', url: 'https://fonts.example.com/font.woff2', mode: 'cors' }, 'bypass'],
    [get('/sw.js'), 'bypass'],
    [get('/build-id.txt'), 'bypass'],
    [get('/admin/export.csv'), 'bypass'],
    [get('/account/data.json'), 'bypass'],
    [get('/unknown.txt'), 'bypass'],
    // Pages: account and admin always from the network; public pages network-first.
    [get('/admin', 'navigate'), 'private-page'],
    [get('/admin/applicants/123', 'navigate'), 'private-page'],
    [get('/account', 'navigate'), 'private-page'],
    [get('/account/application?x=1', 'navigate'), 'private-page'],
    [get('/', 'navigate'), 'page'],
    [get('/programme', 'navigate'), 'page'],
    [get('/apply/review', 'navigate'), 'page'],
    [get('/accounts-news', 'navigate'), 'page'], // only the /account path itself is private
    [get('/administer', 'navigate'), 'page'],
    // Build files and public static files.
    [get('/assets/index-B1x2y3.js'), 'asset'],
    [get('/assets/inter-latin-wght-normal-abc.woff2'), 'asset'],
    [get('/icons/icon-192.png'), 'static'],
    [get('/favicon.ico'), 'static'],
    [get('/manifest.webmanifest'), 'static'],
    [get('/offline.html'), 'static'],
  ] as const)('%o → %s', (request, expected) => {
    expect(strategyFor(request, ORIGIN)).toBe(expected);
  });

  it('stores only successful same-origin responses that allow storage', () => {
    const headers = (value: string | null) => ({ get: () => value });
    expect(isCacheable({ ok: true, type: 'basic', headers: headers('public, max-age=31536000, immutable') })).toBe(true);
    expect(isCacheable({ ok: true, type: 'basic', headers: headers('no-store') })).toBe(false);
    expect(isCacheable({ ok: false, type: 'basic', headers: headers(null) })).toBe(false);
    expect(isCacheable({ ok: true, type: 'opaque', headers: headers(null) })).toBe(false);
  });
});

describe('push payloads', () => {
  const valid = { v: 1, id: 'm1', title: 'School of Purpose', body: 'There is an update to your application.', url: '/account/application', expiresAt: '2030-01-01T00:00:00Z' };

  it('reads a valid payload and marks account destinations as private', () => {
    expect(readPushPayload(valid)).toEqual({ id: 'm1', title: valid.title, body: valid.body, url: '/account/application', private: true });
    expect(readPushPayload({ ...valid, url: '/programme' }).private).toBe(false);
  });

  it('never sends people off-site, whatever the payload says', () => {
    for (const url of ['https://evil.example/', '//evil.example', '/admin', 'javascript:alert(1)', '/account/../admin']) {
      expect(readPushPayload({ ...valid, url }).url).toBe('/');
    }
    expect(notificationTarget('//evil.example/x', ORIGIN)).toBe(`${ORIGIN}/`);
    expect(notificationTarget('/faq', ORIGIN)).toBe(`${ORIGIN}/faq`);
  });

  it('shows a neutral fallback for anything unreadable, and trims long text', () => {
    expect(readPushPayload(null)).toEqual(FALLBACK_NOTIFICATION);
    expect(readPushPayload({ ...valid, v: 2 })).toEqual(FALLBACK_NOTIFICATION);
    expect(readPushPayload({ ...valid, title: '' })).toEqual(FALLBACK_NOTIFICATION);
    expect(readPushPayload({ ...valid, body: 'x'.repeat(500) }).body).toHaveLength(180);
  });
});
