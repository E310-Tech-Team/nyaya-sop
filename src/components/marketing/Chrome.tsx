import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import imgArrowRight from '../../assets/landing/arrow-right-burgundy.svg';
import imgArrowRightCream from '../../assets/landing/arrow-right-cream.svg';
import { site } from '../../config/site';
import { useInstallState } from '../../lib/install';
import { BrandLockup } from '../BrandLockup';
import { RCCG_YAYA_EMBLEM } from './emblem';
import { MenuButton, type MobileMenuControls } from './MobileMenu';
import { CONTACT_LINK, MAIN_NAV } from './nav';
import { StickyHeader } from './StickyHeader';

/**
 * Desktop navigation (≥1280px). `light`: dark links on the homepage's white panel; `dark`: white
 * links on the burgundy header of the other pages. The current page is marked with
 * aria-current="page" (NavLink), bold weight and a resting underline.
 *
 * `toneSwitches`: the homepage header turns from light to dark once the page scrolls. The
 * colours then cross-fade in place, and the Apply pill keeps its 1px border in both tones so its
 * width never changes.
 */
export function DesktopNav({ tone, toneSwitches = false }: { tone: 'light' | 'dark'; toneSwitches?: boolean }) {
  const light = tone === 'light';
  const linkColor = light ? 'text-[#3b081a]' : 'text-white';
  const linkClass = (active: boolean) =>
    `font-sans ${active ? 'font-extrabold' : 'font-semibold'} nav-underline leading-normal not-italic ${linkColor} text-[13px] uppercase whitespace-nowrap transition-[color] duration-[180ms]`;
  const pillColors = light
    ? 'bg-[#841d26] border border-[#841d26] hover:bg-[#6a171e]'
    : `bg-[#f3f0e6] hover:bg-white ${toneSwitches ? 'border border-[#f3f0e6] hover:border-white' : ''}`;
  return (
    <nav aria-label="Main" className="flex gap-[34px] items-center">
      <ul className="flex gap-[34px] items-center">
        {MAIN_NAV.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end className={({ isActive }) => linkClass(isActive)}>
              {item.label}
            </NavLink>
          </li>
        ))}
        {CONTACT_LINK && (
          <li>
            <a href={CONTACT_LINK.href} className={linkClass(false)}>
              {CONTACT_LINK.label}
            </a>
          </li>
        )}
      </ul>
      <Link
        to="/apply"
        className={`motion-button ${pillColors} cursor-pointer flex gap-[12px] h-[44px] items-center overflow-clip px-[24px] rounded-[32px]`}
      >
        <span
          className={`font-sans font-bold leading-normal not-italic text-[14px] ${light ? 'text-white' : 'text-[#841d26]'} whitespace-nowrap transition-[color] duration-[180ms]`}
        >
          Apply
        </span>
        <span
          aria-hidden="true"
          className={`motion-arrow relative ${light ? 'bg-white' : 'bg-[#841d26]'} flex flex-col items-center justify-center overflow-clip rounded-[999px] size-[24px]`}
        >
          {toneSwitches ? (
            // Both arrows, cross-faded with the knob, so the arrow never vanishes mid-switch.
            <>
              <img alt="" className={`absolute inset-0 m-auto block max-w-none size-[16px] transition-opacity duration-[160ms] ${light ? 'opacity-100' : 'opacity-0'}`} src={imgArrowRight} />
              <img alt="" className={`absolute inset-0 m-auto block max-w-none size-[16px] transition-opacity duration-[160ms] ${light ? 'opacity-0' : 'opacity-100'}`} src={imgArrowRightCream} />
            </>
          ) : (
            <img alt="" className="block max-w-none size-[16px]" src={light ? imgArrowRight : imgArrowRightCream} />
          )}
        </span>
      </Link>
    </nav>
  );
}

/**
 * The brand lockup linking home, as on the homepage: the cream version, since every marketing
 * header is burgundy (compact on phones and tablets).
 */
function HomeLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" aria-label={`${site.name}: home`} className="flex shrink-0 items-center">
      <BrandLockup on="dark" alt="" className={compact ? 'h-[48px]' : 'h-[60px]'} />
    </Link>
  );
}

/**
 * Header for the dedicated pages: the homepage's lockup and navigation on a burgundy bar. It
 * stays at the top while scrolling; once the page leaves the top it adds a soft shadow.
 */
