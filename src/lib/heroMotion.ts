/**
 * The homepage hero's opening (docs/04 §6): a GSAP timeline, once per visit to the page.
 *
 * The ideas come from the brand mark: the gold glow is the bullseye (fulfilment), the ring is
 * the target locking on, the leap is the journey. Desktop plays one composition of about 2.3 s;
 * phones and tablets play the copy on load and the photograph when it scrolls into view.
 * Afterwards the glow breathes very slowly (CSS, index.css), and on desktop the participants
 * drift and recede a little as the page scrolls away (a CSS scroll-driven animation).
 *
 * Rules (docs/04 §6):
 * - Every move starts from, and returns to, the element's own resting style: inline styles are
 *   cleared as each move finishes, so the settled hero is exactly the page without motion.
 * - Only transform, opacity and clip-path. Buttons stay clickable throughout, and keyboard focus
 *   anywhere on the page finishes the entrance at once.
 * - Reduced motion: nothing is hidden, moved or looped. The entrance also never replays when the
 *   viewport crosses the 1280px breakpoint; the other layout simply appears.
 *
 * Elements are marked in LandingPage with data-hero="…"; the desktop composition and the phone
 * layout each sit under their own [data-hero-layout]. The header rows (outside both) are
 * data-hero="header-desktop" and "header-mobile".
 */
import gsap from 'gsap';
import { useLayoutEffect, type RefObject } from 'react';

/** One move: when it starts and how long it takes (s); `step` staggers a group of `count`. */
export type Beat = { at: number; for: number; step?: number; count?: number };

/** The desktop composition. */
export const HERO_DESKTOP = {
  panel: { at: 0, for: 1.1 },
  glow: { at: 0, for: 1.4 },
  photoFade: { at: 0, for: 0.6 },
  photo: { at: 0.15, for: 1.3 },
  ring: { at: 0.3, for: 1.4 },
  ringFade: { at: 0.3, for: 0.8 },
  eyebrow: { at: 0.35, for: 0.9 },
  lines: { at: 0.45, for: 1.1, step: 0.12, count: 2 },
  header: { at: 0.7, for: 0.9 },
  summary: { at: 0.9, for: 1 },
  eligibility: { at: 1, for: 0.9 },
  tick: { at: 1.15, for: 0.6 },
  actions: { at: 1.1, for: 1, step: 0.1, count: 2 },
  captionRule: { at: 1.2, for: 0.8 },
  caption: { at: 1.3, for: 0.9 },
  dots: { at: 1.4, for: 0.9 },
} as const satisfies Record<string, Beat>;

/** Phones and tablets: the copy, from first paint. */
export const HERO_PHONE_COPY = {
  header: { at: 0, for: 0.9 },
  eyebrow: { at: 0.1, for: 0.9 },
  lines: { at: 0.2, for: 1.1, step: 0.12, count: 2 },
  summary: { at: 0.6, for: 1 },
  eligibility: { at: 0.72, for: 0.9 },
  tick: { at: 0.85, for: 0.6 },
  actions: { at: 0.8, for: 1, step: 0.1, count: 2 },
} as const satisfies Record<string, Beat>;

/** Phones and tablets: the photograph, when it comes into view. */
export const HERO_PHONE_PHOTO = {
  glow: { at: 0, for: 1.4 },
  photoFade: { at: 0, for: 0.6 },
  photo: { at: 0.1, for: 1.3 },
  ring: { at: 0.2, for: 1.4 },
  ringFade: { at: 0.2, for: 0.8 },
  caption: { at: 0.7, for: 0.9 },
} as const satisfies Record<string, Beat>;

/** If the photograph is already in view at load, it starts this long after the copy (s): it's
    usually the largest element, so it mustn't wait long. */
export const PHONE_PHOTO_DELAY = 0.25;

/** How long the entrance waits for the photograph to be decoded before playing without it. */
const PHOTO_WAIT_MS = 400;

/** When the last move of a sequence lands (s). */
export const entranceLength = (beats: Record<string, Beat>): number =>
  Math.max(...Object.values(beats).map((b) => b.at + (b.step ?? 0) * ((b.count ?? 1) - 1) + b.for));

const MOVE = 'transform,opacity';

/** Headline lines rise out of masks: clip below the line box only while they move. The mask
    reaches 30% below the line box and 40% above it, so no glyph is ever cut off. */
const LINE_MASK = 'inset(-40% -8% -30% -8%)';

type CopyBeats = typeof HERO_DESKTOP | typeof HERO_PHONE_COPY;
type PhotoBeats = typeof HERO_DESKTOP | typeof HERO_PHONE_PHOTO;

/**
 * Starts decoding the hero photograph now. A browser decodes a hidden image only when it first
 * paints it, which froze the phone entrance for ~360 ms at the moment the photo appeared.
 */
