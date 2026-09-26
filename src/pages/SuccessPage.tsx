import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import imgAccentCircleInverse from '../assets/success/accent-circle-inverse.svg';
import imgAccentCircleLg from '../assets/success/accent-circle-lg.svg';
import imgAccentCircle from '../assets/success/accent-circle.svg';
import imgBlobBottomLeft from '../assets/success/blob-bottom-left.svg';
import imgBlobBottomRight from '../assets/success/blob-bottom-right.svg';
import imgBlobTopLeft from '../assets/success/blob-top-left.svg';
import imgBlobTopRight from '../assets/success/blob-top-right.svg';
import imgSideGlow from '../assets/success/glow-side.svg';
import imgTopGlow from '../assets/success/glow-top.svg';
import imgClipboard from '../assets/success/icon-clipboard.svg';
import imgMail from '../assets/success/icon-mail.svg';
import imgUsers from '../assets/success/icon-users.svg';
import imgPortraitHalo from '../assets/success/portrait-halo.svg';
import imgStudent from '../assets/success/student-portrait.webp';
import { PrimaryLink } from '../components/Buttons';
import { NotificationCard } from '../components/notifications/NotificationCard';
import { usePageTitle } from '../components/RouteEffects';
import { SiteHeader } from '../components/SiteHeader';
import { site } from '../config/site';
import { copyText } from '../lib/clipboard';
import { usePublicConfig } from '../lib/config';
import { enterAfter, staggerDelay } from '../lib/motion';
import { useApplication } from '../state/application';

const NEXT_STEPS = [
  { badge: '01', icon: imgClipboard, title: 'Application review', desc: 'The Programme team will read your responses with care.', highlight: false },
  { badge: '02', icon: imgMail, title: 'Email update', desc: 'Watch your inbox for an update after the review is complete.', highlight: true },
  { badge: '03', icon: imgUsers, title: 'Next-cohort details', desc: 'If selected, your email will include virtual training details.', highlight: false },
];

const CONFETTI = [
  { left: 32, top: 19, bg: '#e8425a', rotate: -38, w: 14, h: 6 },
  { left: 53, top: 14, bg: '#f5a623', rotate: 22, w: 10, h: 4 },
  { left: 12, top: 52, bg: '#4a90d9', rotate: 45, w: 8, h: 8 },
  { left: 74, top: 35, bg: '#7ed321', rotate: -15, w: 12, h: 5 },
  { left: 128, top: 5, bg: '#f8e71c', rotate: -55, w: 16, h: 5 },
];

/** Choreography for the confirmation, in ms. Everything is one-shot and finishes in about a second. */
const T = { portrait: 60, decorations: 120, check: 240, nextHeading: 300, cards: 360, home: 540 } as const;

function Decorations() {
  return (
    <div aria-hidden="true" className="enter-fade pointer-events-none absolute inset-0 hidden overflow-hidden lg:block" style={enterAfter(T.decorations)}>
      <img alt="" src={imgBlobTopLeft} className="absolute" style={{ left: -140, top: -80, width: 380, height: 380 }} />
      <img alt="" src={imgBlobBottomLeft} className="absolute" style={{ left: -100, top: 900, width: 300, height: 300 }} />
      <img alt="" src={imgBlobTopRight} className="absolute" style={{ right: -140, top: -60, width: 320, height: 320 }} />
      <img alt="" src={imgBlobBottomRight} className="absolute" style={{ right: -80, bottom: 0, width: 240, height: 240 }} />
      {CONFETTI.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-[1px] opacity-70"
          style={{ left: p.left, top: p.top, width: p.w, height: p.h, background: p.bg, transform: `rotate(${p.rotate}deg)` }}
        />
      ))}
      <span className="absolute rounded-[1px] opacity-70" style={{ right: 166, top: 24, width: 14, height: 6, background: '#4a90d9', transform: 'rotate(42deg)' }} />
      <span className="absolute rounded-[1px] opacity-70" style={{ right: 122, top: 43, width: 10, height: 4, background: '#f5a623', transform: 'rotate(-20deg)' }} />
      <span className="absolute rounded-[1px] opacity-70" style={{ right: 60, top: 60, width: 12, height: 5, background: '#7ed321', transform: 'rotate(15deg)' }} />
      <span className="absolute rounded-[2px] opacity-55" style={{ right: 50, top: 4, width: 36, height: 3, background: '#e8425a', transform: 'rotate(-42deg)' }} />
      <span className="absolute rounded-[1px] opacity-60" style={{ right: 190, top: 50, width: 9, height: 9, background: '#bd10e0', transform: 'rotate(-38deg)' }} />
    </div>
  );
}

type CopyStatus = 'idle' | 'copied' | 'failed';

const COPY_MESSAGE: Record<CopyStatus, string> = {
  idle: '',
  copied: 'Reference copied.',
  failed: 'Copying isn’t available here. The reference is selected so you can copy it yourself.',
};

