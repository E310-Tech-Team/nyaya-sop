import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { BackLink, PrimaryButton } from '../components/Buttons';
import { FormActions, FormCard, StepHeader } from '../components/FormLayout';
import { usePageTitle } from '../components/RouteEffects';
import { site } from '../config/site';
import { ApiError, submitApplication } from '../lib/api';
import { chainRows, type ParishDraft } from '../lib/parish';
import { isChainComplete } from '../shared/directory';
import {
  AGE_RANGES,
  CONSENT_STATEMENT,
  CURRENT_STATUSES,
  EDUCATION_LEVELS,
  GENDERS,
  PURPOSE_SCALE,
  formatPhone,
  labelFor,
  type ApplicationField,
} from '../shared/application';
import { collapseWhitespace, normalizePhone } from '../shared/validation';
import { toPayload, useApplication } from '../state/application';

const FIELD_STEP: Record<ApplicationField, string> = {
  fullName: '/apply/personal',
  email: '/apply/personal',
  phone: '/apply/personal',
  gender: '/apply/personal',
  ageRange: '/apply/personal',
  stateOfResidence: '/apply/personal',
  city: '/apply/personal',
  parishName: '/apply/personal',
  educationLevel: '/apply/education',
  currentStatus: '/apply/education',
  purposeClarity: '/apply/purpose',
  consentVersion: '/apply',
};

