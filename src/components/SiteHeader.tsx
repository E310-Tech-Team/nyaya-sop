import { Link } from 'react-router';
import { site } from '../config/site';

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
        <Link to="/" className="flex shrink-0 items-center gap-[10px] whitespace-nowrap" aria-label={`${site.name}: home`}>
          <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-white">
            <span className="font-sans text-[11px] font-black tracking-[0.5px] text-brand">{site.monogram}</span>
          </span>
          <span className="flex flex-col items-start gap-[2px]">
            <span className="font-sans text-[12px] font-black tracking-[0.4px] text-white">SCHOOL OF PURPOSE</span>
            <span className="font-sans text-[10px] italic text-rose">{site.organisation}</span>
          </span>
        </Link>
        {/* Hidden on the narrowest phones (<360px): the same wording appears on each screen. */}
        <p className="flex min-h-[30px] min-w-0 max-w-[132px] items-center justify-center max-[359px]:hidden rounded-full border border-white/35 px-3 py-[5px] text-center font-sans text-[9px] font-extrabold uppercase leading-[1.2] tracking-[0.8px] text-white">
          {badge}
        </p>
      </div>

      {/* Desktop */}
      <div className="hidden h-[96px] items-center justify-between border-b border-line bg-paper px-[64px] lg:flex">
        <Link to="/" className="flex items-center gap-[14px]" aria-label={`${site.name}: home`}>
          <span className="flex size-[46px] items-center justify-center rounded-full bg-brand">
            <span className="font-sans text-[12px] font-extrabold tracking-[0.6px] text-white">{site.monogram}</span>
          </span>
          <span className="flex flex-col items-start gap-[2px]">
            <span className="font-sans text-[16px] font-extrabold tracking-[0.7px] text-ink">SCHOOL OF PURPOSE</span>
            <span className="font-sans text-[15px] font-semibold italic text-brand">{site.organisation}</span>
          </span>
        </Link>
        <p className="font-sans text-[12px] font-bold uppercase tracking-[1.2px] text-brand">{badge}</p>
      </div>
    </header>
  );
}
