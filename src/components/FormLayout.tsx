import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { SAVED_PROGRESS_NOTE } from '../config/programme';
import { usePublicConfig } from '../lib/config';
import { progressLabel, stepForPath, stepIndex, stepState, type StepState } from '../lib/progress';
import { STEPS, type StepKey } from '../state/application';
import { SiteHeader } from './SiteHeader';

const STEP_COPY: Record<StepKey, { eyebrow: string; title: string; subtitle: string }> = {
  personal: {
    eyebrow: 'Step 1 of 3',
    title: 'Your purpose journey begins here.',
    subtitle: 'Take your time. Thoughtful, honest answers help us understand how best to support your formation.',
  },
  education: {
    eyebrow: 'Step 2 of 3',
    title: 'Education & Career',
    subtitle: 'Share your highest level of education and current status so we can better understand your context.',
  },
  purpose: {
    eyebrow: 'Step 3 of 3',
    title: 'Purpose & Self-Discovery',
    subtitle: 'Reflect on what you know about yourself today—and where you are seeking greater clarity for tomorrow.',
  },
  review: {
    eyebrow: 'Final check',
    title: 'Almost there.',
    subtitle: 'Check your answers before you submit. You can edit any section.',
  },
};

// Progress markers change state as the applicant moves between steps (the layout stays mounted).
const stateTransition = 'transition-[background-color,border-color,color] duration-(--duration-form)';