/** The reference, selectable by hand, with a Copy button whose result is announced (role="status"). */
function ReferenceCard({ reference }: { reference: string }) {
  const referenceRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    const copied = await copyText(reference);
    if (!copied) {
      // Fallback: select the reference so a long-press/Ctrl+C copy is one step away.
      const selection = window.getSelection();
      if (referenceRef.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(referenceRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    // Clear first so pressing Copy again is announced again.
    setStatus('idle');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(copied ? 'copied' : 'failed'), 60);
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[12px] rounded-[14px] border border-brand/15 bg-rose/30 px-[16px] py-[16px]">
      <div className="flex w-full flex-wrap items-center gap-x-[14px] gap-y-[12px]">
        <span
          aria-hidden="true"
          className="enter-check flex size-[28px] shrink-0 items-center justify-center rounded-full bg-brand font-sans text-[13px] font-extrabold text-white"
          style={enterAfter(T.check)}
        >
          ✓
        </span>
        <p className="flex flex-1 flex-col font-sans">
          <span className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-muted">Your reference</span>
          <strong ref={referenceRef} className="select-all whitespace-nowrap text-[20px] font-extrabold tracking-[0.8px] text-ink">
            {reference}
          </strong>
        </p>
        <button
          type="button"
          onClick={copy}
          className="motion-button inline-flex min-h-[44px] shrink-0 items-center gap-[8px] rounded-full border border-brand/40 bg-white px-[16px] font-sans text-[14px] font-bold text-brand hover:border-brand"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5">
            {status === 'copied' ? (
              <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <>
                <rect x="5.25" y="5.25" width="8" height="8.5" rx="1.5" />
                <path d="M10.5 3.25v-.5A1.5 1.5 0 0 0 9 1.25H4A1.5 1.5 0 0 0 2.5 2.75v6.5A1.5 1.5 0 0 0 4 10.75h1.25" />
              </>
            )}
          </svg>
          Copy reference
        </button>
      </div>
      <p role="status" className="font-sans text-[13px] font-semibold leading-[1.45] text-brand empty:sr-only">
        {COPY_MESSAGE[status]}
      </p>
      <p className="font-sans text-[13px] leading-[1.5] text-muted">
        No confirmation email is sent, so keep a note of this reference.
      </p>
    </div>
  );
}

function NextStepCard({ step, index }: { step: (typeof NEXT_STEPS)[number]; index: number }) {
  const { badge, icon, title, desc, highlight } = step;
  return (
    // Informational cards: they enter in sequence but have no hover motion (they aren't buttons).
    <li
      className={`enter-up relative flex flex-1 flex-col items-start gap-[16px] overflow-hidden rounded-[16px] p-[22px] lg:p-[24px] ${
        highlight ? 'bg-brand' : 'border border-[#e8ded4] bg-white shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] lg:shadow-none'
      }`}
      style={enterAfter(T.cards + staggerDelay(index))}
    >
      <img
        alt=""
        aria-hidden="true"
        src={highlight ? imgAccentCircleInverse : index === 0 ? imgAccentCircle : imgAccentCircleLg}
        className="pointer-events-none absolute bottom-[-37px] right-[-37px] size-[106px]"
      />
      <div className="flex w-full items-center justify-between">
        <span className={`rounded-full px-[10px] py-[5px] font-sans text-[11px] font-extrabold ${highlight ? 'bg-white/15 text-white' : 'bg-rose text-brand'}`}>
          {badge}
        </span>
        <img alt="" aria-hidden="true" src={icon} className="size-[22px]" />
      </div>
      <div className="flex w-full flex-col gap-[6px]">
        <h3 className={`font-sans text-[15px] font-extrabold leading-[1.3] ${highlight ? 'text-white' : 'text-ink'}`}>{title}</h3>
        <p className={`font-sans text-[13px] leading-[1.55] ${highlight ? 'text-white/80' : 'text-muted'}`}>{desc}</p>
      </div>
    </li>
  );
}

/** When applicant accounts are available: following the application online is optional. */
function AccountPrompt() {
  const config = usePublicConfig();
  if (!config?.accounts.enabled) return null;
  return (
    <p className="w-full max-w-[560px] font-sans text-[14px] leading-[1.6] text-muted">
      <strong className="text-ink">Want to follow your application online?</strong> You can sign in with the email address you applied
      with to see status updates and messages.{' '}
      <Link to="/account" className="font-bold text-brand underline underline-offset-4">
        Sign in to your account
      </Link>
      . It’s optional.
    </p>
  );
}

export default function SuccessPage() {
  usePageTitle('Application received');
  const { submission, clearDraft } = useApplication();

  useEffect(() => {
    // The application is stored on the server now, so forget the answers on this device.
    // (Guarded: someone who deep-links here mid-application must not lose their draft.)
    if (submission) clearDraft();
  }, [submission, clearDraft]);

  if (!submission) return <Navigate to="/" replace />;

  return (
    <div className="clip-overflow relative flex min-h-screen w-full flex-col bg-cream">
      <SiteHeader badge="Application received" />
      <Decorations />

      <main id="main" className="relative z-10 w-full">
        {/* Top: confirmation + portrait */}
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-[22px] px-6 pb-10 pt-11 sm:px-10 lg:flex-row-reverse lg:items-start lg:justify-between lg:gap-10 lg:pb-[64px] lg:pt-[80px] xl:px-[100px]">
          <div className="relative flex h-[320px] w-full shrink-0 items-center justify-center lg:hidden">
            <div aria-hidden="true" className="enter-fade pointer-events-none absolute inset-0" style={enterAfter(T.decorations)}>
              <img alt="" src={imgTopGlow} className="absolute left-[-86px] top-[-72px] size-[260px]" />
              <img alt="" src={imgSideGlow} className="absolute right-[-60px] top-[-17px] size-[180px]" />
            </div>
            <img alt="" aria-hidden="true" src={imgPortraitHalo} className="enter-fade absolute left-1/2 top-1/2 size-[304px] -translate-x-1/2 -translate-y-1/2" style={enterAfter(T.portrait)} />
            <img alt="A smiling young man holding a laptop" src={imgStudent} className="enter-photo relative size-[284px]" style={enterAfter(T.portrait)} />
            <span
              aria-hidden="true"
              className="enter-check absolute bottom-[12px] left-1/2 ml-[84px] flex size-[58px] items-center justify-center rounded-full border-[5px] border-cream bg-brand font-sans text-[22px] font-extrabold text-white"
              style={enterAfter(T.check)}
            >
              ✓
            </span>
          </div>
          <div className="hidden aspect-square w-[min(443px,38vw)] shrink-0 overflow-clip rounded-[32px] lg:block">
            <img alt="A smiling young man holding a laptop" src={imgStudent} className="enter-depth size-full object-cover" style={enterAfter(T.portrait)} />
          </div>

          {/* The confirmation and reference appear promptly. */}
          <div className="form-enter flex w-full max-w-[620px] flex-col items-start gap-[16px] lg:gap-[20px]">
            <div className="flex items-center gap-[10px]">
              <span aria-hidden="true" className="h-[2px] w-[28px] rounded-[1px] bg-brand" />
              <p className="whitespace-nowrap font-sans text-[10px] font-extrabold uppercase tracking-[1.8px] text-brand lg:text-[11px] lg:tracking-[2.2px]">
                Application received
              </p>
            </div>
            <h1 data-page-heading tabIndex={-1} className="w-full font-display text-[43px] leading-[1.02] tracking-[0.2px] text-ink outline-none lg:text-[60px] lg:tracking-[1.2px]">
              Thank you. Your application is in.
            </h1>
            {/* Received ≠ admitted: say so plainly. */}
            <p className="w-full max-w-[540px] font-sans text-[14px] leading-[1.6] text-muted lg:text-[15px]">
              This confirms your application has reached the Programme team. It is not an offer of a place: every application
              is reviewed, and the physical boot camp is for participants selected on merit.
            </p>
            <ReferenceCard reference={submission.reference} />
            {/* Optional follow-ups: no entrance delay (they ask for consent). */}
            <NotificationCard />
            <AccountPrompt />
          </div>
        </div>

        {/* Bottom: what happens next */}
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center gap-[22px] px-6 pb-16 sm:px-10 lg:gap-[40px] lg:pb-[80px] xl:px-[100px]">
          <div className="enter-up flex w-full items-center gap-[11px] lg:gap-[12px]" style={enterAfter(T.nextHeading)}>
            <span aria-hidden="true" className="h-[3px] w-[34px] rounded-[2px] bg-brand lg:w-[36px]" />
            <h2 className="font-display text-[31px] leading-[1.1] text-ink lg:text-[32px]">What happens next</h2>
          </div>
          <ol className="flex w-full flex-col gap-[14px] lg:flex-row lg:gap-[16px]">
            {NEXT_STEPS.map((step, index) => (
              <NextStepCard key={step.badge} step={step} index={index} />
            ))}
          </ol>
          <div className="enter-up flex w-full flex-col items-center gap-[12px]" style={enterAfter(T.home)}>
            <PrimaryLink to="/" className="w-full sm:w-auto">
              Back to Home
            </PrimaryLink>
            <p className="text-center font-sans text-[12px] font-medium text-muted">You may now safely leave this page.</p>
            {site.contactEmail && (
              <p className="text-center font-sans text-[14px] text-muted">
                Questions? Email{' '}
                <a className="font-bold text-brand underline underline-offset-4" href={`mailto:${site.contactEmail}`}>
                  {site.contactEmail}
                </a>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
