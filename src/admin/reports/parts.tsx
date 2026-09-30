/**
 * What every report in Reports and analytics shares: the filters (kept in the URL and carried
 * between reports and into the Applicants list), the filter toolbar (a sheet on phones), the line
 * saying what is being reported on, the report navigation, and the cards and states the reports
 * are built from. Built on the shadcn/ui primitives in src/components/ui.
 */
import {
  AlertCircleIcon,
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  FilterXIcon,
  InboxIcon,
  ListFilterIcon,
  MapPinIcon,
  RotateCwIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { errorMessage, PageHeader } from '../../components/ui';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button, type ButtonVariantProps } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { fieldClass } from '../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';
import { tabsTriggerClass } from '../../components/ui/tabs';
import { ApiError } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { cn } from '../../lib/utils';
import { APPLICATION_STATUSES, PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS } from '../../shared/platform';
import { adminApi, type ReportCohort, type ReportSummary } from '../api';
import { LEVEL_LABELS, UnitFinder } from '../directory-parts';
import { useCan } from '../session';
import { LazyPart, PeriodCalendar } from './lazy';
import { formatDay, PERIOD_PRESETS, periodLabel, periodText, presetOf, presetRange, todayInLagos, type Comparison, type PeriodPreset } from './model';
import type { DayRange } from './PeriodCalendar';

// ── Filters in the URL ─────────────────────────────────────────────────────────

/**
 * The filters every report takes (the Applicants list takes the same ones). `unit` and `parish` are
 * also where the drill-down is: the unit open, and a parish chosen in it.
 */
export const REPORT_FILTERS = ['cohort', 'from', 'to', 'status', 'published', 'unit', 'direct', 'without', 'parish'] as const;
/** Where the drill-down is: changing the place clears everything below it. */
export const PLACE_PARAMS = { unit: null, direct: null, without: null, parish: null, level: null, q: null, include: null } as const;
export type ReportFilterKey = (typeof REPORT_FILTERS)[number];
export type ReportFilters = Record<ReportFilterKey, string>;

const clean = (values: Record<string, string | null | undefined>) =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])));

export function useReportFilters() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(REPORT_FILTERS.map((key) => [key, params.get(key) ?? ''])) as ReportFilters;
  const query = clean(filters);
  /** Changes some parameters (null or '' removes one); a change of filter starts again at page 1. */
  const set = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const clearAll = () => set(Object.fromEntries(REPORT_FILTERS.map((key) => [key, null])));
  /** The report filters, plus `extra`, as a query string: for links to another report or to the applicants. */
  const carry = (extra: Record<string, string | null | undefined> = {}) => new URLSearchParams(clean({ ...query, ...extra })).toString();
  const active = REPORT_FILTERS.filter((key) => key !== 'direct' && filters[key]).length;
  return { params, filters, query, set, clearAll, carry, active };
}

/** The Applicants list showing exactly the applications behind a count. */
export const applicantsHref = (query: Record<string, string>, extra: Record<string, string> = {}) => `/admin/applicants?${new URLSearchParams({ ...query, ...extra })}`;

// ── Navigation between reports ────────────────────────────────────────────────

export const REPORTS = [
  { path: '/admin/reports', label: 'Overview' },
  { path: '/admin/reports/organisation', label: 'Continents to parishes' },
  { path: '/admin/reports/over-time', label: 'Over time' },
  { path: '/admin/reports/decisions', label: 'Review and decisions' },
  { path: '/admin/reports/parish-answers', label: 'Parish answers' },
  { path: '/admin/reports/cohorts', label: 'Cohorts' },
] as const;

