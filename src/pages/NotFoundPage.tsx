import { Link } from 'react-router';
import { PrimaryLink } from '../components/Buttons';
import { usePageTitle } from '../components/RouteEffects';
import { SiteHeader } from '../components/SiteHeader';

export default function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <div className="flex min-h-screen w-full flex-col bg-cream">
      <SiteHeader badge="Page not found" />
      <main id="main" className="flex w-full flex-1 items-start justify-center px-6 py-16 sm:px-10">
        <div className="form-enter flex w-full max-w-[640px] flex-col items-start gap-5">
          <p className="font-sans text-[11px] font-extrabold uppercase tracking-[2px] text-brand">Error 404</p>
          <h1 data-page-heading tabIndex={-1} className="font-display text-[42px] leading-[1.05] text-ink outline-none md:text-[52px]">
            We couldn't find that page.
          </h1>
          <p className="font-sans text-[16px] leading-[1.6] text-muted">
            The link may be old or mistyped. You can head back to the School of Purpose home page, or start your application.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <PrimaryLink to="/apply">Apply now</PrimaryLink>
            <Link to="/" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">
              Go to the home page
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