function SummarySection({ title, editTo, rows }: { title: string; editTo: string; rows: [string, ReactNode][] }) {
  const headingId = `review-${editTo.split('/').pop()}`;
  return (
    <section className="w-full" aria-labelledby={headingId}>
      <div className="mb-[14px] flex items-center justify-between gap-4">
        <h2 id={headingId} className="font-sans text-[16px] font-extrabold text-ink">
          {title}
        </h2>
        <Link
          to={editTo}
          className="rounded-full border border-line-strong px-[14px] py-[6px] font-sans text-[13px] font-bold text-brand transition-colors hover:border-brand"
        >
          Edit<span className="sr-only"> {title}</span>
        </Link>
      </div>
      {/* minmax(0,…) + overflow-wrap:anywhere so long emails wrap instead of widening the page. */}
      <dl className="grid w-full grid-cols-[minmax(0,1fr)] gap-x-[24px] gap-y-[12px] sm:grid-cols-[minmax(140px,200px)_minmax(0,1fr)]">
        {rows.map(([term, detail]) => (
          <div key={term} className="contents">
            <dt className="font-sans text-[13px] font-semibold text-muted">{term}</dt>
            <dd className="mb-[6px] font-sans text-[15px] text-ink [overflow-wrap:anywhere] sm:mb-0">{detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The parish as the review shows it when the question used the directory: its units, level by level. */
function parishSummary(parish: ParishDraft | null): ReactNode {
  if (parish?.kind === 'listed') {
    return (
      <>
        <span className="block">{parish.name}</span>
        {chainRows(parish.chain).map(([level, unit]) => (
          <span key={level} className="block text-[13px] text-muted">
            {level}: {unit}
          </span>
        ))}
        {!isChainComplete(parish.chain) ? (
          <span className="block text-[13px] text-muted">We’ve asked the Programme team to complete this parish’s details.</span>
        ) : (
          parish.detailsWrong && <span className="block text-[13px] text-muted">You told us these details look wrong.</span>
        )}
      </>
    );
  }
  if (parish?.kind === 'not_listed') {
    return (
      <>
        <span className="block">{collapseWhitespace(parish.name)}</span>
        <span className="block text-[13px] text-muted">Not on our list yet: the Programme team will check it.</span>
      </>
    );
  }
  return 'Not answered';
}

function errorContent(error: ApiError) {
  const contact = site.contactEmail ? (
    <>
      {' '}
      You can reach the Programme team at{' '}
      <a className="underline" href={`mailto:${site.contactEmail}`}>
        {site.contactEmail}
      </a>
      .
    </>
  ) : null;

  switch (error.code) {
    case 'VALIDATION_FAILED': {
      const entries = Object.entries(error.fieldErrors ?? {}) as [ApplicationField, string][];
      return (
        <>
          <p className="font-bold">Some answers need attention:</p>
          <ul className="mt-2 list-disc pl-5">
            {entries.map(([field, message]) => (
              <li key={field}>
                <Link className="underline" to={FIELD_STEP[field]}>
                  {message}
                </Link>
              </li>
            ))}
          </ul>
        </>
      );
    }
    case 'DIRECTORY_UNAVAILABLE':
      return (
        <p>
          <strong>We couldn’t confirm your parish just now.</strong> The RCCG parish directory didn’t answer, so your application
          hasn’t been sent. Your answers are still saved while this tab stays open: wait a few minutes, then press Submit again.
        </p>
      );
    case 'ALREADY_APPLIED':
      return (
        <p>
          <strong>You've already applied.</strong> An application with this email address has already been received for this
          cohort, so there's no need to apply again.{contact}
        </p>
      );
    case 'APPLICATIONS_CLOSED':
      return (
        <p>
          <strong>Applications are closed.</strong> This cohort is no longer accepting applications. Thank you for your
          interest.
        </p>
      );
    case 'RATE_LIMITED':
      return (
        <p>
          <strong>Too many attempts.</strong> Several applications were sent from your network in a short time. Please wait a
          few minutes, then press Submit again.
        </p>
      );
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      if (error.code === 'NETWORK_ERROR' && typeof navigator !== 'undefined' && navigator.onLine === false) {
        return (
          <p>
            <strong>You're offline, so your application hasn't been sent.</strong> Reconnect to mobile data or Wi-Fi, then press
            Submit again. Your answers are still saved while this tab stays open.
          </p>
        );
      }
      return (
        <p>
          <strong>We couldn't reach our server.</strong> Check your internet connection and press Submit again. Your answers
          are still saved while this tab stays open.
        </p>
      );
    default:
      return (
        <p>
          <strong>Something went wrong on our side.</strong> Please try again in a moment. Your answers are still saved while
          this tab stays open.{contact}
        </p>
      );
  }
}

export default function ReviewPage() {
  usePageTitle('Review your application');
  const navigate = useNavigate();
  const { draft, markSubmitted, recheckParish } = useApplication();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const { personal, education, purpose } = draft;

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const receipt = await submitApplication(toPayload(draft));
      markSubmitted(receipt);
      navigate('/apply/success', { replace: true });
    } catch (caught) {
      // The server found the chosen parish merged or removed: check it again for the Personal step.
      if (caught instanceof ApiError && caught.fieldErrors?.parishName && draft.parishMode === 'directory') recheckParish();
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', String(caught)));
      setSubmitting(false);
      setTimeout(() => errorRef.current?.focus(), 0);
    }
  }

  const phone = normalizePhone(personal.phone);

  return (
    <>
      <StepHeader
        sectionLabel="Review"
        heading="Review your application"
        intro="Please check your answers. Use Edit to change anything, then submit your application."
        showRequiredNote={false}
      />
      <FormCard className="gap-[28px]">
        <SummarySection
          title="Personal Information"
          editTo="/apply/personal"
          rows={[
            ['Full name', collapseWhitespace(personal.fullName)],
            ['Email address', personal.email.trim().toLowerCase()],
            ['Phone number', phone ? formatPhone(phone) : personal.phone],
            ['Gender', labelFor(GENDERS, personal.gender)],
            ['Age range', labelFor(AGE_RANGES, personal.ageRange)],
            ['State of residence', personal.stateOfResidence],
            ['City/Town', collapseWhitespace(personal.city)],
            ['RCCG parish', draft.parishMode === 'directory' ? parishSummary(draft.parish) : collapseWhitespace(personal.parishName) || 'Not provided'],
          ]}
        />
        <div aria-hidden="true" className="h-px w-full bg-line opacity-65" />
        <SummarySection
          title="Education & Career"
          editTo="/apply/education"
          rows={[
            ['Highest education', labelFor(EDUCATION_LEVELS, education.educationLevel)],
            ['Current status', labelFor(CURRENT_STATUSES, education.currentStatus)],
          ]}
        />
        <div aria-hidden="true" className="h-px w-full bg-line opacity-65" />
        <SummarySection
          title="Purpose & Self-Discovery"
          editTo="/apply/purpose"
          rows={[
            ['Purpose clarity', `${purpose.purposeClarity} - ${labelFor(PURPOSE_SCALE, purpose.purposeClarity)}`],
          ]}
        />
        <div className="flex w-full items-start gap-[11px] rounded-[12px] border border-brand/15 bg-rose/30 p-[14px]">
          <span
            aria-hidden="true"
            className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-brand font-sans text-[12px] font-extrabold text-white"
          >
            ✓
          </span>
          <p className="font-sans text-[14px] leading-[1.5] text-muted">
            <span className="font-semibold text-ink">You confirmed:</span> {CONSENT_STATEMENT}
          </p>
        </div>
      </FormCard>

      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="w-full max-w-[840px] rounded-[12px] border border-brand/40 bg-[rgba(132,29,38,0.05)] px-[18px] py-[14px] font-sans text-[14px] leading-[1.55] text-brand outline-none"
        >
          {errorContent(error)}
        </div>
      )}

      <FormActions>
        <div className="flex w-full items-center gap-[10px]">
          <BackLink to="/apply/purpose" />
          <PrimaryButton type="button" onClick={submit} busy={submitting} disabled={submitting} className="flex-1">
            {submitting ? 'Submitting…' : 'Submit Application'}
          </PrimaryButton>
        </div>
      </FormActions>
    </>
  );
}
