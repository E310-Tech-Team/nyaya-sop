import type { ReactNode } from 'react';
import { Outlet, Route, Routes } from 'react-router';
import { LoadError, Loading, PageHeader } from '../components/ui';
import { loadAccount, useAccount } from '../lib/account';
import { AccountNav } from './AccountNav';
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
        {signedIn && <AccountNav email={account.account.email} />}
        <div className="flex min-w-0 flex-1 flex-col gap-7">
          <PageHeader eyebrow="Your account" title={title} description={description} documentTitle={documentTitle ?? title} />
          {children}
        </div>
      </div>
    </div>
  );
}
