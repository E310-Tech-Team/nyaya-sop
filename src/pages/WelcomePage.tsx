import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PrimaryButton } from '../components/Buttons';
import { FieldError } from '../components/Fields';
import { usePageTitle } from '../components/RouteEffects';
import { SiteHeader } from '../components/SiteHeader';
import { WELCOME_GROUPS } from '../config/programme';
import { site } from '../config/site';
import { getCurrentCohort } from '../lib/api';
import { CONSENT_STATEMENT } from '../shared/application';
import { useApplication } from '../state/application';

const groupId = (title: string) => `welcome-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;

type CohortStatus = 'loading' | 'open' | 'closed' | 'unknown';

/** Asks the API whether applications are open. Fails open: the server re-checks on submit. */
function useCohortStatus(): CohortStatus {
  const [status, setStatus] = useState<CohortStatus>('loading');
  useEffect(() => {
    const controller = new AbortController();
    getCurrentCohort(controller.signal)
      .then(({ cohort }) => setStatus(cohort?.isAcceptingApplications ? 'open' : 'closed'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unknown');
      });
    return () => controller.abort();
  }, []);
  return status;
}

export default function WelcomePage() {
  usePageTitle('Apply');
  const navigate = useNavigate();
  const { draft, setConsent } = useApplication();
  const [attempted, setAttempted] = useState(false);
  const cohortStatus = useCohortStatus();
  const showError = attempted && !draft.consent;

  function start(event: FormEvent) {
    event.preventDefault();
    if (!draft.consent) {
      setAttempted(true);
      document.getElementById('consent')?.focus();
      return;
    }
    navigate('/apply/personal');
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-cream">
      <SiteHeader />
      <main id="main" className="w-full">
        {/* One brief entrance with no delays: the facts, consent box and button are there at once. */}
        <div className="form-enter mx-auto flex w-full max-w-[880px] flex-col gap-[26px] px-6 pb-12 pt-8 sm:px-10 md:gap-[34px] md:py-[64px]">
          <div className="flex w-full flex-col gap-[10px] md:gap-[14px]">
            <h1 data-page-heading tabIndex={-1} className="font-display text-[36px] leading-[1.04] text-brand outline-none md:text-[48px]">
              Welcome to the School of Purpose Boot Camp
            </h1>
            <p className="font-sans text-[15px] leading-[1.5] text-muted md:text-[16px]">Before you begin, here is what to know.</p>
          </div>

          <div className="flex w-full flex-col border-y border-line">
            {WELCOME_GROUPS.map((group, index) => (
              <section
                key={group.title}
                aria-labelledby={groupId(group.title)}
                className={`flex flex-col gap-[10px] py-[18px] md:flex-row md:gap-[28px] md:py-[22px] ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <h2
                  id={groupId(group.title)}
                  className="font-sans text-[12px] font-extrabold uppercase leading-[1.4] tracking-[1.6px] text-brand md:w-[190px] md:shrink-0 md:pt-[4px]"
                >
                  {group.title}
                </h2>
                <ul className="flex flex-1 flex-col gap-[10px]">
                  {group.items.map((text) => (
                    <li key={text} className="flex items-start gap-[12px] font-sans text-[15px] leading-[1.55] text-ink md:text-[16px]">
                      <span aria-hidden="true" className="mt-[9px] size-[6px] shrink-0 rounded-full bg-brand md:mt-[10px]" />
                      {text}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {cohortStatus === 'closed' ? (
            <div
              role="status"
              className="flex w-full flex-col gap-3 rounded-[16px] border border-line bg-white p-[20px] shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] md:p-[24px]"
            >
              <p className="font-sans text-[16px] font-extrabold text-ink">Applications are currently closed</p>
              <p className="font-sans text-[15px] leading-[1.6] text-muted">
                Thank you for your interest in the Purpose Boot Camp. Applications for this cohort are not being accepted
                right now; please check back for the next cohort.
              </p>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={start}
              className="flex w-full flex-col items-start gap-[16px] rounded-[16px] border border-line bg-white p-[20px] shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] md:gap-[18px] md:p-[24px]"
            >
              <p className="font-sans text-[14px] font-extrabold text-ink">
                Confirm your readiness{' '}
                <span className="font-sans text-[12px] font-bold text-brand">* Required</span>
              </p>
              <label
                htmlFor="consent"
                className={`flex w-full cursor-pointer items-start gap-[12px] rounded-[6px] border px-[14px] py-[15px] text-left transition-[border-color,background-color] duration-(--duration-form) has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-brand md:gap-[14px] ${
                  draft.consent
                    ? 'border-brand bg-[rgba(132,29,38,0.06)]'
                    : showError
                      ? 'border-[#c9546f] bg-[rgba(132,29,38,0.04)]'
                      : 'border-line-strong bg-cream hover:border-brand'
                }`}
              >
                <input
                  id="consent"
                  type="checkbox"
                  checked={draft.consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    setAttempted(false);
                  }}
                  required
                  aria-invalid={showError || undefined}
                  aria-describedby={showError ? 'consent-error' : undefined}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`relative mt-[1px] size-[21px] shrink-0 rounded-[4px] border-[1.5px] border-brand transition-colors duration-(--duration-form) ${
                    draft.consent ? 'bg-brand' : 'bg-white'
                  }`}
                >
                  <svg
                    className={`absolute inset-0 m-auto transition-[opacity,scale] duration-(--duration-form) ${draft.consent ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}
                    width="12"
                    height="9"
                    viewBox="0 0 12 9"
                    fill="none"
                  >
                    <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="flex-1 font-sans text-[15px] font-semibold leading-[1.5] text-ink">{CONSENT_STATEMENT}</span>
              </label>
              <FieldError id="consent-error" message={showError ? 'Tick the box to confirm before you continue' : undefined} />
              <div className="flex w-full flex-col items-stretch gap-[12px] sm:flex-row sm:items-center sm:gap-[20px]">
                <PrimaryButton type="submit" className={`w-full sm:w-auto sm:min-w-[260px] ${draft.consent ? '' : 'opacity-80'}`}>
                  Get Started
                </PrimaryButton>
                <p className="flex items-center justify-center gap-[7px] font-sans text-[13px] font-semibold text-muted">
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-[15px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6.75" />
                    <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  About {site.minutesToComplete} minutes
                </p>
              </div>
            </form>
          )}
          {site.contactEmail && (
            <p className="font-sans text-[14px] leading-[1.55] text-muted">
              Questions before you apply? Email{' '}
              <a className="font-bold text-brand underline underline-offset-4" href={`mailto:${site.contactEmail}`}>
                {site.contactEmail}
              </a>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
