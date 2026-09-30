/**
 * The reports' compact visuals, plain HTML and CSS so they sit in cards cheaply (the full charts
 * are Recharts, in charts.tsx): a ranked bar list and a segmented category bar, after Tremor's
 * open-source BarList and CategoryBar patterns (no Tremor package: it brings its own chart system).
 * Every number is in text beside the bars; the bars are hidden from assistive technology.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../../shared/platform';
import type { Count, StatusCounts } from '../api';
import { formatCount, percent, statusLabel } from './model';

/**
 * One colour per status, following the admin's status badges (docs/04 §10): New amber, Under
 * review burgundy (the brand colour), Shortlisted and Invited green, the rest grey. Each is at
 * least 3:1 against white; segments are separated by gaps, and a legend always names them.
 */
export const STATUS_COLOURS: Record<ApplicationStatus, string> = {
  submitted: '#a8781a',
  under_review: 'var(--color-brand)',
  shortlisted: '#3f7f45',
  invited: '#1e5b22',
  not_selected: 'var(--color-muted)',
  withdrawn: 'var(--color-line-strong)',
};

export type Segment = { key: string; label: ReactNode; value: Count; colour: string; href?: string | null; name?: string };

/**
 * One bar in parts, and a legend naming each part with its count (a link when it opens the applications).
 * Without the legend, the bar alone: only where the same counts are listed beside it.
 */
export function CategoryBar({ segments, label, hideEmpty = false, legend = true }: { segments: Segment[]; label: string; hideEmpty?: boolean; legend?: boolean }) {
  const known = segments.reduce((sum, segment) => sum + (segment.value ?? 0), 0);
  const shown = hideEmpty ? segments.filter((segment) => segment.value !== 0) : segments;
  return (
    <div className="flex flex-col gap-2.5">
      <div aria-hidden="true" className="flex h-2.5 w-full gap-[3px] overflow-hidden rounded-full bg-cream">
        {known > 0 &&
          segments.map((segment) =>
            segment.value ? <span key={segment.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(segment.value / known) * 100}%`, backgroundColor: segment.colour }} /> : null,
          )}
      </div>
      {legend && (
        <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1.5 font-sans text-[13px] text-ink">
          {shown.map((segment) => (
            <li key={segment.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: segment.colour }} />
              <span className="text-muted">{segment.label}</span>
              {segment.href && segment.value ? (
                <Link to={segment.href} className="font-bold tabular-nums text-brand underline-offset-4 hover:underline">
                  {formatCount(segment.value)}
                  <span className="sr-only"> applications: {segment.name ?? segment.label}</span>
                </Link>
              ) : (
                <span className="font-bold tabular-nums">{formatCount(segment.value)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A card's review (or published) status breakdown, showing only the statuses it has. */
export function StatusMeter({ counts, kind = 'review', label, legend = true }: { counts: StatusCounts; kind?: 'review' | 'published'; label: string; legend?: boolean }) {
  if (APPLICATION_STATUSES.every((status) => counts[status] === 0)) return <p className="font-sans text-[13px] text-muted">No applications yet.</p>;
  return (
    <CategoryBar
      label={label}
      hideEmpty
      legend={legend}
      segments={APPLICATION_STATUSES.map((status) => ({ key: status, label: statusLabel(kind, status), value: counts[status], colour: STATUS_COLOURS[status] }))}
    />
  );
}

export type BarItem = { key: string; label: string; value: Count; href?: string | null; note?: ReactNode };

/**
 * A ranked list: each row's bar sits behind its name, scaled to the largest row (or to `total`),
 * with the count (and share of `total`) in its own column so the numbers line up.
 */
export function BarList({ items, label, total = null, scale = 'max' }: { items: BarItem[]; label: string; total?: Count; scale?: 'max' | 'total' }) {
  const max = scale === 'total' ? (total ?? 0) : Math.max(0, ...items.map((item) => item.value ?? 0));
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5">
      {items.map((item) => {
        const share = percent(item.value, total);
        const width = max ? Math.max(((item.value ?? 0) / max) * 100, item.value ? 2 : 0) : 0;
        return (
          <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
            <div className="relative flex min-h-9 items-center rounded-lg px-3 py-1.5">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-lg bg-rose/55" style={{ width: `${width}%` }} />
              <span className="relative min-w-0 font-sans text-[14px] leading-[1.35] break-words text-ink">
                {item.href ? (
                  <Link to={item.href} className="font-semibold text-brand underline-offset-4 hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
                {item.note && <span className="block text-[12px] font-normal text-muted">{item.note}</span>}
              </span>
            </div>
            <span className="text-right font-sans text-[14px] tabular-nums text-ink">
              <span className="font-bold">{formatCount(item.value)}</span>
              {share !== null && <span className="block text-[12px] text-muted">{share}%</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
