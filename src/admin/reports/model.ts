/**
 * The reports' pure logic, tested in model.test.ts: reporting periods in Lagos calendar days
 * (WAT), how a figure compares with the period before (only when there is one), and the
 * summaries every chart states in words.
 */
import { APPLICATION_STATUSES, PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS, type ApplicationStatus } from '../../shared/platform';
import { utcToZonedLocal } from '../../shared/time';
import type { Count, ReportSummary, StatusCounts } from '../api';

// ── Days and periods (Lagos calendar days, YYYY-MM-DD) ───────────────────────────

export const todayInLagos = (now = new Date()) => utcToZonedLocal(now, 'Africa/Lagos').slice(0, 10);

export const isDay = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const daysBefore = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** A calendar day as a Date at local noon, for the date picker: built from its parts, so the browser's time zone never moves it. */
export function dayToDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!, 12);
}

/** The calendar day a date picker Date stands for. */
export const dateToDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "7 Sept 2026". */
export const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));
/** "7 Sept", for axis labels. */
export const formatShortDay = (day: string) => shortDayFormat.format(new Date(`${day}T00:00:00Z`));

export const PERIOD_PRESETS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: 'year', label: 'This year', days: null },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]['key'];

/** A preset's days, ending today (both ends included). */
export function presetRange(key: PeriodPreset, today: string): { from: string; to: string } {
  const preset = PERIOD_PRESETS.find((option) => option.key === key)!;
  return { from: preset.days === null ? `${today.slice(0, 4)}-01-01` : daysBefore(today, preset.days - 1), to: today };
}

/** Which preset a period is: 'all' with no dates, 'custom' when it matches none. */
export function presetOf(from: string, to: string, today: string): PeriodPreset | 'all' | 'custom' {
  if (!from && !to) return 'all';
  return PERIOD_PRESETS.find((preset) => {
    const range = presetRange(preset.key, today);
    return range.from === from && range.to === to;
  })?.key ?? 'custom';
}

/** "1 Sept – 30 Sept 2026", or with both years when they differ. */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return formatDay(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${formatShortDay(from)} – ${formatDay(to)}` : `${formatDay(from)} – ${formatDay(to)}`;
}

/** The period control's label: "All time", "Last 30 days", "1 Sept – 30 Sept 2026", "Since 1 Sept 2026", "Up to 30 Sept 2026". */
export function periodLabel(from: string, to: string, today: string): string {
  const preset = presetOf(from, to, today);
  if (preset === 'all') return 'All time';
  if (preset !== 'custom') return PERIOD_PRESETS.find((option) => option.key === preset)!.label;
  if (from && to) return rangeLabel(from, to);
  return from ? `Since ${formatDay(from)}` : `Up to ${formatDay(to)}`;
}

/** The period in a sentence: "from 1 Sept 2026 to 30 Sept 2026 (WAT)", "since…", "up to…" or "at any time". */
export function periodText(from: string | null, to: string | null): string {
  if (from && to) return from === to ? `on ${formatDay(from)} (WAT)` : `from ${formatDay(from)} to ${formatDay(to)} (WAT)`;
  if (from) return `since ${formatDay(from)} (WAT)`;
  if (to) return `up to ${formatDay(to)} (WAT)`;
  return 'at any time';
}

// ── Comparisons ──────────────────────────────────────────────────────────────────

export type Comparison = {
  /** Up, down, level, or no percentage to show (no earlier figure, or it's hidden). */
  direction: 'up' | 'down' | 'same' | 'none';
  /** "+12%" / "−8%" / "No change"; null when there's no percentage to show. */
  badge: string | null;
  /** The comparison in words. */
  text: string;
};

/**
 * How a figure compares with the period of the same length just before. Only when the report
 * has a start date (the server sends no comparison otherwise); a zero or hidden earlier figure
 * gets words, never a percentage.
 */
export function compare(current: Count, comparison: ReportSummary['comparison']): Comparison | null {
  if (!comparison || current === null) return null;
  const before = comparison.days === 1 ? 'the day before' : `the ${comparison.days} days before (${rangeLabel(comparison.from, comparison.to)})`;
  const previous = comparison.applications;
  if (previous === null) return { direction: 'none', badge: null, text: `Fewer than 5 in ${before}.` };
  if (previous === 0) {
    return { direction: 'none', badge: null, text: current === 0 ? `None in ${before} either.` : `None in ${before}, so there's no percentage change to show.` };
  }
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { direction: 'same', badge: 'No change', text: `The same as in ${before} (${previous.toLocaleString('en-GB')}).` };
  return {
    direction: change > 0 ? 'up' : 'down',
    badge: `${change > 0 ? '+' : '−'}${Math.abs(change)}%`,
    text: `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on ${before}, which had ${previous.toLocaleString('en-GB')}.`,
  };
}

// ── Counts and series ────────────────────────────────────────────────────────────

/** A whole-number share, or null when either side is hidden or there's nothing to share. */
export const percent = (part: Count, whole: Count) => (part === null || whole === null || whole === 0 ? null : Math.round((part / whole) * 100));

/** "3", "fewer than 5", "1,204". */
export const formatCount = (count: Count) => (count === null ? 'fewer than 5' : count.toLocaleString('en-GB'));

/** "3 (30%)". */
export const countWithShare = (count: Count, share: number | null) => `${formatCount(count)}${share !== null ? ` (${share}%)` : ''}`;

export const statusLabel = (kind: 'review' | 'published', status: ApplicationStatus) =>
  kind === 'review' ? REVIEW_STATUS_LABELS[status] : PUBLISHED_STATUS_LABELS[status].label;

/** Every status with its count and share of `total`, in the review order. */
export const statusRows = (counts: StatusCounts, kind: 'review' | 'published', total: Count) =>
  APPLICATION_STATUSES.map((status) => ({ status, label: statusLabel(kind, status), value: counts[status], share: percent(counts[status], total) }));

export type SeriesPoint = { period: string; applications: Count };

/** A series' total (null when a period is hidden), its busiest period and the average per period. */
export function seriesStats(points: SeriesPoint[]) {
  const hidden = points.some((point) => point.applications === null);
  const total = hidden ? null : points.reduce((sum, point) => sum + (point.applications ?? 0), 0);
  const busiest = points.reduce<SeriesPoint | null>((best, point) => ((point.applications ?? 0) > (best?.applications ?? 0) ? point : best), null);
  const average = total === null || !points.length ? null : Math.round((total / points.length) * 10) / 10;
  return { total, busiest, average, hidden };
}

/** A sentence saying what a series shows: the range, the total and the busiest period. */
export function describeSeries(points: SeriesPoint[], interval: 'day' | 'week'): string {
  if (!points.length) return 'No periods to show.';
  const unit = interval;
  const range = `${interval === 'week' ? 'Weeks starting ' : ''}${formatDay(points[0]!.period)} to ${formatDay(points.at(-1)!.period)} (${points.length} ${unit}${points.length === 1 ? '' : 's'}, WAT)`;
  const { hidden, busiest } = seriesStats(points);
  const counted = points.reduce((sum, point) => sum + (point.applications ?? 0), 0);
  if (!counted && !hidden) return `${range}: no applications.`;
  const peak = busiest ? ` The busiest ${unit}${interval === 'week' ? ' began' : ' was'} ${formatDay(busiest.period)}, with ${busiest.applications}.` : '';
  return `${range}: ${hidden ? 'at least ' : ''}${counted} application${counted === 1 ? '' : 's'}.${peak}${hidden ? ' Periods with fewer than 5 are not counted in this total.' : ''}`;
}
