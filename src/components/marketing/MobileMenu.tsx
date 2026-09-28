import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import imgMenuIcon from '../../assets/landing/icon-menu.svg';
import { useInstallState } from '../../lib/install';
import { prefersReducedMotion } from '../../lib/motion';
import { BrandLockup } from '../BrandLockup';
import { CONTACT_LINK, MAIN_NAV } from './nav';

export type MenuState = 'closed' | 'open' | 'closing';

/** Open/close state for the phone and tablet menu (homepage hero and the marketing header). */
export function useMobileMenu() {
  const [state, setState] = useState<MenuState>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const open = useCallback(() => setState('open'), []);
  const requestClose = useCallback((restoreFocus: boolean) => {
    setState((current) => (current !== 'open' ? current : prefersReducedMotion() ? 'closed' : 'closing'));
    // The trigger stays visible behind the closing drawer (in the sticky header), so focus can
    // return immediately, without scrolling the page.
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const onClosed = useCallback(() => setState('closed'), []);
  return { state, open, requestClose, onClosed, buttonRef };
}

export type MobileMenuControls = ReturnType<typeof useMobileMenu>;

/** The round menu button in the phone and tablet headers. */
export function MenuButton({ menu }: { menu: MobileMenuControls }) {
  return (
    <button
      ref={menu.buttonRef}
      type="button"
      aria-label="Open menu"
      aria-expanded={menu.state === 'open'}
      aria-controls="mobile-menu"
      onClick={menu.open}
      className="border border-white flex flex-col items-center justify-center overflow-clip rounded-[999px] shrink-0 size-[44px]"
    >
      <img alt="" aria-hidden="true" className="block max-w-none size-[18px]" src={imgMenuIcon} />
    </button>
  );
}

/**
 * After an in-page link in the menu (Contact), the link disappears with the menu: move focus to
 * the destination's heading so keyboard and screen-reader users continue from there.
 */
function focusSection(href: string) {
  const target = document.getElementById(decodeURIComponent(href.slice(1)));
  if (!target) return;
  const heading = Array.from(target.querySelectorAll<HTMLElement>('h1, h2')).find((h) => h.getClientRects().length > 0);
  const focusTarget = heading ?? target;
  if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
  focusTarget.focus({ preventScroll: true });
}

const itemClass =
  'block border-b border-white/10 pb-[16px] font-sans text-[16px] font-semibold text-white aria-[current=page]:text-gold-light';

/** The drawer itself. Renders nothing while closed. */
export function MobileMenu({ menu }: { menu: MobileMenuControls }) {
  if (menu.state === 'closed') return null;
  return <MenuDrawer closing={menu.state === 'closing'} onRequestClose={menu.requestClose} onClosed={menu.onClosed} />;
}

function MenuDrawer({
  closing,
  onRequestClose,
  onClosed,
}: {
  closing: boolean;
  onRequestClose: (restoreFocus: boolean) => void;
  onClosed: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const { standalone } = useInstallState();

  // Lock page scrolling from opening until the menu has fully gone.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // The drawer is hidden from 1280px (xl). If the viewport grows past that while it's open (a
  // resized window, a rotated tablet), close it at once so no hidden menu keeps the scroll lock.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1280px)');
    const onChange = () => {
      if (wide.matches) onClosed();
    };
    onChange();
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [onClosed]);

  // Focus the close button whenever the menu (re)opens, including when it's reopened mid-close.
  // preventScroll: the panel starts off-screen, and scrolling it into view would cancel the slide.
  useEffect(() => {
    if (!closing) panelRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [closing]);

  // Escape + focus trap while open (not while the exit plays).
  useEffect(() => {
    if (closing) return;
    const panel = panelRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onRequestClose(true);
      if (event.key !== 'Tab' || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>('a[href], button');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closing, onRequestClose]);

  // Unmount once the panel has slid out (transitions, so reopening mid-close just reverses);
  // the fallback covers reduced motion or a transition that never reports.
  useEffect(() => {
    if (!closing) return;
    const panel = panelRef.current;
    const onEnd = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === 'translate') onClosed();
    };
    panel?.addEventListener('transitionend', onEnd);
    const fallback = window.setTimeout(onClosed, 400);
    return () => {
      panel?.removeEventListener('transitionend', onEnd);
      window.clearTimeout(fallback);
    };
  }, [closing, onClosed]);

  // Another page: close; the new page's heading takes focus (RouteEffects).
  // This page: close, return focus to the menu button and go back to the top.
  const onNavigate = (to: string) => {
    if (to === pathname) {
      onRequestClose(true);
      window.scrollTo({ top: 0 });
    } else {
      onRequestClose(false);
    }
  };

  const state = closing ? 'closing' : 'open';
  return (
    <div id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu" inert={closing} className="clip-overflow fixed inset-0 z-50 flex xl:hidden">
      <div aria-hidden="true" data-state={state} className="drawer-backdrop absolute inset-0 bg-black/50" onClick={() => onRequestClose(true)} />
      {/* Scrolls on its own when taller than the screen (short phones, landscape). */}
      <div ref={panelRef} data-state={state} className="drawer-panel on-dark relative ml-auto flex h-full w-[280px] flex-col gap-[32px] overflow-y-auto overscroll-contain bg-[#5c1329] px-8 pt-[60px] shadow-2xl">
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => onRequestClose(true)}
          className="absolute right-4 top-4 flex size-[44px] items-center justify-center text-[28px] leading-none text-white"
        >
          <span aria-hidden="true">&times;</span>
        </button>
        <BrandLockup on="dark" className="h-[56px]" />
        <nav aria-label="Main">
          <ul className="flex flex-col gap-[24px]">
            {MAIN_NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end onClick={() => onNavigate(item.to)} className={itemClass}>
                  {item.label}
                </NavLink>
              </li>
            ))}
            {CONTACT_LINK && (
              <li>
                <a
                  href={CONTACT_LINK.href}
                  onClick={() => {
                    const href = CONTACT_LINK?.href ?? '#contact';
                    onRequestClose(false);
                    // After the browser's own fragment navigation, which would otherwise clear it.
                    window.setTimeout(() => focusSection(href), 0);
                  }}
                  className={itemClass}
                >
                  {CONTACT_LINK.label}
                </a>
              </li>
            )}
          </ul>
        </nav>
        <div className="mt-auto mb-[48px] flex flex-col gap-[16px]">
          {!standalone && (
            <NavLink
              to="/install"
              end
              onClick={() => onNavigate('/install')}
              className="self-start font-sans text-[14px] font-semibold text-[#f3dce3] underline underline-offset-4 aria-[current=page]:text-gold-light"
            >
              Install the app
            </NavLink>
          )}
          <Link
            to="/apply"
            className="block w-full rounded-[8px] bg-white py-[14px] text-center font-sans text-[13px] font-bold uppercase tracking-[0.8px] text-[#841d26]"
          >
            Apply Now
          </Link>
        </div>
      </div>
    </div>
  );
}
