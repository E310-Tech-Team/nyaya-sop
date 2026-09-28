import { useEffect, useRef, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { EDITION, HERO_COPY } from '../../config/programme';
import { site } from '../../config/site';
import { useLandingZoom } from '../../lib/landing';
import { enterAfter, useScrollReveal } from '../../lib/motion';
import { CtaRow, LightCta, MarketingFooter, MarketingHeader, OutlineCta } from './Chrome';
import { MobileMenu, useMobileMenu } from './MobileMenu';

/**
 * Layout route for About, Programme, Journey and FAQ: the marketing header stays mounted
 * between these pages; the page and footer below it are a fresh reveal root for each page.
 */
export function MarketingLayout() {
  useLandingZoom();
  const menu = useMobileMenu();
  const { pathname } = useLocation();
  const { requestClose } = menu;
  // Any page change (a menu link, browser Back) closes the menu over the new page.
  useEffect(() => requestClose(false), [pathname, requestClose]);
  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      <MobileMenu menu={menu} />
      <MarketingHeader menu={menu} />
      <PageFrame key={pathname} />
    </div>
  );
}

/** One page and the footer. Keyed by path, so scroll reveals re-arm for every page. */
function PageFrame() {
  const rootRef = useRef<HTMLDivElement>(null);
  useScrollReveal(rootRef);
  return (
    <div ref={rootRef} className="flex w-full flex-1 flex-col">
      <main id="main" className="w-full flex-1">
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}

/**
 * Compact page introduction on the brand burgundy: eyebrow, the page's single <h1> (focused on
 * navigation) and a short lead, with optional actions. Plays the hero's quiet entrance.
 */
export function PageIntro({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="on-dark w-full border-b border-white/10 bg-[#841d26]">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div className="landing-gutter flex flex-col items-start pb-[44px] pt-[34px] xl:px-[80px] xl:pb-[80px] xl:pt-[64px]">
          <p className="enter-fade font-sans font-bold text-gold-light text-[11px] tracking-[1.6px] uppercase xl:text-[12px] xl:tracking-[3px]" style={enterAfter(0)}>
            {eyebrow}
          </p>
          <h1
            data-page-heading
            tabIndex={-1}
            className="enter-up mt-[14px] max-w-[900px] font-display text-[clamp(36px,10vw,56px)] leading-[1.02] tracking-[-0.5px] text-white outline-none xl:mt-[18px] xl:text-[64px] xl:tracking-[-1px]"
            style={enterAfter(60)}
          >
            {title}
          </h1>
          {children && (
            <div className="enter-up mt-[16px] flex max-w-[680px] flex-col gap-[12px] font-sans text-[15px] leading-[1.6] text-rose xl:mt-[22px] xl:text-[18px]" style={enterAfter(120)}>
              {children}
            </div>
          )}
          {actions && (
            <div className="enter-up mt-[26px] w-full xl:mt-[32px] xl:w-auto" style={enterAfter(180)}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Closing invitation on the dedicated pages: the hero's promise, eligibility and the actions. */
export function ApplyBand({ secondary }: { secondary?: { to: string; label: string } }) {
  return (
    <section aria-labelledby="apply-band-heading" className="on-dark w-full bg-[#841d26]">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div
          data-reveal-group=""
          className="landing-gutter flex flex-col items-start gap-[28px] py-[56px] xl:flex-row xl:items-end xl:justify-between xl:gap-[48px] xl:px-[80px] xl:py-[88px]"
        >
          <div data-reveal="up" data-reveal-at="0" className="flex flex-col items-start gap-[12px]">
            <p className="font-sans font-bold text-gold-light text-[11px] tracking-[1.6px] uppercase xl:text-[12px] xl:tracking-[3px]">
              {site.programme} · {EDITION.label}
            </p>
            <h2 id="apply-band-heading" className="font-display text-[34px] leading-[1.05] text-white xl:text-[48px]">
              <span className="block">{HERO_COPY.headline[0]}</span>{' '}
              <span className="block text-[#f3dce3]">{HERO_COPY.headline[1]}</span>
            </h2>
            <p className="font-sans text-[15px] leading-[1.55] text-rose xl:text-[16px]">
              {HERO_COPY.eligibility} · Apply in about {site.minutesToComplete} minutes
            </p>
          </div>
          <div data-reveal="up" data-reveal-at="120" className="w-full xl:w-auto">
            <CtaRow>
              <LightCta to="/apply">Start my application</LightCta>
              {secondary && <OutlineCta to={secondary.to}>{secondary.label}</OutlineCta>}
            </CtaRow>
          </div>
        </div>
      </div>
    </section>
  );
}
