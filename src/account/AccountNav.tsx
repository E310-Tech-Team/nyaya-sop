import { LogOutIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Button } from '../components/ui';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';
import { markSignedOut } from '../lib/account';
import { useAsync } from '../lib/useAsync';
import { accountApi } from './api';
import { ACCOUNT_NAV, ACCOUNT_SITE_LINKS, currentNavLabel, type AccountNavItem } from './nav';

const sectionLabel = 'px-3 font-sans text-[11px] font-extrabold uppercase tracking-[1.2px] text-muted';

/** Who is signed in: an initial in a burgundy circle and the address (truncated, full in its title). */
function Identity({ email }: { email: string }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand font-display text-[18px] text-white">
        {email.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 font-sans text-[12px] text-muted">
        Signed in as
        <strong title={email} className="block truncate text-[13px] text-ink">
          {email}
        </strong>
      </span>
    </div>
  );
}

function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-gold px-1.5 py-0.5 font-sans text-[11px] font-extrabold text-brand-deep group-aria-[current=page]:bg-white group-aria-[current=page]:text-brand">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function NavItem({ item, unread, onNavigate }: { item: AccountNavItem; unread: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      className="group flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-muted transition-colors hover:bg-white hover:text-brand aria-[current=page]:bg-brand aria-[current=page]:text-white"
    >
      <Icon aria-hidden="true" className="size-[18px] shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="font-sans text-[14px] font-semibold leading-[1.3]">{item.label}</span>
        <span className="font-sans text-[12px] leading-[1.35] opacity-80">{item.description}</span>
      </span>
      {item.showsUnread && unread > 0 && <UnreadBadge count={unread} />}
    </NavLink>
  );
}

/**
 * The menu's content, the same in the desktop sidebar and the phone sheet: who is signed in, the
 * account pages (icon, label, a line on what's there, the unread count on Messages), links back
 * to the site, and Sign out at the bottom.
 */
function AccountMenu({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  // Fresh on every account page (each one mounts the menu), so reading messages clears the badge.
  const inbox = useAsync((signal) => accountApi.inbox(signal), []);
  const unread = inbox.data?.unread ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <Identity email={email} />
      <nav aria-label="Account" className="flex flex-col gap-2">
        <p className={sectionLabel}>Your account</p>
        <ul className="flex flex-col gap-1">
          {ACCOUNT_NAV.map((item) => (
            <li key={item.to}>
              <NavItem item={item} unread={unread} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="On the site" className="flex flex-col gap-2">
        <p className={sectionLabel}>On the site</p>
        <ul className="flex flex-col gap-0.5">
          {ACCOUNT_SITE_LINKS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={onNavigate}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2 font-sans text-[13px] font-semibold text-muted hover:bg-white hover:text-brand"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-line pt-4">
        <Button
          tone="secondary"
          className="min-h-[40px] w-full gap-2 text-[13px]"
          onClick={async () => {
            await accountApi.logout().catch(() => undefined);
            markSignedOut();
          }}
        >
          <LogOutIcon aria-hidden="true" className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
    </svg>
  );
}

/**
 * Below `lg`: one button naming the current page ("☰ Dashboard"), which slides the menu in from
 * the left (a Radix dialog: focus stays inside, Escape closes, focus returns to the button).
 * Choosing a link closes it. It sits under the site header, whose own menu button is on the right.
 */
function AccountMenuButton({ email }: { email: string }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line pb-4 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button tone="secondary" className="min-h-[44px] gap-2 px-4 text-[14px]">
            <MenuIcon />
            {currentNavLabel(pathname)}
            <span className="sr-only">: open the account menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-cream">
          <SheetHeader>
            <SheetTitle>Your account</SheetTitle>
            <SheetDescription className="sr-only">Pages of your account, links to the site, and signing out.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <AccountMenu email={email} onNavigate={() => setOpen(false)} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The account menu: a sticky sidebar on the left from `lg`, a slide-out sheet below it. */
export function AccountNav({ email }: { email: string }) {
  return (
    <>
      <AccountMenuButton email={email} />
      <aside className="hidden lg:sticky lg:top-[calc(var(--sticky-header-height)+24px)] lg:block lg:w-[260px] lg:shrink-0 lg:self-start lg:border-r lg:border-line lg:pr-6">
        <AccountMenu email={email} />
      </aside>
    </>
  );
}
