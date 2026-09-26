import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

const TITLE_SUFFIX = 'School of Purpose';

/** Sets document.title for the current screen. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${TITLE_SUFFIX}` : `Purpose Boot Camp · ${TITLE_SUFFIX}`;
  }, [title]);
}

/**
 * On every route change (not hash changes): jump to the top and move focus to the
 * page's visible <h1 data-page-heading> so screen readers announce the new screen.
 * (The landing page has separate mobile/desktop headings; only one is displayed.)
 */
export function RouteEffects() {
  const { pathname, hash } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    // Initial load (and StrictMode's dev-only second run): leave scroll, #anchor and focus to the browser.
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const heading = Array.from(document.querySelectorAll<HTMLElement>('[data-page-heading]')).find(
      (element) => element.getClientRects().length > 0,
    );
    heading?.focus({ preventScroll: true });
    // Deliberately keyed on pathname only: in-page #anchor changes must not jump to the top.
  }, [pathname]);

  return null;
}
