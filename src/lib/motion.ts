/**
 * Motion helpers. Timing/distance tokens live in src/index.css (:root); the stagger values
 * are mirrored here for the scroll-reveal hook. See docs/04-UI-UX-Design-Brief.md §6.
 */
import { useLayoutEffect, type CSSProperties, type RefObject } from 'react';

export const MOTION = {
  /** Delay between items of a group that appears together (50–80ms). */
  staggerStepMs: 60,
  /** No visible group waits longer than this for its last item. */
  staggerCapMs: 240,
  /** Companions (e.g. journey route lines) follow the element they belong to by this much. */
  followOffsetMs: 120,
  /** FAQ answers open/close (220–280ms). */
  disclosureMs: 260,
} as const;

const REDUCED = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED).matches === true;
}

/** Delay for the nth item of a group, capped so no group drags on. */
export const staggerDelay = (index: number): number =>
  Math.min(Math.max(0, index) * MOTION.staggerStepMs, MOTION.staggerCapMs);

/** Style for a CSS entrance class (.enter-up, .form-enter, …) at step n of a short sequence. */
export const enterStep = (step: number): CSSProperties => ({ '--enter-delay': `${staggerDelay(step)}ms` }) as CSSProperties;

/** Style for a CSS entrance class that starts after a fixed pause (for choreographed sequences). */
export const enterAfter = (ms: number): CSSProperties => ({ '--enter-delay': `${ms}ms` }) as CSSProperties;

const inDocumentOrder = (a: Element, b: Element) =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

const isRule = (element: HTMLElement) => element.dataset.reveal?.startsWith('rule') === true;

/**
 * Reveals `[data-reveal]` descendants of `rootRef` once per mount, as they approach the viewport.
 *
 * - **Items** are observed one by one; items arriving together are staggered in reading order
 *   (capped at 240ms), and decorative rules ride just behind the content they belong to.
 * - **Groups** (`data-reveal-group`, optionally limited to a media query such as
 *   `(min-width: 1280px)`) choreograph a whole composition: when the group reaches the upper
 *   two-thirds of the viewport its members play on their authored timeline (`data-reveal-at`,
 *   in ms; otherwise the stagger), independent of how the observer batches them.
 * - **Companions** (`data-reveal-with="id"`) follow the element with `data-reveal-id="id"`,
 *   `data-reveal-at` ms later (default 120ms).
 * - Content is only hidden once this hook has armed the page (`data-reveal-armed`), so a
 *   failure leaves everything visible. Anything already above the viewport (anchor jump, fast
 *   scroll, returning to a scrolled page) and anything that receives keyboard focus is shown
 *   instantly. Reduced motion, including switching to it while the page is open, shows
 *   everything at once.
 * - Elements in a display:none layout tree never intersect, so hidden duplicates don't animate.
 */