function photoReady(scope: HTMLElement): Promise<void> {
  const img = scope.querySelector<HTMLImageElement>('[data-hero="photo"] img');
  if (!img || typeof img.decode !== 'function') return Promise.resolve();
  const decoded = img.decode().catch(() => undefined);
  return Promise.race([decoded, new Promise((resolve) => window.setTimeout(resolve, PHOTO_WAIT_MS))]).then(() => undefined);
}

/**
 * Once the glow has landed it breathes (index.css: an 8 s cycle, compositor-only), paused while
 * the hero is off-screen or the tab is hidden.
 */
function breathe(glow: Element | null, area: Element, cleanups: (() => void)[]) {
  if (!glow) return;
  let onScreen = true;
  const update = () => glow.setAttribute('data-breathing', onScreen && document.visibilityState === 'visible' ? '' : 'paused');
  const observer = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    update();
  });
  observer.observe(area);
  document.addEventListener('visibilitychange', update);
  update();
  cleanups.push(() => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', update);
    glow.removeAttribute('data-breathing');
  });
}

function copyMoves(tl: gsap.core.Timeline, scope: HTMLElement, b: CopyBeats, lift: number) {
  const q = gsap.utils.selector(scope);
  const masks = q('[data-hero="mask"]');
  const lines = q('[data-hero="line"]');
  const ctas = q('[data-hero="cta"]');
  const tick = scope.querySelector<SVGPathElement>('[data-hero="tick"]');

  tl.from(q('[data-hero="eyebrow"]'), { y: 14, opacity: 0, duration: b.eyebrow.for, ease: 'power3.out', clearProps: MOVE }, b.eyebrow.at);

  gsap.set(masks, { clipPath: LINE_MASK });
  tl.from(lines, { yPercent: 135, duration: b.lines.for, ease: 'power4.out', stagger: b.lines.step, clearProps: 'transform' }, b.lines.at);
  tl.set(masks, { clearProps: 'clipPath' }, b.lines.at + b.lines.step * (lines.length - 1) + b.lines.for);

  tl.from(q('[data-hero="summary"]'), { y: lift, opacity: 0, duration: b.summary.for, ease: 'power3.out', clearProps: MOVE }, b.summary.at);
  tl.from(q('[data-hero="eligibility"]'), { y: lift * 0.7, opacity: 0, duration: b.eligibility.for, ease: 'power3.out', clearProps: MOVE }, b.eligibility.at);
  tl.from(q('[data-hero="tick-disc"]'), { scale: 0.4, duration: b.eligibility.for, ease: 'expo.out', clearProps: 'transform' }, b.eligibility.at);
  if (tick) {
    const length = tick.getTotalLength();
    tl.fromTo(
      tick,
      { strokeDasharray: length, strokeDashoffset: length, opacity: 0 },
      { strokeDashoffset: 0, opacity: 1, duration: b.tick.for, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset,opacity' },
      b.tick.at,
    );
  }

  // The buttons' own CSS transition includes opacity (hover feedback); pause it while GSAP
  // moves them, or the browser would chase every frame 160 ms behind.
  gsap.set(ctas, { transition: 'none' });
  tl.from(ctas, { y: lift * 1.2, opacity: 0, duration: b.actions.for, ease: 'power3.out', stagger: b.actions.step, clearProps: MOVE }, b.actions.at);
  tl.set(ctas, { clearProps: 'transition' }, b.actions.at + b.actions.step * (ctas.length - 1) + b.actions.for);
}

/** The glow blooms, the participants rise and land, the ring locks on. */
function photoMoves(tl: gsap.core.Timeline, scope: HTMLElement, b: PhotoBeats, rise: number, ringFrom: number) {
  const q = gsap.utils.selector(scope);
  tl.from(q('[data-hero="glow"]'), { scale: 0.6, opacity: 0, duration: b.glow.for, ease: 'expo.out', clearProps: MOVE }, b.glow.at);
  const photo = q('[data-hero="photo"]');
  tl.from(photo, { opacity: 0, duration: b.photoFade.for, ease: 'power2.out', clearProps: 'opacity' }, b.photoFade.at);
  tl.from(photo, { y: rise, scale: 1.06, transformOrigin: '50% 85%', duration: b.photo.for, ease: 'expo.out', clearProps: 'transform,transformOrigin' }, b.photo.at);
  const ring = q('[data-hero="ring"]');
  tl.from(ring, { scale: ringFrom, rotation: -8, duration: b.ring.for, ease: 'expo.out', clearProps: 'transform' }, b.ring.at);
  tl.from(ring, { opacity: 0, duration: b.ringFade.for, ease: 'power2.out', clearProps: 'opacity' }, b.ringFade.at);
}

function desktopEntrance(root: HTMLElement, cleanups: (() => void)[]): gsap.core.Timeline[] {
  const scope = root.querySelector<HTMLElement>('[data-hero-layout="desktop"]');
  if (!scope) return [];
  const q = gsap.utils.selector(scope);
  const b = HERO_DESKTOP;
  // Everything is in its start state from the first paint; it plays once the photograph is
  // decoded (or after PHOTO_WAIT_MS on a slow connection).
  const tl = gsap.timeline({ paused: true, onComplete: () => breathe(scope.querySelector('[data-hero="glow"]'), scope, cleanups) });
  let live = true;
  cleanups.push(() => {
    live = false;
  });
  void photoReady(scope).then(() => {
    if (live) tl.play();
  });

  // The white panel and the split-sweep artwork arrive from the right as one piece (same
  // distance, same curve), so their seam never opens.
  tl.from(q('[data-hero="panel"], [data-hero="sweep"]'), { x: scope.offsetWidth, duration: b.panel.for, ease: 'power3.inOut', clearProps: 'transform' }, b.panel.at);
  photoMoves(tl, scope, b, 100, 1.25);

  const header = root.querySelector('[data-hero="header-desktop"]');
  if (header) tl.from(header, { y: -14, opacity: 0, duration: b.header.for, ease: 'power3.out', clearProps: MOVE }, b.header.at);
  copyMoves(tl, scope, b, 24);

  tl.from(q('[data-hero="caption-rule"]'), { scaleX: 0, transformOrigin: 'left center', duration: b.captionRule.for, ease: 'power3.inOut', clearProps: 'transform,transformOrigin' }, b.captionRule.at);
  tl.from(q('[data-hero="caption"]'), { y: 10, opacity: 0, duration: b.caption.for, ease: 'power3.out', clearProps: MOVE }, b.caption.at);
  tl.fromTo(
    q('[data-hero="dots"]'),
    { clipPath: 'inset(-10% 100% -10% -10%)' },
    { clipPath: 'inset(-10% -10% -10% -10%)', duration: b.dots.for, ease: 'power2.out', clearProps: 'clipPath' },
    b.dots.at,
  );
  return [tl];
}

function mobileEntrance(root: HTMLElement, cleanups: (() => void)[]): gsap.core.Timeline[] {
  const scope = root.querySelector<HTMLElement>('[data-hero-layout="mobile"]');
  if (!scope) return [];
  const copy = gsap.timeline();
  const header = root.querySelector('[data-hero="header-mobile"]');
  if (header) copy.from(header, { y: -10, opacity: 0, duration: HERO_PHONE_COPY.header.for, ease: 'power3.out', clearProps: MOVE }, HERO_PHONE_COPY.header.at);
  copyMoves(copy, scope, HERO_PHONE_COPY, 18);

  const portrait = scope.querySelector<HTMLElement>('[data-hero="portrait"]');
  if (!portrait) return [copy];
  const b = HERO_PHONE_PHOTO;
  const photo = gsap.timeline({ paused: true, onComplete: () => breathe(portrait.querySelector('[data-hero="glow"]'), portrait, cleanups) });
  photoMoves(photo, portrait, b, 70, 1.2);
  const caption = scope.querySelector('[data-hero="caption"]');
  if (caption) photo.from(caption, { y: 10, opacity: 0, duration: b.caption.for, ease: 'power3.out', clearProps: MOVE }, b.caption.at);

  // Played when the photograph comes into view (just after the copy if it's in view at load),
  // once it's decoded; shown at once if it was scrolled past first. (Timers, observers and
  // promises that act later aren't tracked by gsap.matchMedia, so they're cleaned up here.)
  const ready = photoReady(portrait);
  let atLoad = true;
  let timer = 0;
  let live = true;
  const play = () =>
    void ready.then(() => {
      if (live) photo.play();
    });
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.intersectionRatio >= 0.3) {
        if (atLoad) timer = window.setTimeout(play, PHONE_PHOTO_DELAY * 1000);
        else play();
      } else if (entry.boundingClientRect.top < 0) {
        photo.progress(1);
      } else {
        atLoad = false;
        return;
      }
      observer.disconnect();
    },
    { threshold: [0, 0.3] },
  );
  observer.observe(portrait);
  cleanups.push(() => {
    live = false;
    observer.disconnect();
    window.clearTimeout(timer);
  });
  return [copy, photo];
}

/** Plays the hero's opening once per mount of the homepage. */
export function useHeroEntrance(rootRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let firstRun = true;
    const mm = gsap.matchMedia();
    mm.add({ desktop: '(min-width: 1280px)', motion: '(prefers-reduced-motion: no-preference)' }, (context) => {
      const { desktop, motion } = context.conditions as { desktop: boolean; motion: boolean };
      const initial = firstRun;
      firstRun = false;
      if (!motion || !initial) return;
      const cleanups: (() => void)[] = [];
      const timelines = desktop ? desktopEntrance(root, cleanups) : mobileEntrance(root, cleanups);
      // A keyboard user never waits for (or tabs into) half-arrived content.
      const finish = () => timelines.forEach((timeline) => timeline.progress(1));
      root.addEventListener('focusin', finish);
      return () => {
        root.removeEventListener('focusin', finish);
        cleanups.forEach((cleanup) => cleanup());
      };
    });
    return () => mm.revert();
  }, [rootRef]);
}
