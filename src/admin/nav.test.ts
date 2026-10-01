import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '../shared/permissions';
import { ADMIN_NAV, navFor, PARISH_REVIEW } from './nav';

// The menu as it was before the icons (2026-10-01): labels, routes, order and who sees each item
// must not drift when the menu changes.
const BEFORE: [label: string, to: string, any: string[], all: boolean][] = [
  ['Dashboard', '/admin', ['dashboard.view'], false],
  ['Applicants', '/admin/applicants', ['applications.view_all', 'applications.view_assigned'], false],
  ['Accounts', '/admin/accounts', ['accounts.view'], false],
  ['Reports and analytics', '/admin/reports', ['reports.view'], false],
  ['Parish review', '/admin/parish-review', ['applications.view_all', 'applications.edit', 'directory.manage'], true],
  ['Parish directory', '/admin/directory', ['directory.view'], false],
  ['Cohorts', '/admin/cohorts', ['cohorts.manage', 'applications.view_all'], false],
  ['Notifications', '/admin/campaigns', ['campaigns.manage'], false],
  ['Announcements', '/admin/announcements', ['announcements.manage'], false],
  ['Staff', '/admin/staff', ['staff.manage'], false],
  ['Settings', '/admin/settings', ['settings.manage'], false],
  ['Audit history', '/admin/audit', ['audit.view'], false],
  ['Your security', '/admin/security', [], false],
];

describe('admin navigation', () => {
  it('keeps the order, routes and permission rules', () => {
    expect(ADMIN_NAV.map((item) => [item.label, item.to, item.any, item.all ?? false])).toEqual(BEFORE);
    expect(ADMIN_NAV.find((item) => item.to === '/admin/parish-review')!.any).toBe(PARISH_REVIEW);
  });

  it('gives every item a label, an admin route and an icon of its own', () => {
    for (const item of ADMIN_NAV) {
      expect(item.label.trim()).not.toBe('');
      expect(item.to).toMatch(/^\/admin(\/[a-z-]+)?$/);
      expect(item.icon).toBeTruthy();
    }
    expect(new Set(ADMIN_NAV.map((item) => item.icon)).size).toBe(ADMIN_NAV.length);
  });

  it('shows each role what it may open, and Your security to everyone', () => {
    for (const role of STAFF_ROLES) expect(navFor(role).map((item) => item.label)).toContain('Your security');
    expect(navFor('owner')).toHaveLength(ADMIN_NAV.length);
    expect(navFor('programme_admin').map((item) => item.label)).not.toContain('Staff');
    expect(navFor('reviewer').map((item) => item.label)).toEqual(['Dashboard', 'Applicants', 'Your security']);
    expect(navFor('communications').map((item) => item.label)).toEqual(['Dashboard', 'Notifications', 'Announcements', 'Your security']);
    expect(navFor('read_only').map((item) => item.label)).toEqual(['Dashboard', 'Your security']);
  });
});
