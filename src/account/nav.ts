import { BellIcon, CalendarRangeIcon, FileTextIcon, LayoutDashboardIcon, MegaphoneIcon, SettingsIcon, type LucideIcon } from 'lucide-react';

/**
 * The account menu (src/account/AccountNav.tsx): order, labels, routes, a one-line description and
 * an icon for each page. Icons are decorative (the label names the link); lucide stays out of
 * public pages (src/components/ui/bundles.test.ts), and the account area is a lazy chunk.
 */
export type AccountNavItem = { to: string; label: string; description: string; icon: LucideIcon; showsUnread?: boolean };

export const ACCOUNT_NAV: readonly AccountNavItem[] = [
  { to: '/account', label: 'Dashboard', description: 'Progress and to-dos', icon: LayoutDashboardIcon },
  { to: '/account/application', label: 'Application', description: 'Status and the team’s message', icon: FileTextIcon },
  { to: '/account/notifications', label: 'Messages & notifications', description: 'Your inbox and alerts', icon: BellIcon, showsUnread: true },
  { to: '/account/settings', label: 'Settings', description: 'Sessions and your account', icon: SettingsIcon },
];

/** Public pages worth a way back to from the account. */
export const ACCOUNT_SITE_LINKS: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/updates', label: 'Programme updates', icon: MegaphoneIcon },
  { to: '/journey', label: 'The journey', icon: CalendarRangeIcon },
];

const FALLBACK_LABEL = 'Account menu';

/** What the phone menu button says: the page it stands on, or what it opens. */
export function currentNavLabel(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ACCOUNT_NAV.find((item) => item.to === path)?.label ?? FALLBACK_LABEL;
}
