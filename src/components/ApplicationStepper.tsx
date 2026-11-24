import type { ProgressStep } from '../lib/applicationProgress';
import { formatDateInZone } from '../shared/time';

const STATE_TEXT: Record<ProgressStep['state'], string> = { done: 'done', current: 'current stage', upcoming: 'not yet' };

const MARKER: Record<ProgressStep['state'], string> = {
  upcoming: 'border-2 border-line bg-white text-muted',
  current: 'border-2 border-brand bg-white text-brand ring-4 ring-rose',
  done: 'bg-brand text-white',
};

function Tick() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * An application's published stages (src/lib/applicationProgress.ts): vertical on phones,
 * horizontal from `sm`. Public: the success screen and the account dashboard both use it.
 */
export function ApplicationStepper({ steps, label = 'Progress' }: { steps: ProgressStep[]; label?: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-3 sm:flex-row sm:gap-0">
      {steps.map((step, index) => (
        <li
          key={step.status}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2"
        >
          <div className="flex items-center sm:w-full">
            <span
              aria-hidden="true"
              className={`flex size-8 shrink-0 items-center justify-center rounded-full font-sans text-[13px] font-bold ${MARKER[step.state]}`}
            >
              {step.state === 'done' ? <Tick /> : index + 1}
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden="true" className={`mx-2 hidden h-0.5 flex-1 sm:block ${step.state === 'done' ? 'bg-brand' : 'bg-line'}`} />
            )}
          </div>
          <span className="flex flex-col">
            <span className={`font-sans text-[14px] ${step.state === 'upcoming' ? 'text-muted' : 'font-bold text-ink'}`}>
              {step.label}
              <span className="sr-only"> ({STATE_TEXT[step.state]})</span>
            </span>
            {step.date && <span className="font-sans text-[12px] text-muted">{formatDateInZone(step.date)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
