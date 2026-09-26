import { useRef } from 'react';
import { Link } from 'react-router';
import imgParticipants from '../assets/landing/hero-participants.webp';
import imgTonalGlowMobile from '../assets/landing/hero-glow-mobile.svg';
import imgPortraitRing from '../assets/landing/hero-ring-mobile.svg';
import imgTonalGlow from '../assets/landing/hero-glow.svg';
import imgSplitSweep from '../assets/landing/hero-split-sweep.svg';
import imgDotAccent from '../assets/landing/hero-dot-grid.svg';
import imgArrowRight1 from '../assets/landing/arrow-right-cream.svg';
import imgCircleCheck from '../assets/landing/hero-circle.svg';
import { ClosingInvitation } from '../components/landing/ClosingInvitation';
import { AboutPreview, FaqPreview, JourneyPreview, ProgrammePreview } from '../components/landing/Previews';
import { WhatToExpect } from '../components/landing/WhatToExpect';
import { DesktopNav, MarketingFooter } from '../components/marketing/Chrome';
import { MenuButton, MobileMenu, useMobileMenu, type MobileMenuControls } from '../components/marketing/MobileMenu';
import { StickyHeader } from '../components/marketing/StickyHeader';
import { usePageTitle } from '../components/RouteEffects';
import { HERO_COPY } from '../config/programme';
import { useInitialHashScroll, useLandingZoom } from '../lib/landing';
import { enterAfter, useScrollReveal } from '../lib/motion';

/**
 * Opening sequence (ms after first paint). Desktop overlaps into one composition finished by
 * ≈1s; phones use a shorter copy sequence and play the photograph when it scrolls into view.
 */
const HERO = {
  brand: 0,
  eyebrow: 40,
  headline: 60,
  headline2: 120,
  photo: 140,
  glow: 160,
  summary: 180,
  actions: 240,
  ring: 300,
  caption: 340,
  dots: 380,
} as const;
const HERO_MOBILE = { brand: 0, eyebrow: 30, headline: 60, summary: 120, actions: 180 } as const;