/** The reports as links that keep the current filters: two columns on phones, one segmented bar from tablets. */
export function ReportNav() {
  const { pathname } = useLocation();
  const { carry } = useReportFilters();
  const search = carry();
  return (
    <nav aria-label="Reports">
      <ul className="grid grid-cols-2 gap-1 rounded-2xl border border-line/80 bg-cream p-1 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap sm:rounded-full">
        {REPORTS.map((report) => (
          <li key={report.path} className="flex">
            <Link
              to={`${report.path}${search ? `?${search}` : ''}`}
              aria-current={pathname === report.path ? 'page' : undefined}
              className={cn(tabsTriggerClass, 'min-h-10 w-full rounded-xl px-2 text-[13px] leading-tight whitespace-normal sm:rounded-full sm:px-4 sm:text-[14px] sm:whitespace-nowrap')}
            >
              {report.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Filter controls ───────────────────────────────────────────────────────────

const ANY = 'any';
const labelClass = 'font-sans text-[13px] font-semibold text-ink';
const eyebrowClass = 'font-sans text-[12px] font-extrabold tracking-[0.8px] text-muted uppercase';

/** A filter with a fixed list of choices (Radix Select); "any" clears it. */
function ChoiceFilter({
  label,
  value,
  anyLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  anyLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  const known = !value || options.some((option) => option.value === value);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <Select value={value && known ? value : ANY} onValueChange={(next) => onChange(next === ANY ? null : next)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Quick periods and a date range, both in Lagos calendar days. */
function PeriodPanel({ onDone }: { onDone?: () => void }) {
  const { filters, set } = useReportFilters();
  const today = todayInLagos();
  const preset = presetOf(filters.from, filters.to, today);
  const [draft, setDraft] = useState<DayRange>({ from: filters.from, to: filters.to });
  const quickId = useId();
  const datesId = useId();
  const choose = (key: PeriodPreset | 'all') => {
    set(key === 'all' ? { from: null, to: null } : presetRange(key, today));
    setDraft(key === 'all' ? { from: '', to: '' } : presetRange(key, today));
    onDone?.();
  };
  const draftText = draft.from
    ? draft.to
      ? `From ${formatDay(draft.from)} to ${formatDay(draft.to)}.`
      : `From ${formatDay(draft.from)}: choose an end date, or apply to report on everything since then.`
    : 'Choose the first day, then the last.';
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div role="group" aria-labelledby={quickId} className="flex flex-col gap-1 md:w-40">
        <p id={quickId} className={eyebrowClass}>
          Quick periods
        </p>
        {[{ key: 'all' as const, label: 'All time' }, ...PERIOD_PRESETS].map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={preset === option.key}
            onClick={() => choose(option.key)}
            className="min-h-10 cursor-pointer rounded-lg px-3 text-left font-sans text-[14px] font-semibold text-ink hover:bg-cream aria-pressed:bg-rose/55 aria-pressed:text-brand-deep"
          >
            {option.label}
          </button>
        ))}
      </div>
      <div role="group" aria-labelledby={datesId} className="flex flex-col gap-3 md:border-l md:border-line/80 md:pl-4">
        <p id={datesId} className={eyebrowClass}>
          Choose dates (Lagos time, WAT)
        </p>
        <LazyPart what="date picker" height={296}>
          <PeriodCalendar value={draft} today={today} onChange={setDraft} />
        </LazyPart>
        <p aria-live="polite" className="max-w-[18rem] font-sans text-[13px] leading-[1.45] text-muted">
          {draftText}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!draft.from}
            onClick={() => {
              set({ from: draft.from || null, to: draft.to || null });
              onDone?.();
            }}
          >
            Apply dates
          </Button>
          {(draft.from || draft.to) && (
            <Button size="sm" variant="ghost" onClick={() => setDraft({ from: '', to: '' })}>
              Clear dates
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A button styled like the other filter fields, naming the filter and its current value. */
function FieldButton({ id, labelId, icon: Icon, children, ...props }: { id: string; labelId: string; icon: LucideIcon; children: ReactNode } & ComponentProps<'button'>) {
  return (
    <button
      id={id}
      type="button"
      aria-labelledby={`${labelId} ${id}`}
      className={cn(fieldClass, 'flex cursor-pointer items-center gap-2 text-left')}
      {...props}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
    </button>
  );
}

function PeriodFilter() {
  const { filters } = useReportFilters();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className={labelClass}>
        Period
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <FieldButton id={id} labelId={`${id}-label`} icon={CalendarDaysIcon}>
            {periodLabel(filters.from, filters.to, todayInLagos())}
          </FieldButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto" aria-label="Choose the period">
          <PeriodPanel onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const placeName = (unit: ReportSummary['unit']) => (unit ? `${unit.name} (${LEVEL_LABELS[unit.level].toLowerCase()})` : 'the chosen place');

/** What a parish filter means: one parish, or the applications with or without a directory parish. */
export const parishFilterLabel = (value: string, parish: ReportSummary['parish']) =>
  value === 'none' ? 'No directory parish' : value === 'any' ? 'With a directory parish' : `Parish: ${parish?.name ?? 'the chosen parish'}`;

/** Limiting the reports to a continent, region or province: the existing unit finder. A new place clears the parish chosen in the old one. */
function PlaceChooser({ unit, parish, onChosen }: { unit: ReportSummary['unit']; parish: ReportSummary['parish']; onChosen?: () => void }) {
  const { filters, set } = useReportFilters();
  return (
    <div className="flex flex-col gap-3">
      {(filters.unit || filters.without || filters.parish) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream px-3 py-2 font-sans text-[14px]">
          <span>
            Now: <strong>{filters.parish ? parishFilterLabel(filters.parish, parish) : filters.without ? `Parishes with no ${filters.without}` : placeName(unit)}</strong>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              set(PLACE_PARAMS);
              onChosen?.();
            }}
          >
            Show every place
          </Button>
        </div>
      )}
      <UnitFinder
        label="Continent, region or province"
        action="Choose"
        onChoose={(chosen) => {
          set({ ...PLACE_PARAMS, unit: chosen.id });
          onChosen?.();
        }}
      />
    </div>
  );
}

function PlaceFilter({ unit, parish }: { unit: ReportSummary['unit']; parish: ReportSummary['parish'] }) {
  const { filters } = useReportFilters();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className={labelClass}>
        Place
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <FieldButton id={id} labelId={`${id}-label`} icon={MapPinIcon}>
            {filters.parish && filters.parish !== 'any' && filters.parish !== 'none'
              ? (parish?.name ?? 'The chosen parish')
              : filters.without
                ? `No ${filters.without}`
                : filters.unit
                  ? unit
                    ? placeName(unit)
                    : 'The chosen place'
                  : 'All places'}
          </FieldButton>
        </PopoverTrigger>
        <PopoverContent className="w-96" align="end" aria-label="Choose a place">
          <PlaceChooser unit={unit} parish={parish} onChosen={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** The shared filters: inline from tablets up, in a sheet on phones. They live in the URL, so every report and the Applicants list see the same ones. */
export function ReportFilterBar({
  cohorts,
  unit,
  parish,
  hide = [],
}: {
  cohorts: ReportCohort[];
  unit: ReportSummary['unit'];
  parish: ReportSummary['parish'];
  hide?: ReportFilterKey[];
}) {
  const { filters, set, clearAll, active } = useReportFilters();
  const canDirectory = useCan('directory.view');
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetId = useId();
  const withPlace = canDirectory && !hide.includes('unit');
  const choices = (
    <>
      {!hide.includes('cohort') && (
        <ChoiceFilter label="Cohort" value={filters.cohort} anyLabel="All cohorts" options={cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name }))} onChange={(value) => set({ cohort: value })} />
      )}
      <ChoiceFilter
        label="Review status"
        value={filters.status}
        anyLabel="Any status"
        options={APPLICATION_STATUSES.map((status) => ({ value: status, label: REVIEW_STATUS_LABELS[status] }))}
        onChange={(value) => set({ status: value })}
      />
      <ChoiceFilter
        label="Published to applicant"
        value={filters.published}
        anyLabel="Anything published"
        options={APPLICATION_STATUSES.map((status) => ({ value: status, label: PUBLISHED_STATUS_LABELS[status].label }))}
        onChange={(value) => set({ published: value })}
      />
    </>
  );
  return (
    <section aria-label="Report filters">
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="inline-flex items-center gap-2">
                <ListFilterIcon aria-hidden="true" />
                Filters
              </span>
              {active > 0 && <Badge variant="brand">{active} on</Badge>}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Every report, and the Applicants list, uses the same filters.</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <div role="group" aria-labelledby={`${sheetId}-period`} className="flex flex-col gap-2">
                <p id={`${sheetId}-period`} className={labelClass}>
                  Period: {periodLabel(filters.from, filters.to, todayInLagos())}
                </p>
                <PeriodPanel />
              </div>
              {choices}
              {withPlace && (
                <div role="group" aria-labelledby={`${sheetId}-place`} className="flex flex-col gap-2">
                  <p id={`${sheetId}-place`} className={labelClass}>
                    Place
                  </p>
                  <PlaceChooser unit={unit} parish={parish} />
                </div>
              )}
            </SheetBody>
            <SheetFooter>
              <Button variant="ghost" disabled={!active} onClick={clearAll}>
                Clear all
              </Button>
              <Button onClick={() => setSheetOpen(false)}>Show results</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
      <Card className="hidden py-4 sm:py-4 md:flex">
        <div className={cn('grid gap-3 px-4 md:grid-cols-3', withPlace && !hide.includes('cohort') ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
          <PeriodFilter />
          {choices}
          {withPlace && <PlaceFilter unit={unit} parish={parish} />}
        </div>
      </Card>
    </section>
  );
}

/** What the report covers: the period and every active filter, each removable. */
export function ReportingOn({
  cohorts,
  unit,
  parish,
  hide = [],
}: {
  cohorts: ReportCohort[];
  unit: ReportSummary['unit'];
  parish: ReportSummary['parish'];
  hide?: ReportFilterKey[];
}) {
  const { filters, set, clearAll, active } = useReportFilters();
  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (filters.cohort && !hide.includes('cohort')) chips.push({ key: 'cohort', label: cohorts.find((cohort) => cohort.id === filters.cohort)?.name ?? 'One cohort', clear: { cohort: null } });
  if (filters.status) chips.push({ key: 'status', label: `Review: ${REVIEW_STATUS_LABELS[filters.status as keyof typeof REVIEW_STATUS_LABELS] ?? filters.status}`, clear: { status: null } });
  if (filters.published) {
    chips.push({ key: 'published', label: `Published: ${PUBLISHED_STATUS_LABELS[filters.published as keyof typeof PUBLISHED_STATUS_LABELS]?.label ?? filters.published}`, clear: { published: null } });
  }
  // Removing a place also removes the parish chosen in it.
  if (filters.unit) chips.push({ key: 'unit', label: filters.direct === '1' ? `Directly under ${placeName(unit)}` : `Within ${placeName(unit)}`, clear: { unit: null, direct: null, parish: null } });
  if (filters.without) chips.push({ key: 'without', label: `Parishes with no ${filters.without}`, clear: { without: null } });
  if (filters.parish) chips.push({ key: 'parish', label: parishFilterLabel(filters.parish, parish), clear: { parish: null } });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-sans text-[14px] text-ink">
      <p>
        <span className="font-semibold">Reporting on</span> applications submitted {periodText(filters.from || null, filters.to || null)}
        {chips.length ? ', filtered to:' : '.'}
      </p>
      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.key} className="inline-flex items-center gap-0.5 rounded-full border border-rose bg-rose/45 py-0.5 pr-0.5 pl-3 text-[13px] font-semibold text-brand-deep">
              {chip.label}
              <button
                type="button"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={() => set(chip.clear)}
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-white"
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {active > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <FilterXIcon aria-hidden="true" />
          Clear all
        </Button>
      )}
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** A section heading inside a report, with an optional line under it. */
export function SectionHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="font-sans text-[19px] font-bold text-ink">
        {title}
      </h2>
      {children && <p className="max-w-[760px] font-sans text-[14px] leading-[1.5] text-muted">{children}</p>}
    </div>
  );
}

/** A key figure: what it counts, the number, what it covers, and a comparison when there is a real one. Goes in a <dl>. */
export function MetricCard({
  label,
  value,
  context,
  icon: Icon,
  comparison,
  extra,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  icon?: LucideIcon;
  comparison?: Comparison | null;
  extra?: ReactNode;
}) {
  return (
    <Card className="gap-2.5">
      <div className="flex items-start justify-between gap-3 px-5 sm:px-6">
        <dt className="pt-1 font-sans text-[14px] font-semibold text-muted">{label}</dt>
        {Icon && (
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose/55 text-brand">
            <Icon className="size-[18px]" />
          </span>
        )}
      </div>
      <dd className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-5 sm:px-6">
        <span className="font-sans text-[32px] leading-none font-bold tabular-nums text-ink">{value}</span>
        {comparison?.badge && (
          <Badge aria-hidden="true" variant={comparison.direction === 'up' ? 'brand' : 'neutral'}>
            {comparison.direction === 'up' && <ArrowUpRightIcon />}
            {comparison.direction === 'down' && <ArrowDownRightIcon />}
            {comparison.badge}
          </Badge>
        )}
      </dd>
      <dd className="px-5 font-sans text-[13px] leading-[1.5] text-muted sm:px-6">{context}</dd>
      {comparison && <dd className="px-5 font-sans text-[13px] leading-[1.5] font-semibold text-ink sm:px-6">{comparison.text}</dd>}
      {extra && <dd className="px-5 font-sans text-[13px] leading-[1.5] sm:px-6">{extra}</dd>}
    </Card>
  );
}

/** A report card: a heading, what it shows, its content (a chart, figures) and its actions at the bottom. */
export function ReportCard({
  title,
  description,
  children,
  actions,
  aside,
  headingLevel = 3,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const id = useId();
  return (
    <Card as="section" aria-labelledby={id} className={className}>
      <CardHeader>
        <CardTitle as={headingLevel === 2 ? 'h2' : 'h3'} id={id}>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {aside && <CardAction className="flex flex-wrap gap-1.5">{aside}</CardAction>}
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-4">{children}</CardContent>}
      {actions && <CardFooter>{actions}</CardFooter>}
    </Card>
  );
}

/** A link styled as a small button (a card's actions): outline by default, ghost for the quieter one. */
export function ActionLink({
  to,
  children,
  label,
  variant = 'outline',
  arrow = true,
}: {
  to: string;
  children: ReactNode;
  label?: string;
  variant?: ButtonVariantProps['variant'];
  arrow?: boolean;
}) {
  return (
    <Button asChild variant={variant} size="sm">
      <Link to={to} aria-label={label}>
        {children}
        {arrow && <ArrowRightIcon aria-hidden="true" />}
      </Link>
    </Button>
  );
}

// ── States ────────────────────────────────────────────────────────────────────

/** Nothing to show, and why, with the way out. */
export function EmptyState({ icon: Icon = InboxIcon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong/50 bg-white/70 px-6 py-10 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-cream text-muted">
        <Icon className="size-6" />
      </span>
      <p className="font-sans text-[16px] font-bold text-ink">{title}</p>
      {children && <div className="flex max-w-[540px] flex-col gap-2 font-sans text-[14px] leading-[1.55] text-muted">{children}</div>}
      {action}
    </div>
  );
}

/** Empty under the current filters: offers to clear them. */
export function EmptyReport({ title, children }: { title: string; children?: ReactNode }) {
  const { active, clearAll } = useReportFilters();
  return (
    <EmptyState
      title={title}
      action={
        active > 0 ? (
          <Button variant="outline" onClick={clearAll}>
            <FilterXIcon aria-hidden="true" />
            Clear all filters
          </Button>
        ) : undefined
      }
    >
      {children}
    </EmptyState>
  );
}

/** A part of a report that couldn't load, with a retry. */
export function ReportError({ error, onRetry, what = 'This report' }: { error: unknown; onRetry?: () => void; what?: string }) {
  return (
    <Alert variant="error">
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>{what} couldn’t be loaded.</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error)}</p>
        {onRetry && (
          <div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCwIcon aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Placeholders shaped like the report while its figures load; the status line tells assistive technology. */
export function ReportSkeleton({ metrics = 4, cards = 2 }: { metrics?: number; cards?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading the report…
      </p>
      {metrics > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: metrics }, (_, index) => (
            <Card key={index} className="gap-3 px-5 sm:px-6">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </Card>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: cards }, (_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ height = 180 }: { height?: number }) {
  return (
    <Card className="gap-4 px-5 sm:px-6">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="w-full rounded-xl" style={{ height }} />
    </Card>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────

export type ReportContext = { summary: ReportSummary; cohorts: ReportCohort[] };

/**
 * A report's page: its heading, the reports, the filters and what they cover, then the report
 * itself once the summary for these filters has loaded (every report uses it).
 */
export function ReportPage({
  title,
  description,
  hide,
  children,
}: {
  /** The heading, or a function of the summary (undefined while it loads): the drill-down names the place open. */
  title: string | ((summary: ReportSummary | undefined) => string);
  description: ReactNode | ((summary: ReportSummary | undefined) => ReactNode);
  hide?: ReportFilterKey[];
  children: (context: ReportContext) => ReactNode;
}) {
  const { query, set } = useReportFilters();
  const summary = useAsync((signal) => adminApi.reportSummary(query, signal), [JSON.stringify(query)]);
  // The cohorts' names, for the filter (every cohort, whatever the filters).
  const cohorts = useAsync((signal) => adminApi.reportCohorts({}, signal), []);
  const cohortList = cohorts.data?.items ?? [];
  const unit = summary.data?.unit ?? null;
  const parish = summary.data?.parish ?? null;
  // A link to a place that doesn't exist, or a parish outside the place it names: offer the way back to every place.
  const badPlace = summary.error instanceof ApiError && (summary.error.status === 400 || summary.error.status === 404);
  const heading = badPlace ? 'Place not found' : typeof title === 'function' ? title(summary.data) : title;
  return (
    <>
      <PageHeader
        eyebrow="Reports and analytics"
        title={heading}
        documentTitle={`${heading} · Admin`}
        description={typeof description === 'function' ? description(summary.data) : description}
      />
      <ReportNav />
      <ReportFilterBar cohorts={cohortList} unit={unit} parish={parish} hide={hide} />
      <ReportingOn cohorts={cohortList} unit={unit} parish={parish} hide={hide} />
      {badPlace ? (
        <Alert variant="error">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>This place can’t be shown.</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(summary.error)} The link may be out of date, or the directory may have changed.</p>
            <div>
              <Button variant="outline" size="sm" onClick={() => set(PLACE_PARAMS)}>
                Show every place
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : summary.error ? (
        <ReportError error={summary.error} onRetry={summary.reload} />
      ) : !summary.data ? (
        <ReportSkeleton />
      ) : (
        children({ summary: summary.data, cohorts: cohortList })
      )}
    </>
  );
}