function StepMarker({ state, number, compact = false }: { state: StepState; number: number; compact?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex ${compact ? 'size-[24px]' : 'size-[28px]'} shrink-0 items-center justify-center rounded-full border ${stateTransition} ${
        state === 'done'
          ? 'border-gold bg-gold'
          : state === 'active'
            ? 'border-white/40 bg-white'
            : 'border-white/40 bg-transparent'
      }`}
    >
      <span
        className={`font-sans text-[11px] font-extrabold ${stateTransition} ${
          state === 'done' ? 'text-brand-deep' : state === 'active' ? 'text-brand' : 'text-white'
        }`}
      >
        {state === 'done' ? '✓' : number}
      </span>
    </span>
  );
}

const stateLabel = { done: 'completed', active: 'current step', upcoming: 'not started' } as const;

/**
 * Phones and tablets: one compact row under the header ("Step 1 of 3 / Personal Information"
 * with done ✓, current and upcoming markers). Not sticky, so it never covers inputs, errors
 * or the on-screen keyboard.
 */
function MobileProgress({ step }: { step: StepKey }) {
  const current = stepIndex(step);
  const { eyebrow, title } = progressLabel(step);
  return (
    <nav
      aria-label="Application progress"
      className="on-dark flex w-full shrink-0 items-center gap-[14px] border-t border-white/10 bg-brand px-6 py-[12px] sm:px-10 lg:hidden"
    >
      <p className="order-2 min-w-0 font-sans leading-[1.3]">
        <span className="block text-[10px] font-bold uppercase tracking-[1.4px] text-gold-light">{eyebrow}</span>
        <span className="block text-[14px] font-bold text-white">{title}</span>
      </p>
      <ol className="order-1 flex shrink-0 items-center">
        {STEPS.map((s, i) => {
          const state = stepState(i, current);
          return (
            <li key={s.key} aria-current={state === 'active' ? 'step' : undefined} className="flex items-center">
              {i > 0 && (
                <span aria-hidden="true" className={`mx-[4px] h-px w-[10px] ${stateTransition} ${i <= current ? 'bg-gold' : 'bg-white/30'}`} />
              )}
              <StepMarker state={state} number={i + 1} compact />
              <span className="sr-only">
                {s.label} ({stateLabel[state]})
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SidePanel({ step }: { step: StepKey }) {
  const copy = STEP_COPY[step];
  const current = stepIndex(step);
  return (
    <aside className="on-dark hidden w-[356px] shrink-0 flex-col justify-between bg-brand pb-[48px] pl-[52px] pr-[40px] pt-[56px] lg:flex">
      <div className="flex w-full flex-col gap-[38px]">
        <div className="flex w-full flex-col gap-[12px]">
          <div className="flex items-center gap-[10px]">
            <span aria-hidden="true" className="h-px w-[32px] bg-gold" />
            <p className="whitespace-nowrap font-sans text-[11px] font-bold uppercase tracking-[2px] text-gold-light">
              {copy.eyebrow}
            </p>
          </div>
          <p className="font-display text-[33px] leading-[1.06] text-white">{copy.title}</p>
          <p className="font-sans text-[13px] leading-[1.55] text-rose">{copy.subtitle}</p>
        </div>
        <nav aria-label="Application progress">
          <ol className="flex w-full flex-col">
            {STEPS.map((s, i) => {
              const state = stepState(i, current);
              return (
                <li
                  key={s.key}
                  aria-current={state === 'active' ? 'step' : undefined}
                  className={`flex w-full items-center gap-[12px] rounded-[10px] px-[10px] py-[11px] ${stateTransition} ${
                    state === 'active' ? 'bg-white/[0.07]' : 'bg-transparent'
                  }`}
                >
                  <StepMarker state={state} number={i + 1} />
                  <p
                    className={`font-sans text-[13px] leading-[1.25] ${stateTransition} ${
                      state === 'active' ? 'font-bold text-white' : 'font-medium text-rose/80'
                    }`}
                  >
                    {s.label}
                    <span className="sr-only"> ({stateLabel[state]})</span>
                  </p>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      <figure className="flex w-full flex-col gap-[8px] border-t border-white/[0.17] pt-[18px]">
        <figcaption className="font-sans text-[10px] font-bold uppercase tracking-[1.6px] text-gold-light">
          A guided reflection
        </figcaption>
        <blockquote className="font-sans text-[17px] font-semibold italic leading-[1.35] text-white">
          “Purpose precedes production. You were made for an assignment.”
        </blockquote>
      </figure>
    </aside>
  );
}

/**
 * Layout route for the three steps and the review screen. The header and progress stay
 * mounted (and visually steady) between steps; only the step content, keyed by URL, gets a
 * brief entrance. Navigation is never delayed and the old step unmounts immediately.
 */
export function ApplicationLayout() {
  const { pathname } = useLocation();
  // Loaded here so the Personal step knows straight away whether the parish question uses the directory.
  usePublicConfig();
  const step = stepForPath(pathname);
  return (
    <div className="flex min-h-screen w-full flex-col bg-cream">
      <SiteHeader />
      <MobileProgress step={step} />
      <div className="flex w-full flex-1 items-stretch">
        <SidePanel step={step} />
        <main
          id="main"
          className="flex min-w-0 flex-1 flex-col items-center bg-cream px-6 pb-12 pt-7 sm:px-10 sm:pt-9 lg:px-[72px] lg:pb-[48px] lg:pt-[54px]"
        >
          <div key={pathname} className="form-enter flex w-full flex-col items-center gap-[24px] lg:gap-[28px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Section label, page heading (focused on navigation) and intro for a step. */
export function StepHeader({
  sectionLabel,
  heading,
  intro,
  showRequiredNote = true,
}: {
  sectionLabel: string;
  heading: string;
  intro: string;
  showRequiredNote?: boolean;
}) {
  return (
    <div className="flex w-full max-w-[840px] flex-col gap-[8px] md:flex-row md:items-end md:justify-between lg:gap-[10px]">
      <div className="flex flex-col gap-[8px] lg:gap-[10px]">
        {/* On small screens the progress row above already names the section. */}
        <p className="hidden font-sans text-[11px] font-extrabold uppercase tracking-[2px] text-brand lg:block">{sectionLabel}</p>
        <h1
          data-page-heading
          tabIndex={-1}
          className="font-display text-[32px] leading-[1.05] tracking-[0.3px] text-ink outline-none md:text-[46px]"
        >
          {heading}
        </h1>
        <p className="max-w-[640px] font-sans text-[14px] leading-[1.55] text-muted">{intro}</p>
      </div>
      {showRequiredNote && (
        <p className="shrink-0 whitespace-nowrap font-sans text-[12px] font-semibold text-muted md:ml-4">
          <span className="text-brand" aria-hidden="true">
            *
          </span>{' '}
          Required
        </p>
      )}
    </div>
  );
}

/** White card that holds a step's questions. */
export function FormCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex w-full max-w-[840px] flex-col items-start rounded-[16px] border border-line bg-white px-5 py-5 shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] md:px-[38px] md:py-[34px] ${className}`}
    >
      {children}
    </div>
  );
}

export const Divider = () => <div aria-hidden="true" className="h-px w-full bg-line opacity-65" />;

/** Where answers are kept: sessionStorage, per tab (src/lib/storage.ts). */
export function SavedNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center gap-[8px] font-sans text-[12px] font-semibold leading-[1.4] text-muted ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6.75" />
        <path d="M5.2 8.2 7.1 10l3.7-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {SAVED_PROGRESS_NOTE}
    </p>
  );
}

/** Button row under the card, with the saved-answers note. */
export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-[840px] flex-col gap-[14px] pt-[4px]">
      {children}
      <SavedNote className="justify-center md:justify-start" />
    </div>
  );
}