export function MarketingHeader({ menu }: { menu: MobileMenuControls }) {
  return (
    <StickyHeader className="on-dark top-0 border-b border-white/10 bg-[#841d26] transition-shadow duration-[180ms] ease-[var(--ease-standard)] data-[scrolled]:shadow-[0_6px_18px_rgba(26,8,16,0.18)]">
      <div className="flex h-[78px] items-center justify-between overflow-clip px-5 xl:hidden">
        <HomeLink compact />
        <MenuButton menu={menu} />
      </div>
      <div className="landing-scale mx-auto hidden w-full max-w-[1440px] xl:block">
        <div className="flex h-[96px] items-center justify-between px-[80px]">
          <HomeLink />
          <DesktopNav tone="dark" />
        </div>
      </div>
    </StickyHeader>
  );
}

/** Site footer (every marketing page). `id="contact"` keeps the Contact link working. */
export function MarketingFooter() {
  const opsz = { fontVariationSettings: '"opsz" 14' };
  const { standalone } = useInstallState();
  return (
    <footer id="contact" className="on-dark bg-[#1a0810] w-full shrink-0">
      <div data-reveal="fade" className="flex flex-col items-start max-w-[1440px] mx-auto px-6 sm:px-10 xl:px-[80px] pb-[48px] pt-[72px]">
        <div className="flex flex-col xl:flex-row gap-[48px] xl:gap-[401px] items-start w-full">
          <div className="flex flex-col gap-[24px] items-start w-full max-w-[360px]">
            <BrandLockup on="dark" className="h-[64px]" />
            <p className="font-sans font-normal leading-[22px] text-[14px] text-[rgba(243,240,230,0.72)]" style={opsz}>
              Raising a generation of purpose-driven young Christians to influence the Church, transform the marketplace and impact the nation.
            </p>
            {site.contactEmail && (
              <p className="font-sans text-[14px] text-[rgba(243,240,230,0.85)]">
                Questions? Email{' '}
                <a className="underline underline-offset-4 hover:text-white" href={`mailto:${site.contactEmail}`}>
                  {site.contactEmail}
                </a>
              </p>
            )}
            {/* The text beside the emblem names it, so the image itself is decorative (alt=""). */}
            <p className="flex items-center gap-[14px] font-sans font-normal leading-[20px] text-[14px] text-[rgba(243,240,230,0.85)]" style={opsz}>
              <img src={RCCG_YAYA_EMBLEM.src} alt="" width={RCCG_YAYA_EMBLEM.width} height={RCCG_YAYA_EMBLEM.height} loading="lazy" decoding="async" className="h-[64px] w-auto shrink-0" />
              <span className="text-balance">
                <span className="block font-bold leading-[18px] text-[#b69b63] text-[12px] tracking-[1.2px] uppercase">An initiative of</span>
                RCCG National Young Adults and Youth Affairs
              </span>
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-[20px] items-start w-[220px]">
            <p className="font-sans font-bold leading-[18px] text-[#b69b63] text-[12px] tracking-[1.2px] uppercase whitespace-nowrap" style={opsz}>Navigation</p>
            <ul className="flex flex-col gap-[12px] items-start font-sans font-normal leading-[20px] text-[14px] text-[rgba(243,240,230,0.85)]" style={opsz}>
              {MAIN_NAV.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end className="transition-colors hover:text-white whitespace-nowrap aria-[current=page]:font-bold aria-[current=page]:text-white">
                    {item.label}
                  </NavLink>
                </li>
              ))}
              {CONTACT_LINK && (
                <li>
                  <a href={CONTACT_LINK.href} className="transition-colors hover:text-white whitespace-nowrap">{CONTACT_LINK.label}</a>
                </li>
              )}
              <li>
                <Link to="/apply" className="transition-colors hover:text-white whitespace-nowrap">Apply now</Link>
              </li>
              <li>
                <NavLink to="/updates" end className="transition-colors hover:text-white whitespace-nowrap aria-[current=page]:font-bold aria-[current=page]:text-white">
                  Programme updates
                </NavLink>
              </li>
              <li>
                <NavLink to="/account" className="transition-colors hover:text-white whitespace-nowrap aria-[current=page]:font-bold aria-[current=page]:text-white">
                  Your account
                </NavLink>
              </li>
              <li>
                <NavLink to="/notifications" end className="transition-colors hover:text-white whitespace-nowrap aria-[current=page]:font-bold aria-[current=page]:text-white">
                  Notification settings
                </NavLink>
              </li>
              {/* Not shown inside the installed app itself. */}
              {!standalone && (
                <li>
                  <NavLink to="/install" end className="transition-colors hover:text-white whitespace-nowrap aria-[current=page]:font-bold aria-[current=page]:text-white">
                    Install the app
                  </NavLink>
                </li>
              )}
            </ul>
          </nav>
        </div>
        <div className="border-[rgba(243,240,230,0.06)] border-b mt-[40px] w-full" />
        {/* Supporting photos are AI-generated (docs/IMAGERY.md); the hero is not covered by this note. */}
        <p className="font-sans font-normal leading-[18px] max-w-[760px] pt-[20px] text-[12px] text-[rgba(243,240,230,0.62)]" style={opsz}>
          About our images: the photographs in the About, Programme and Journey sections, and on the application pages, are AI-generated. They are not pictures of real applicants, participants or RCCG events. The Biblical Blueprint paintings are artistic interpretations.
        </p>
        <div className="flex flex-col xl:flex-row font-sans font-normal gap-[8px] xl:gap-0 xl:items-center xl:justify-between pt-[20px] text-[12px] w-full" style={opsz}>
          <p className="text-[rgba(243,240,230,0.62)]">© {new Date().getFullYear()} RCCG National Young Adults &amp; Youth. All rights reserved.</p>
          <p className="text-[rgba(243,240,230,0.62)]">Built for the School of Purpose community</p>
        </div>
      </div>
    </footer>
  );
}

