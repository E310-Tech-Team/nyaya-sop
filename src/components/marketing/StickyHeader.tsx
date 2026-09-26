import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The marketing header, kept at the top of the viewport with `position: sticky`. A 1px sentinel
 * at the top of the document tells it when the page has left the top, so it can take its
 * scrolled look (`data-scrolled`); the observer only fires when that changes, never per scroll.
 * While it is on the page, anchor jumps and focus scrolling stop below it (index.css).
 */
export function StickyHeader({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode | ((scrolled: boolean) => ReactNode);
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // A layout effect, so a deep link's first scroll (useInitialHashScroll) already allows for it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-sticky-header', '');
    return () => root.removeAttribute('data-sticky-header');
  }, []);

  return (
    <>
      {/* 1px tall, ending at the top of the page: it only touches the viewport at scroll 0. */}
      <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute -top-px left-0 h-px w-px" />
      <header data-scrolled={scrolled ? '' : undefined} className={`sticky z-40 w-full shrink-0 ${className}`}>
        {typeof children === 'function' ? children(scrolled) : children}
      </header>
    </>
  );
}
