import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { ConnectionStatus, PushReconciler, ServiceWorkerMessages, UpdatePrompt } from './components/AppStatus';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ApplicationLayout } from './components/FormLayout';
import { MarketingLayout } from './components/marketing/PageParts';
import { RequireStep } from './components/RequireStep';
import { RouteEffects } from './components/RouteEffects';
import AboutPage from './pages/AboutPage';
import EducationCareerPage from './pages/EducationCareerPage';
import FaqPage from './pages/FaqPage';
import InstallPage from './pages/InstallPage';
import JourneyPage from './pages/JourneyPage';
import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import NotificationsPage from './pages/NotificationsPage';
import PersonalInfoPage from './pages/PersonalInfoPage';
import ProgrammePage from './pages/ProgrammePage';
import PurposePage from './pages/PurposePage';
import ReviewPage from './pages/ReviewPage';
import SuccessPage from './pages/SuccessPage';
import UpdatesPage from './pages/UpdatesPage';
import WelcomePage from './pages/WelcomePage';
import { ApplicationProvider } from './state/application';
import { Loading } from './components/ui/basic';

// Loaded only when visited, so the public site stays as light as before.
const AccountApp = lazy(() => import('./account/AccountApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense
    fallback={
      <div className="mx-auto w-full max-w-[1080px] px-5 py-10">
        <Loading />
      </div>
    }
  >
    {children}
  </Suspense>
);

export default function App() {
  return (
    <ErrorBoundary>
      <ApplicationProvider>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ConnectionStatus />
        <RouteEffects />
        <ServiceWorkerMessages />
        <PushReconciler />
        <UpdatePrompt />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          {/* Dedicated pages share the marketing header (kept mounted between them) and footer. */}
          <Route element={<MarketingLayout />}>
            <Route path="/about" element={<AboutPage />} />
            <Route path="/programme" element={<ProgrammePage />} />
            <Route path="/journey" element={<JourneyPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/account/*" element={<Lazy><AccountApp /></Lazy>} />
          </Route>
          <Route path="/admin/*" element={<Lazy><AdminApp /></Lazy>} />
          <Route path="/apply" element={<WelcomePage />} />
          {/* Steps share a persistent layout: header and progress stay mounted between steps. */}
          <Route element={<ApplicationLayout />}>
            <Route path="/apply/personal" element={<RequireStep><PersonalInfoPage /></RequireStep>} />
            <Route path="/apply/education" element={<RequireStep><EducationCareerPage /></RequireStep>} />
            <Route path="/apply/purpose" element={<RequireStep><PurposePage /></RequireStep>} />
            <Route path="/apply/review" element={<RequireStep><ReviewPage /></RequireStep>} />
          </Route>
          <Route path="/apply/success" element={<SuccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ApplicationProvider>
    </ErrorBoundary>
  );
}
