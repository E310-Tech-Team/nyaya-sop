import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { BrandLockup } from '../components/BrandLockup';
import { Button, LoadError, Loading, PageHeader } from '../components/ui';
import { can, ROLE_LABELS, type Permission } from '../shared/permissions';
import { adminApi } from './api';
import { ForgotPasswordPage, InviteSetupPage, LoginPage, ResetPasswordPage } from './AuthPages';
import AccountsPage, { AccountDetailPage } from './pages/Accounts';
import AnnouncementsPage from './pages/Announcements';
import ApplicantDetailPage from './pages/ApplicantDetail';
import ApplicantsPage from './pages/Applicants';
import AuditPage from './pages/Audit';
import CampaignPage, { NewCampaignPage } from './pages/Campaign';
import CampaignsPage from './pages/Campaigns';
import CohortsPage from './pages/Cohorts';
import DashboardPage from './pages/Dashboard';
import SecurityPage from './pages/Security';
import SettingsPage from './pages/Settings';
import StaffPage from './pages/Staff';
import { loadStaffSession, staffSignedOut, useStaff } from './session';

/** /admin/* (lazy-loaded). Every screen checks permissions again on the server. */
export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="setup" element={<InviteSetupPage />} />
      <Route path="forgot" element={<ForgotPasswordPage />} />
      <Route path="reset" element={<ResetPasswordPage />} />
      <Route element={<RequireStaff />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Allowed any={['dashboard.view']}><DashboardPage /></Allowed>} />
          <Route path="applicants" element={<Allowed any={['applications.view_all', 'applications.view_assigned']}><ApplicantsPage /></Allowed>} />
          <Route path="applicants/:id" element={<Allowed any={['applications.view_all', 'applications.view_assigned']}><ApplicantDetailPage /></Allowed>} />
          <Route path="accounts" element={<Allowed any={['accounts.view']}><AccountsPage /></Allowed>} />
          <Route path="accounts/:id" element={<Allowed any={['accounts.view']}><AccountDetailPage /></Allowed>} />
          <Route path="cohorts" element={<Allowed any={['cohorts.manage', 'applications.view_all']}><CohortsPage /></Allowed>} />
          <Route path="campaigns" element={<Allowed any={['campaigns.manage']}><CampaignsPage /></Allowed>} />
          <Route path="campaigns/new" element={<Allowed any={['campaigns.manage']}><NewCampaignPage /></Allowed>} />
          <Route path="campaigns/:id" element={<Allowed any={['campaigns.manage']}><CampaignPage /></Allowed>} />
          <Route path="announcements" element={<Allowed any={['announcements.manage']}><AnnouncementsPage /></Allowed>} />
          <Route path="staff" element={<Allowed any={['staff.manage']}><StaffPage /></Allowed>} />
          <Route path="settings" element={<Allowed any={['settings.manage']}><SettingsPage /></Allowed>} />
          <Route path="audit" element={<Allowed any={['audit.view']}><AuditPage /></Allowed>} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="*" element={<PageHeader title="Page not found" documentTitle="Admin" description="There’s no admin page at this address." />} />
        </Route>
      </Route>
    </Routes>
  );
}

/** Not signed in (or a second step is pending): the sign-in screen, then back here. */
function RequireStaff() {
  const staff = useStaff();
  const location = useLocation();
  if (staff.step === 'signed-in') return <Outlet />;
  if (staff.step === 'unknown' || staff.step === 'loading') {
    return (
      <div className="min-h-screen bg-cream p-8">
        <Loading />
      </div>
    );
  }
  if (staff.step === 'error') {
    return (
      <div className="min-h-screen bg-cream p-8">
        <LoadError error={null} onRetry={() => void loadStaffSession()} />
      </div>
    );
  }
  return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />;
}

function Allowed({ any, children }: { any: Permission[]; children: ReactNode }) {
  const staff = useStaff();
  if (staff.step !== 'signed-in') return null;
  if (any.some((permission) => can(staff.session.staff.role, permission))) return <>{children}</>;
  return (
    <PageHeader
      title="You don’t have access to this page"
      documentTitle="No access"
      description="Your role doesn’t include this part of the admin area. An owner can change your role if you need it."
    />
  );
}

const NAV: { to: string; label: string; any: Permission[] }[] = [
  { to: '/admin', label: 'Dashboard', any: ['dashboard.view'] },
  { to: '/admin/applicants', label: 'Applicants', any: ['applications.view_all', 'applications.view_assigned'] },
  { to: '/admin/accounts', label: 'Accounts', any: ['accounts.view'] },
  { to: '/admin/cohorts', label: 'Cohorts', any: ['cohorts.manage', 'applications.view_all'] },
  { to: '/admin/campaigns', label: 'Notifications', any: ['campaigns.manage'] },
  { to: '/admin/announcements', label: 'Announcements', any: ['announcements.manage'] },
  { to: '/admin/staff', label: 'Staff', any: ['staff.manage'] },
  { to: '/admin/settings', label: 'Settings', any: ['settings.manage'] },
  { to: '/admin/audit', label: 'Audit history', any: ['audit.view'] },
  { to: '/admin/security', label: 'Your security', any: [] },
];

function AdminLayout() {
  const staff = useStaff();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  if (staff.step !== 'signed-in') return null;
  const { role, displayName } = staff.session.staff;
  const items = NAV.filter((item) => item.any.length === 0 || item.any.some((permission) => can(role, permission)));

  const signOut = async () => {
    await adminApi.logout().catch(() => undefined);
    staffSignedOut();
  };

  const nav = (
    <nav aria-label="Admin">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/admin'}
              className="flex min-h-[40px] items-center rounded-[10px] px-3 font-sans text-[14px] font-semibold text-white/80 hover:bg-white/10 hover:text-white aria-[current=page]:bg-white aria-[current=page]:text-brand"
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-cream lg:flex-row">
      <aside className="on-dark flex shrink-0 flex-col gap-4 bg-brand-deep px-4 py-4 text-white lg:sticky lg:top-0 lg:h-screen lg:w-[248px] lg:overflow-y-auto lg:py-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/admin" className="flex flex-col items-start gap-1">
            <BrandLockup on="dark" alt="School of Purpose" className="h-[40px]" />
            <span className="font-sans text-[11px] font-bold uppercase tracking-[1.2px] text-white/75">Admin</span>
          </Link>
          <button
            type="button"
            className="min-h-[40px] rounded-full border border-white/40 px-4 font-sans text-[13px] font-bold lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        <div id="admin-nav" className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-4 lg:flex lg:flex-1`}>
          {nav}
          <div className="mt-auto flex flex-col gap-2 border-t border-white/15 pt-4">
            <p className="font-sans text-[13px] text-white/85">
              {displayName}
              <br />
              <span className="text-white/60">{ROLE_LABELS[role]}</span>
            </p>
            <Button tone="secondary" className="min-h-[38px] self-start text-[13px]" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>
      <main id="main" className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-6 sm:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
