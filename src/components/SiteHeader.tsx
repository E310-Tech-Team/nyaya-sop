import { Link } from 'react-router';
import { site } from '../config/site';
import { BrandLockup } from './BrandLockup';

/**
 * Brand bar used on the application screens: burgundy on phones/tablets, paper on desktop.
 * The lockup links home.
 */
export function SiteHeader({ badge = site.formName }: { badge?: string }) {
  return (
    <header className="w-full shrink-0">
      {/* Phones & tablets: compact, so the form starts higher on the screen. */}
      <div className="on-dark bg-brand flex h-[60px] items-center justify-between gap-3 overflow-clip px-5 sm:px-8 lg:hidden">
        {/* The lockup never wraps; the badge wraps when space is short. */}
        <Link to="/" className="flex shrink-0 items-center" aria-label={`${site.name}: home`}>
          <BrandLockup on="dark" alt="" className="h-[40px]" />
        </Link>
        {/* Hidden on the narrowest phones (<360px): the same wording appears on each screen. */}
        <p className="flex min-h-[30px] min-w-0 max-w-[132px] items-center justify-center max-[359px]:hidden rounded-full border border-white/35 px-3 py-[5px] text-center font-sans text-[9px] font-extrabold uppercase leading-[1.2] tracking-[0.8px] text-white">
          {badge}
        </p>
      </div>

      {/* Desktop */}
      <div className="hidden h-[96px] items-center justify-between border-b border-line bg-paper px-[64px] lg:flex">
        <Link to="/" className="flex items-center" aria-label={`${site.name}: home`}>
          <BrandLockup on="light" alt="" className="h-[60px]" />
        </Link>
        <p className="font-sans text-[12px] font-bold uppercase tracking-[1.2px] text-brand">{badge}</p>
      </div>
    </header>
  );
}