/** The hero's one-line eligibility note. */
function Eligibility({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center gap-[10px] font-sans font-semibold leading-[1.35] text-white ${className}`}>
      <span aria-hidden="true" className="flex size-[20px] shrink-0 items-center justify-center rounded-full bg-gold-light">
        <svg width="11" height="8" viewBox="0 0 12 9" fill="none">
          <path d="M1 4L4.5 7.5L11 1" stroke="#5c1329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {HERO_COPY.eligibility}
    </p>
  );
}

/**
 * The homepage header, kept at the top of the viewport (StickyHeader). Phones and tablets: the
 * burgundy bar above the hero. From 1280px it lies over the hero composition as designed
 * (transparent, links on the white panel) until the page scrolls, then becomes the burgundy bar
 * of the other pages. It sits outside the zoomed hero but is laid out on the same 1440px frame
 * (.landing-scale), and sticks 16px up, so once scrolled its row is centred in a 96px bar.
 */
function HomeHeader({ menu }: { menu: MobileMenuControls }) {
  return (
    <StickyHeader className="top-0 bg-[#8b1e3f] transition-[background-color,box-shadow] duration-[180ms] ease-[var(--ease-standard)] data-[scrolled]:shadow-[0_1px_0_rgba(255,255,255,0.1),0_6px_18px_rgba(26,8,16,0.18)] xl:top-[calc(var(--landing-zoom,1)*-16px)] xl:-mb-[calc(var(--landing-zoom,1)*112px)] xl:bg-transparent xl:data-[scrolled]:bg-[#8b1e3f]">
      {(scrolled) => (
        <>
          {/* Phones and tablets */}
          <div className="on-dark enter-fade flex h-[78px] items-center justify-between overflow-clip px-5 xl:hidden" style={enterAfter(HERO_MOBILE.brand)}>
            <div className="flex gap-[10px] items-center">
              <div className="bg-white flex flex-col items-center justify-center rounded-[999px] shrink-0 size-[38px]">
                <p className="font-sans font-black text-[#8b1e3f] text-[11px]">SOP</p>
              </div>
              <div className="flex flex-col items-start">
                <p className="font-sans font-black text-[12px] text-white tracking-[0.4px]">SCHOOL OF PURPOSE</p>
                <p className="font-serif italic text-[#f3dce3] text-[11px]">RCCG National Young Adults &amp; Youth</p>
              </div>
            </div>
            <MenuButton menu={menu} />
          </div>
          {/* Desktop: 32px from the top of the hero frame, a 64px row, 16px below */}
          <div className={`landing-scale mx-auto hidden w-full max-w-[1440px] xl:block ${scrolled ? 'on-dark' : ''}`}>
            <div className="enter-fade mx-[80px] mb-[16px] mt-[32px] flex h-[64px] items-center justify-between" style={enterAfter(HERO.brand)}>
              <div className="flex gap-[12px] items-center overflow-clip">
                <div className="bg-white flex flex-col items-center justify-center overflow-clip rounded-[21px] size-[42px]">
                  <p className="font-sans font-black not-italic text-[#8b1e3f] text-[13px]">SOP</p>
                </div>
                <div className="flex flex-col items-start leading-normal overflow-clip whitespace-nowrap">
                  <p className="font-sans font-black not-italic text-[19px] text-white tracking-[0.5px]">SCHOOL OF PURPOSE</p>
                  <p className="font-serif font-normal italic text-[#f3dce3] text-[12px]">RCCG National Young Adults &amp; Youth</p>
                </div>
              </div>
              <DesktopNav tone={scrolled ? 'dark' : 'light'} toneSwitches />
            </div>
          </div>
        </>
      )}
    </StickyHeader>
  );
}

/**
 * The homepage: the hero, "What to expect", then short previews of About, Programme, Journey
 * and FAQ (each keeps its old #id, so /#about etc. still land somewhere useful), the closing
 * invitation and the footer.
 */
export default function LandingPage() {
  usePageTitle('');
  useLandingZoom();
  const rootRef = useRef<HTMLDivElement>(null);
  useScrollReveal(rootRef);
  useInitialHashScroll();
  const menu = useMobileMenu();

  return (
    <div id="top" ref={rootRef} className="bg-white flex flex-col items-start w-full">
      <MobileMenu menu={menu} />
      <HomeHeader menu={menu} />

      <main id="main" className="w-full">
      {/* ── MOBILE HERO ── */}
      <div className="on-dark bg-[#8b1e3f] flex flex-col items-start w-full xl:hidden">
        {/* Hero copy: eyebrow, headline, one supporting sentence, eligibility, then the actions. */}
        <div className="flex flex-col items-start overflow-clip pb-[12px] pt-[30px] px-6 sm:px-10 w-full max-w-[760px] mx-auto">
          <p className="enter-fade font-sans font-bold text-[#dcc28a] text-[11px] tracking-[1.6px] uppercase" style={enterAfter(HERO_MOBILE.eyebrow)}>
            {HERO_COPY.eyebrow}
          </p>
          {/* Fluid size: two lines on phones from 360px, three at 320px. */}
          <h1 data-page-heading tabIndex={-1} className="enter-up mt-[14px] font-display leading-[1.02] text-[clamp(34px,9.6vw,52px)] text-white tracking-[-0.8px] w-full outline-none" style={enterAfter(HERO_MOBILE.headline)}>
            <span className="block">{HERO_COPY.headline[0]}</span>{' '}
            <span className="block text-[#f3dce3]">{HERO_COPY.headline[1]}</span>
          </h1>
          <p className="enter-up mt-[16px] font-sans font-normal leading-[1.55] text-[#f3dce3] text-[15px] w-full" style={enterAfter(HERO_MOBILE.summary)}>
            {HERO_COPY.summary}
          </p>
          <div className="enter-up mt-[18px] flex flex-col gap-[22px] w-full" style={enterAfter(HERO_MOBILE.actions)}>
            <Eligibility className="text-[14px]" />
            {/* Primary is the light, filled pill (highest contrast on burgundy); stacked on phones. */}
            <div className="flex flex-col gap-[10px] w-full sm:flex-row">
              <Link
                to="/apply"
                className="motion-button bg-[#f7f3eb] hover:bg-white cursor-pointer flex sm:flex-1 h-[56px] items-center justify-between gap-[12px] pl-[22px] pr-[11px] rounded-[999px]"
              >
                <span className="font-sans font-bold text-[15px] text-[#8b1e3f] whitespace-nowrap">Start my application</span>
                <span aria-hidden="true" className="motion-arrow bg-[#8b1e3f] flex flex-col items-center justify-center rounded-[999px] shrink-0 size-[34px]">
                  <span className="font-sans font-bold text-[17px] text-white">→</span>
                </span>
              </Link>
              <Link
                to="/programme"
                className="motion-button border border-white/70 hover:bg-white/10 cursor-pointer flex sm:flex-1 h-[56px] items-center justify-between gap-[12px] pl-[22px] pr-[11px] rounded-[999px]"
              >
                <span className="font-sans font-bold text-[15px] text-white whitespace-nowrap">Explore the programme</span>
                <span aria-hidden="true" className="motion-arrow border border-white/60 flex flex-col items-center justify-center rounded-[999px] shrink-0 size-[34px]">
                  <span className="font-sans font-bold text-[17px] text-white">→</span>
                </span>
              </Link>
            </div>
          </div>
        </div>
        {/* Portrait */}
        <div className="flex flex-col h-[356px] items-center justify-center overflow-clip relative w-full">
          <div aria-hidden="true" data-reveal="fade" data-reveal-with="hero-photo" data-reveal-at="0" className="absolute left-1/2 -translate-x-1/2 top-[calc(50%+10px)] -translate-y-1/2 size-[310px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgTonalGlowMobile} />
          </div>
          <div aria-hidden="true" data-reveal="ring" data-reveal-with="hero-photo" data-reveal-at="120" className="absolute left-1/2 -translate-x-1/2 top-[calc(50%+6px)] -translate-y-1/2 size-[286px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgPortraitRing} />
          </div>
          {/* Visible from the first paint; its depth settle plays when it scrolls into view. */}
          <div data-reveal="photo" data-reveal-id="hero-photo" className="h-[352px] relative shrink-0 w-[358px]">
            <img alt="Two young adults in smart clothes leaping in celebration" fetchPriority="high" className="absolute inset-0 max-w-none object-contain size-full" src={imgParticipants} />
          </div>
        </div>
        {/* The edition's name, once, as a small caption under the photograph. */}
        <p data-reveal="fade" data-reveal-with="hero-photo" data-reveal-at="240" className="w-full pb-[24px] text-center font-sans font-bold text-[#dcc28a] text-[11px] tracking-[2px] uppercase">
          {HERO_COPY.edition}
        </p>
        {/* Scripture */}
        <div className="bg-[#f7f3eb] w-full">
          <div className="pb-[34px] pt-[28px] px-6 sm:px-10 w-full max-w-[760px] mx-auto">
            <figure data-reveal="up" className="bg-[#3b081a] flex flex-col gap-[14px] items-center overflow-clip pb-[44px] pt-[40px] px-[28px] w-full">
              <blockquote className="font-serif font-semibold italic leading-[1.45] text-[18px] text-center text-white w-full">
                "For we are his workmanship, created in Christ Jesus unto good works."
              </blockquote>
              <figcaption className="font-sans font-bold text-[#dcc28a] text-[11px] tracking-[1.6px] uppercase whitespace-nowrap">Ephesians 2:10, KJV</figcaption>
            </figure>
          </div>
        </div>
      </div>

      {/* ── DESKTOP HERO ── */}
      <div className="landing-desktop hidden xl:block w-full">
      <div className="bg-[#8b1e3f] h-[900px] overflow-clip relative shrink-0 w-full">
        {/* White right panel — extends from the 865px mark (of the 1440px frame, centred) all the way to the right edge */}
        <div
          className="absolute top-0 h-full bg-white"
          style={{ left: 'calc(50% + 145px)', right: 0 }}
        />

        {/* Centred 1440-wide content frame */}
        <div className="absolute top-0 h-full" style={{ left: '50%', transform: 'translateX(-50%)', width: 1440, maxWidth: '100%' }}>
          {/* Tonal glow */}
          <div className="enter-fade enter-feature absolute left-[420px] size-[520px] top-[120px]" style={enterAfter(HERO.glow)}>
            <div className="absolute" style={{ inset: '-17.31%' }}>
              <img alt="" className="block max-w-none size-full" src={imgTonalGlow} />
            </div>
          </div>
          {/* Split sweep */}
          {/* Part of the background structure: still from the first paint (fading it showed a pink seam). */}
          <div className="absolute h-[1200px] left-[760px] top-[-150px] w-[250px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgSplitSweep} />
          </div>
          {/* Dot accent */}
          <div className="enter-fade absolute h-[20px] left-[1262px] top-[754px] w-[90px]" style={enterAfter(HERO.dots)}>
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgDotAccent} />
          </div>

          {/* The edition's name, once, as a small caption beside the photograph. */}
          <div className="enter-fade absolute flex flex-col gap-[10px] items-start left-[1190px] top-[688px] w-[170px]" style={enterAfter(HERO.caption)}>
            <span aria-hidden="true" className="bg-[#8b1e3f] h-[1.5px] w-[28px]" />
            <p className="font-sans font-bold leading-[1.5] text-[#8b1e3f] text-[12px] tracking-[2.4px] uppercase">{HERO_COPY.edition}</p>
          </div>

          {/* Participants. Decorative layers take no pointer events (they reach up under the
              header's area). */}
          <div className="enter-photo pointer-events-none absolute h-[942px] left-[430px] top-[-3px] w-[833px]" style={enterAfter(HERO.photo)}>
            <img alt="Two young adults in smart clothes leaping in celebration" fetchPriority="high" className="absolute inset-0 max-w-none object-contain pointer-events-none size-full" src={imgParticipants} />
          </div>
          {/* Circle check */}
          <div className="enter-ring pointer-events-none absolute h-[879px] left-[452px] top-[41px] w-[790px]" style={enterAfter(HERO.ring)}>
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgCircleCheck} />
          </div>

          {/* Hero copy, set where the photograph leaves the most room (its edge sits furthest right
              between y≈300 and 540), so the headline's long first line clears the participants. */}
          <div className="on-dark absolute flex flex-col items-start left-[80px] top-[312px] w-[580px]">
            <p className="enter-fade font-sans font-bold leading-normal text-[#dcc28a] text-[12px] tracking-[3px] uppercase" style={enterAfter(HERO.eyebrow)}>
              {HERO_COPY.eyebrow}
            </p>
            {/* The headline's two lines rise in turn (never letter by letter). */}
            <h1 data-page-heading tabIndex={-1} className="mt-[22px] flex flex-col font-display leading-[1.02] not-italic text-[64px] tracking-[-1.5px] w-full outline-none">
              <span className="enter-up enter-feature text-white" style={enterAfter(HERO.headline)}>{HERO_COPY.headline[0]}</span>{' '}
              <span className="enter-up enter-feature text-[#f3dce3]" style={enterAfter(HERO.headline2)}>{HERO_COPY.headline[1]}</span>
            </h1>
            <p className="enter-up mt-[24px] font-sans font-normal leading-[1.55] not-italic text-[#f3dce3] text-[18px] w-[470px]" style={enterAfter(HERO.summary)}>
              {HERO_COPY.summary}
            </p>
            <div className="enter-up mt-[22px] flex flex-col gap-[34px] items-start" style={enterAfter(HERO.actions)}>
              <Eligibility className="text-[16px]" />
              <div className="flex gap-[12px] items-center">
                <Link
                  to="/apply"
                  className="motion-button bg-[#f7f3eb] hover:bg-white cursor-pointer flex gap-[14px] h-[58px] items-center pl-[26px] pr-[12px] rounded-[999px]"
                >
                  <span className="font-sans font-bold leading-normal not-italic text-[#8b1e3f] text-[15px] whitespace-nowrap">Start my application</span>
                  <span aria-hidden="true" className="motion-arrow bg-[#8b1e3f] flex flex-col items-center justify-center overflow-clip rounded-[999px] size-[34px]">
                    <img alt="" className="block max-w-none size-[16px]" src={imgArrowRight1} />
                  </span>
                </Link>
                <Link
                  to="/programme"
                  className="motion-button border border-white/70 hover:bg-white/10 cursor-pointer flex gap-[14px] h-[58px] items-center pl-[26px] pr-[12px] rounded-[999px]"
                >
                  <span className="font-sans font-bold leading-normal not-italic text-white text-[15px] whitespace-nowrap">Explore the programme</span>
                  <span aria-hidden="true" className="motion-arrow border border-white/60 flex flex-col items-center justify-center overflow-clip rounded-[999px] size-[34px]">
                    <img alt="" className="block max-w-none size-[16px]" src={imgArrowRight1} />
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>{/* end desktop hero wrapper */}

      {/* ── WHAT TO EXPECT (one responsive tree) ── */}
      <WhatToExpect />

      {/* ── PREVIEWS of the dedicated pages ── */}
      <AboutPreview />
      <ProgrammePreview />
      <JourneyPreview />
      <FaqPreview />

      <ClosingInvitation />
      </main>

      <MarketingFooter />
    </div>
  );
}
