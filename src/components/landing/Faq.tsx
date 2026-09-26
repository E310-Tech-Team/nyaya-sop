import { useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { type FaqEntry } from '../../config/programme';
import { site } from '../../config/site';
import { animateDisclosure } from '../../lib/motion';

/**
 * One question. Native <details>/<summary> (keyboard, expanded state and find-in-page come
 * from the browser); the answer panel's height and opacity are animated on top, starting from
 * wherever it is, so rapid toggles reverse smoothly instead of snapping.
 */
export function FaqItem({ question, answer }: FaqEntry) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Drives the +/× indicator. It follows the intended state at once, so it turns with the
  // opening or closing rather than after it.
  const [expanded, setExpanded] = useState(false);

  function onSummaryClick(event: MouseEvent<HTMLElement>) {
    const details = detailsRef.current;
    const panel = panelRef.current;
    if (!details || !panel) return;
    const next = !expanded;
    // Reduced motion or no Web Animations: let the browser toggle natively.
    if (!animateDisclosure(details, panel, next)) return;
    event.preventDefault();
    setExpanded(next);
  }

  // Keeps the indicator right when the browser toggles on its own (find-in-page, reduced
  // motion). While an animation runs, the intended state is already set.
  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const animating = panelRef.current?.getAnimations().some((animation) => animation.id === 'disclosure');
    if (!animating) setExpanded(event.currentTarget.open);
  }

  return (
    <details ref={detailsRef} data-state={expanded ? 'open' : 'closed'} onToggle={onToggle} className="group border-b border-line">
      <summary
        onClick={onSummaryClick}
        className="flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-[16px] py-[16px] font-sans text-[16px] font-bold leading-[1.4] text-ink xl:text-[17px] [&::-webkit-details-marker]:hidden"
      >
        {question}
        <span
          aria-hidden="true"
          className="flex size-[32px] shrink-0 items-center justify-center rounded-full border border-brand/40 text-brand transition-[rotate,background-color,border-color,color] duration-[240ms] group-data-[state=open]:rotate-45 group-data-[state=open]:border-brand group-data-[state=open]:bg-brand group-data-[state=open]:text-white"
        >
          <svg viewBox="0 0 12 12" className="size-[12px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 1v10M1 6h10" />
          </svg>
        </span>
      </summary>
      {/* The animated panel: no padding of its own, so its height can run to zero. */}
      <div ref={panelRef}>
        <p className="max-w-[68ch] pb-[20px] pr-[8px] font-sans text-[15px] leading-[1.6] text-muted sm:pr-[48px]">{answer}</p>
      </div>
    </details>
  );
}

/** "Still have a question?" line: only when a contact email is configured. */
export function FaqContact({ className = '' }: { className?: string }) {
  if (!site.contactEmail) return null;
  return (
    <p className={`font-sans text-[14px] leading-[1.55] text-ink xl:text-[15px] ${className}`}>
      Still have a question? Email{' '}
      <a className="font-bold text-brand underline underline-offset-4" href={`mailto:${site.contactEmail}`}>
        {site.contactEmail}
      </a>
    </p>
  );
}

/** A list of questions (native disclosures) under a top rule. */
export function FaqList({ entries }: { entries: readonly FaqEntry[] }) {
  return (
    <div className="w-full min-w-0 border-t border-line">
      {entries.map((entry) => (
        <FaqItem key={entry.question} {...entry} />
      ))}
    </div>
  );
}