/** Primary action on burgundy: the light pill used in the homepage hero. */
export function LightCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="motion-button bg-[#f3f0e6] hover:bg-white cursor-pointer flex sm:flex-1 xl:flex-none h-[56px] items-center justify-between gap-[12px] pl-[22px] pr-[11px] rounded-[999px] xl:gap-[14px] xl:pl-[26px]"
    >
      <span className="font-sans font-bold text-[15px] text-[#841d26] whitespace-nowrap">{children}</span>
      <span aria-hidden="true" className="motion-arrow bg-[#841d26] flex flex-col items-center justify-center rounded-[999px] shrink-0 size-[34px]">
        <span className="font-sans font-bold text-[17px] text-white">→</span>
      </span>
    </Link>
  );
}

/** Secondary action on burgundy: the outlined pill used in the homepage hero. */
export function OutlineCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="motion-button border border-white/70 hover:bg-white/10 cursor-pointer flex sm:flex-1 xl:flex-none h-[56px] items-center justify-between gap-[12px] pl-[22px] pr-[11px] rounded-[999px] xl:gap-[14px] xl:pl-[26px]"
    >
      <span className="font-sans font-bold text-[15px] text-white whitespace-nowrap">{children}</span>
      <span aria-hidden="true" className="motion-arrow border border-white/60 flex flex-col items-center justify-center rounded-[999px] shrink-0 size-[34px]">
        <span className="font-sans font-bold text-[17px] text-white">→</span>
      </span>
    </Link>
  );
}

/** A pair of actions: stacked full-width on phones, side by side from 640px. */
export function CtaRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[10px] w-full sm:flex-row xl:w-auto xl:gap-[12px]">{children}</div>;
}

/** Text link with an arrow, for "read more" moves between pages. */
export function MoreLink({ to, children, tone = 'light' }: { to: string; children: ReactNode; tone?: 'light' | 'dark' }) {
  const color =
    tone === 'dark'
      ? 'text-gold-light decoration-gold-light/40 hover:decoration-gold-light'
      : 'text-brand decoration-brand/30 hover:decoration-brand';
  return (
    <Link
      to={to}
      className={`inline-flex min-h-[44px] items-center gap-[8px] self-start font-sans text-[14px] font-bold underline underline-offset-4 transition-colors xl:text-[15px] ${color}`}
    >
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Section eyebrow: short rule + tracked capitals, as used across the homepage. */
export function Eyebrow({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  const rule = tone === 'dark' ? 'bg-[#b69b63]' : 'bg-brand';
  const text = tone === 'dark' ? 'text-gold-light' : 'text-brand';
  return (
    <div className="flex items-center gap-[10px] xl:gap-[16px]">
      <div data-reveal="rule-x" className={`h-[1.5px] w-[32px] shrink-0 xl:w-[40px] ${rule}`} />
      <p className={`min-w-0 font-sans text-[11px] font-bold uppercase tracking-[1.8px] xl:text-[12px] xl:tracking-[3px] ${text}`}>{children}</p>
    </div>
  );
}
