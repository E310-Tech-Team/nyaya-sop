import { describe, expect, it } from 'vitest';
import { ACCOUNT_NAV, ACCOUNT_SITE_LINKS, currentNavLabel } from './nav';

describe('account navigation', () => {
  it('keeps the order, labels and routes', () => {
    expect(ACCOUNT_NAV.map((item) => [item.label, item.to])).toEqual([
      ['Dashboard', '/account'],
      ['Application', '/account/application'],
      ['Messages & notifications', '/account/notifications'],
      ['Settings', '/account/settings'],
    ]);
  });

  it('gives every item a short description and an icon of its own', () => {
    for (const item of ACCOUNT_NAV) expect(item.description).toMatch(/\S/);
    expect(new Set(ACCOUNT_NAV.map((item) => item.icon)).size).toBe(ACCOUNT_NAV.length);
  });

  it('shows the unread count on Messages only', () => {
    expect(ACCOUNT_NAV.filter((item) => item.showsUnread).map((item) => item.to)).toEqual(['/account/notifications']);
  });

  it('links back to public pages that exist', () => {
    expect(ACCOUNT_SITE_LINKS.map((item) => item.to)).toEqual(['/updates', '/journey']);
  });

  it('names the page the menu button stands on', () => {
    expect(currentNavLabel('/account')).toBe('Dashboard');
    expect(currentNavLabel('/account/')).toBe('Dashboard');
    expect(currentNavLabel('/account/notifications')).toBe('Messages & notifications');
    // Anywhere else in the account area the button just says what it opens.
    expect(currentNavLabel('/account/unknown')).toBe('Account menu');
  });
});
