import { ApplicationStepper } from '../components/ApplicationStepper';
import { Badge } from '../components/ui';
import { progressSteps } from '../lib/applicationProgress';
import type { ApplicantApplication } from '../shared/platform';
import { formatDateInZone } from '../shared/time';
import { nextStep } from './dashboard';
import { STATUS_TONE } from './status';

/** One linked application on the dashboard: where it is, the team's message and what happens next. */
export function ApplicationProgress({ item }: { item: ApplicantApplication }) {
  const steps = progressSteps(item.status, { submittedAt: item.submittedAt, publishedAt: item.publishedAt });
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
      {steps && <ApplicationStepper steps={steps} />}
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
      {/* The stepper dates its stages; without one (Not selected, Withdrawn) the dates go here. */}
      {!steps && (
        <p className="font-sans text-[13px] text-muted">
          Sent {formatDateInZone(item.submittedAt)}
          {item.publishedAt && <> · updated {formatDateInZone(item.publishedAt)}</>}
        </p>
      )}
    </article>
  );
}
