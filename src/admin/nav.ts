/**
 * The admin sidebar: its items in order, the permissions that show each one, and a decorative
 * icon (lucide-react, admin-only: src/components/ui/bundles.test.ts). The server checks every
 * permission again; this only decides what the menu offers.
 */
import {
  BellIcon,
  CalendarRangeIcon,
  ChartColumnIcon,
  ChurchIcon,
  CircleUserRoundIcon,
  ClipboardCheckIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { can, type Permission, type StaffRole } from '../shared/permissions';

/** Parish review shows applicants and changes the directory: it needs all three (server/admin/parish-review.ts). */
export const PARISH_REVIEW: Permission[] = ['applications.view_all', 'applications.edit', 'directory.manage'];

export type AdminNavItem = {
  to: string;
  label: string;
  /** Decorative only (aria-hidden): the label names the link. */
  icon: LucideIcon;
  /** Any one of these shows the item; with `all`, every one is needed. None: everyone. */
  any: Permission[];
  all?: boolean;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboardIcon, any: ['dashboard.view'] },
  { to: '/admin/applicants', label: 'Applicants', icon: UsersIcon, any: ['applications.view_all', 'applications.view_assigned'] },
  { to: '/admin/accounts', label: 'Accounts', icon: CircleUserRoundIcon, any: ['accounts.view'] },
  { to: '/admin/reports', label: 'Reports and analytics', icon: ChartColumnIcon, any: ['reports.view'] },
  { to: '/admin/parish-review', label: 'Parish review', icon: ClipboardCheckIcon, any: PARISH_REVIEW, all: true },
  { to: '/admin/directory', label: 'Parish directory', icon: ChurchIcon, any: ['directory.view'] },
  { to: '/admin/cohorts', label: 'Cohorts', icon: CalendarRangeIcon, any: ['cohorts.manage', 'applications.view_all'] },
  { to: '/admin/campaigns', label: 'Notifications', icon: BellIcon, any: ['campaigns.manage'] },
  { to: '/admin/announcements', label: 'Announcements', icon: MegaphoneIcon, any: ['announcements.manage'] },
  { to: '/admin/staff', label: 'Staff', icon: UserCogIcon, any: ['staff.manage'] },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon, any: ['settings.manage'] },
  { to: '/admin/audit', label: 'Audit history', icon: HistoryIcon, any: ['audit.view'] },
  { to: '/admin/security', label: 'Your security', icon: ShieldCheckIcon, any: [] },
];

/** The items a role sees, in order. */
export const navFor = (role: StaffRole): AdminNavItem[] =>
  ADMIN_NAV.filter(
    (item) => item.any.length === 0 || (item.all ? item.any.every((permission) => can(role, permission)) : item.any.some((permission) => can(role, permission))),
  );
