import type { ReactNode } from 'react';
import { NavLink, Outlet, Route, Routes } from 'react-router';
import { Button, LoadError, Loading, PageHeader } from '../components/ui';
import { loadAccount, markSignedOut, useAccount } from '../lib/account';
import { accountApi } from './api';
import AccountApplicationPage from './ApplicationPage';
import AccountNotificationsPage from './NotificationsPage';
import AccountOverviewPage from './OverviewPage';
import AccountSettingsPage from './SettingsPage';
import { SignInPage, VerifyPage } from './SignIn';

/** /account/* (lazy-loaded). Optional: nothing on the public site or the form depends on it. */
export default function AccountApp() {
  return (
    <Routes>
      <Route path="sign-in" element={<SignInPage />} />
      <Route path="verify" element={<VerifyPage />} />
      <Route element={<RequireAccount />}>
        <Route index element={<AccountOverviewPage />} />
        <Route path="application" element={<AccountApplicationPage />} />
        <Route path="notifications" element={<AccountNotificationsPage />} />
        <Route path="settings" element={<AccountSettingsPage />} />
      </Route>
      <Route
        path="*"
        element={
          <AccountFrame title="Page not found" nav={false}>
            <p className="font-sans text-[15px] text-muted">There’s no account page at this address.</p>
          </AccountFrame>
        }
      />
    </Routes>
  );
}

/** Signed out: the sign-in form takes the page's place (the address stays, so the person returns here). */
function RequireAccount() {
  const account = useAccount();
  if (account.status === 'signed-in') return <Outlet />;
  if (account.status === 'signed-out') return <SignInPage />;
  if (account.status === 'error') {
    return (
      <AccountFrame title="Your account" nav={false}>
        <LoadError error={null} onRetry={() => void loadAccount()} />
      </AccountFrame>
    );
  }
  return (
    <AccountFrame title="Your account" nav={false}>
      <Loading />
    </AccountFrame>
  );
}

const TABS = [
  { to: '/account', label: 'Dashboard' },
  { to: '/account/application', label: 'Application' },
  { to: '/account/notifications', label: 'Messages & notifications' },
  { to: '/account/settings', label: 'Settings' },
];

export function AccountFrame({
  title,
  description,
  children,
  nav = true,
  documentTitle,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  nav?: boolean;
  documentTitle?: string;
}) {
  const account = useAccount();
  const signedIn = nav && account.status === 'signed-in';
  return (
    <div className="w-full bg-cream">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:flex-row lg:gap-10 xl:py-12">
        {signedIn && <AccountSidebar email={account.account.email} />}
        <div className="flex min-w-0 flex-1 flex-col gap-7">
          <PageHeader eyebrow="Your account" title={title} description={description} documentTitle={documentTitle ?? title} />
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The account menu: pills above the page on phones and tablets, a sidebar on the left from lg
 * (sticky below the marketing header, so it stays in reach on long pages).
 */
function AccountSidebar({ email }: { email: string }) {
  return (
    <aside className="flex flex-col gap-3 border-b border-line pb-4 lg:sticky lg:top-[calc(var(--sticky-header-height)+24px)] lg:w-[220px] lg:shrink-0 lg:self-start lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
      <nav aria-label="Account">
        <ul className="flex flex-wrap gap-1 lg:flex-col">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end
                className="inline-flex min-h-[40px] items-center rounded-full px-4 font-sans text-[14px] font-semibold text-muted hover:text-brand aria-[current=page]:bg-brand aria-[current=page]:text-white lg:flex lg:w-full lg:rounded-[10px]"
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-wrap items-center gap-3 font-sans text-[13px] text-muted lg:mt-3 lg:flex-col lg:items-start lg:border-t lg:border-line lg:pt-4">
        <span className="min-w-0 max-w-full">
          Signed in as{' '}
          <strong title={email} className="text-ink lg:block lg:truncate">
            {email}
          </strong>
        </span>
        <Button
          tone="secondary"
          className="min-h-[36px] px-4 text-[13px]"
          onClick={async () => {
            await accountApi.logout().catch(() => undefined);
            markSignedOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}
