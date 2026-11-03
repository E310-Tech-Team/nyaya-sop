import { Badge, when } from '../components/ui';
import type { ApplicantApplication } from '../shared/platform';
import { nextStep, progressSteps, type ProgressStep } from './dashboard';
import { STATUS_TONE } from './status';

const STATE_TEXT: Record<ProgressStep['state'], string> = { done: 'done', current: 'current stage', upcoming: 'not yet' };

function Stepper({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol aria-label="Progress" className="flex flex-col gap-3 sm:flex-row sm:gap-0">
      {steps.map((step, index) => (
        <li
          key={step.status}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2"
        >
          <div className="flex items-center sm:w-full">
            <span
              aria-hidden="true"
              className={
                step.state === 'upcoming'
                  ? 'flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-line bg-white font-sans text-[13px] font-bold text-muted'
                  : step.state === 'current'
                    ? 'flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-white font-sans text-[13px] font-bold text-brand ring-4 ring-rose'
                    : 'flex size-8 shrink-0 items-center justify-center rounded-full bg-brand font-sans text-[13px] font-bold text-white'
              }
            >
              {step.state === 'done' ? (
                <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25">
                  <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden="true" className={`mx-2 hidden h-0.5 flex-1 sm:block ${step.state === 'done' ? 'bg-brand' : 'bg-line'}`} />
            )}
          </div>
          <span className={`font-sans text-[14px] ${step.state === 'upcoming' ? 'text-muted' : 'font-bold text-ink'}`}>
            {step.label}
            <span className="sr-only"> ({STATE_TEXT[step.state]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One linked application on the dashboard: where it is, the team's message and what happens next. */
export function ApplicationProgress({ item }: { item: ApplicantApplication }) {
  const steps = progressSteps(item.status);
  const next = nextStep(item.status);
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-sans text-[16px] font-bold text-ink">
          Application {item.reference}
          <span className="font-normal text-muted"> · {item.cohortName}</span>
        </h3>
        <Badge tone={STATUS_TONE[item.status]}>{item.statusLabel}</Badge>
      </div>
      {steps && <Stepper steps={steps} />}
      <p className="font-sans text-[15px] leading-[1.6] text-ink">{item.statusDescription}</p>
      {item.message && (
        <div className="rounded-[10px] border border-line bg-cream px-4 py-3">
          <p className="font-sans text-[13px] font-bold uppercase tracking-[0.8px] text-muted">Message from the Programme team</p>
          <p className="mt-1 whitespace-pre-line font-sans text-[15px] leading-[1.6] text-ink">{item.message}</p>
        </div>
      )}
      {next && (
        <div className="flex flex-col gap-1 border-l-2 border-gold pl-4">
          <p className="font-sans text-[13px] font-bold uppercase tracking-[0.8px] text-muted">What happens next</p>
          <p className="font-sans text-[15px] leading-[1.6] text-ink">{next}</p>
        </div>
      )}
      <p className="font-sans text-[13px] text-muted">
        Sent {when(item.submittedAt)}
        {item.publishedAt && <> · last update {when(item.publishedAt)}</>}
      </p>
    </article>
  );
}