export function useScrollReveal(rootRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const pending = (scope: ParentNode = root) =>
      Array.from(scope.querySelectorAll<HTMLElement>('[data-reveal]:not([data-revealed])'));
    const showAll = () => pending().forEach((element) => element.setAttribute('data-revealed', ''));

    const reducedQuery = window.matchMedia?.(REDUCED);
    if (reducedQuery?.matches || typeof IntersectionObserver !== 'function') {
      showAll();
      return;
    }

    let observers: IntersectionObserver[] = [];
    let activeGroups = new Set<HTMLElement>();
    const groupQueries: MediaQueryList[] = [];

    const reveal = (element: HTMLElement, delayMs: number, instant = false) => {
      if (element.hasAttribute('data-revealed')) return;
      element.style.setProperty('--reveal-delay', `${instant ? 0 : delayMs}ms`);
      if (instant) element.setAttribute('data-reveal-instant', '');
      element.setAttribute('data-revealed', '');
      for (const observer of observers) observer.unobserve(element);
      const id = element.dataset.revealId;
      if (!id) return;
      root.querySelectorAll<HTMLElement>(`[data-reveal-with="${id}"]`).forEach((companion) => {
        reveal(companion, delayMs + Number(companion.dataset.revealAt ?? MOTION.followOffsetMs), instant);
      });
    };

    /** The closest group that is active at the current breakpoint, if any. */
    const groupOf = (element: HTMLElement): HTMLElement | null => {
      for (
        let group = element.parentElement?.closest<HTMLElement>('[data-reveal-group]');
        group && root.contains(group);
        group = group.parentElement?.closest<HTMLElement>('[data-reveal-group]')
      ) {
        if (activeGroups.has(group)) return group;
      }
      return null;
    };

    const playGroup = (group: HTMLElement, instant = false) => {
      for (const observer of observers) observer.unobserve(group);
      pending(group)
        .filter((element) => !element.dataset.revealWith && groupOf(element) === group)
        .forEach((element, index) => reveal(element, Number(element.dataset.revealAt ?? staggerDelay(index)), instant));
    };

    const arm = () => {
      activeGroups = new Set(
        Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-group]')).filter((group) => {
          const media = group.dataset.revealGroup;
          return !media || window.matchMedia(media).matches;
        }),
      );

      // Items one by one: content takes the stagger slots; rules ride one step behind the
      // element they follow, so they never push real content back.
      const items = new IntersectionObserver(
        (entries) => {
          const entering = entries
            .filter((entry) => entry.isIntersecting)
            .map((entry) => entry.target as HTMLElement)
            .sort(inDocumentOrder);
          let slot = -1;
          let lastDelay = 0;
          for (const element of entering) {
            if (isRule(element)) {
              reveal(element, Math.min(lastDelay + MOTION.staggerStepMs, MOTION.staggerCapMs));
            } else {
              lastDelay = staggerDelay(++slot);
              reveal(element, lastDelay);
            }
          }
        },
        // Start a little before the element is fully in view; the bottom inset avoids
        // revealing things the reader can barely see.
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      );

      // Groups start once their top reaches the upper two-thirds of the viewport, so the
      // composition plays where it can be seen rather than below the fold.
      const groups = new IntersectionObserver(
        (entries) => entries.filter((entry) => entry.isIntersecting).forEach((entry) => playGroup(entry.target as HTMLElement)),
        { rootMargin: '0px 0px -35% 0px' },
      );

      // Anything entirely or partly above the viewport has been scrolled past (or jumped
      // over): show it at once instead of queueing an entrance nobody will see.
      const passed = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const target = entry.target as HTMLElement;
            if (target.hasAttribute('data-reveal-group')) playGroup(target, true);
            else reveal(target, 0, true);
          }
        },
        { rootMargin: '100000px 0px -100% 0px' },
      );

      observers = [items, groups, passed];
      for (const group of activeGroups) {
        if (pending(group).length === 0) continue;
        groups.observe(group);
        passed.observe(group);
      }
      for (const element of pending()) {
        if (element.dataset.revealWith || groupOf(element)) continue; // revealed with their lead / group
        items.observe(element);
        passed.observe(element);
      }
    };

    const disarm = () => {
      for (const observer of observers) observer.disconnect();
      observers = [];
    };

    try {
      arm();
      root.setAttribute('data-reveal-armed', '');
    } catch {
      disarm();
      showAll();
      return;
    }

    // Crossing a breakpoint can switch a group on or off: re-arm what is still pending.
    const rearm = () => {
      disarm();
      arm();
    };
    for (const group of root.querySelectorAll<HTMLElement>('[data-reveal-group]')) {
      if (!group.dataset.revealGroup) continue;
      const query = window.matchMedia(group.dataset.revealGroup);
      query.addEventListener?.('change', rearm);
      groupQueries.push(query);
    }

    // Switching to reduced motion while the page is open shows everything immediately.
    const onReducedChange = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      disarm();
      showAll();
    };
    reducedQuery?.addEventListener?.('change', onReducedChange);

    // Tabbing into a not-yet-revealed element shows it (and its group's timeline) at once.
    const onFocusIn = (event: FocusEvent) => {
      let element = (event.target as Element | null)?.closest<HTMLElement>('[data-reveal]:not([data-revealed])');
      while (element) {
        const group = groupOf(element);
        if (group) playGroup(group, true);
        reveal(element, 0, true);
        element = element.parentElement?.closest<HTMLElement>('[data-reveal]:not([data-revealed])') ?? null;
      }
    };
    root.addEventListener('focusin', onFocusIn);

    return () => {
      disarm();
      for (const query of groupQueries) query.removeEventListener?.('change', rearm);
      reducedQuery?.removeEventListener?.('change', onReducedChange);
      root.removeEventListener('focusin', onFocusIn);
      root.removeAttribute('data-reveal-armed');
    };
  }, [rootRef]);
}

/**
 * Smoothly opens or closes a <details> disclosure by animating the height and opacity of its
 * content panel. Starts from wherever the panel is (so rapid toggles reverse smoothly), keeps
 * the native `open` state and semantics, and leaves no measured styles behind. Returns false
 * when the caller should let the browser toggle natively (reduced motion, no WAAPI).
 */
export function animateDisclosure(details: HTMLDetailsElement, panel: HTMLElement, open: boolean): boolean {
  if (prefersReducedMotion() || typeof panel.animate !== 'function') return false;
  const running = panel.getAnimations().filter((animation) => animation.id === 'disclosure');
  // Current rendered size and opacity, mid-animation included.
  const fromHeight = details.open ? panel.getBoundingClientRect().height : 0;
  const fromOpacity = details.open ? Number(getComputedStyle(panel).opacity) : 0;
  for (const animation of running) animation.cancel();
  if (open) details.open = true;
  const toHeight = open ? panel.scrollHeight : 0;
  const animation = panel.animate(
    [
      { height: `${fromHeight}px`, opacity: fromOpacity, overflow: 'hidden' },
      { height: `${toHeight}px`, opacity: open ? 1 : 0, overflow: 'hidden' },
    ],
    {
      id: 'disclosure',
      duration: open ? MOTION.disclosureMs : MOTION.disclosureMs - 40,
      easing: open ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards',
    },
  );
  animation.onfinish = () => {
    // Close and drop the held end frame together, so the full answer never flashes back.
    if (!open) details.open = false;
    animation.cancel();
  };
  return true;
}
