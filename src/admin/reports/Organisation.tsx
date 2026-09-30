import {
  ArrowLeftIcon,
  ChurchIcon,
  DownloadIcon,
  FileTextIcon,
  FilterXIcon,
  InfoIcon,
  LayoutGridIcon,
  LinkIcon,
  MapIcon,
  SearchIcon,
  SearchXIcon,
  Table2Icon,
  UsersIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Checkbox, Pagination, when } from '../../components/ui';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../../components/ui/breadcrumb';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { APPLICATION_STATUSES, PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS, type ApplicationStatus } from '../../shared/platform';
import { adminApi, type ReportCard as Card_, type ReportListing, type ReportParish, type ReportSort, type ReportSummary, type StatusCounts } from '../api';
import { DirectoryStatusBadge, LEVEL_LABELS, plural, useFocusOnPlaceChange } from '../directory-parts';
import { useCan } from '../session';
import { CompareChart, LazyPart, PlaceTable } from './lazy';
import { compare, formatCount, periodText } from './model';
import {
  ActionLink,
  applicantsHref,
  CardSkeleton,
  EmptyReport,
  EmptyState,
  MetricCard,
  PLACE_PARAMS,
  ReportCard,
  ReportError,
  ReportPage,
  SectionHeading,
  useReportFilters,
} from './parts';
import { PlaceCard } from './PlaceCard';
import { listed } from './places';
import { STATUS_COLOURS, StatusMeter } from './visuals';

const LEVEL_TABS = [
  { level: 'continent', label: 'Continents' },
  { level: 'region', label: 'Regions' },
  { level: 'province', label: 'Provinces' },
  { level: 'parish', label: 'Parishes' },
] as const;
const PAGE_SIZE = 12;
const APPLICATIONS_PAGE_SIZE = 10;

const isParishId = (value: string | null | undefined): value is string => Boolean(value && value !== 'any' && value !== 'none');

/** This report's address with some parameters changed (null removes one), back at the first page. */
function nextSearch(params: URLSearchParams, changes: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete('page');
  return `?${next}`;
}

/** The heading names the place open: the parish, the unit, or what the top level lists. */
function titleFor(summary: ReportSummary | undefined, params: URLSearchParams): string {
  if (isParishId(params.get('parish'))) return summary?.parish?.name ?? 'Parish';
  if (params.get('unit')) return summary?.unit?.name ?? 'Place';
  const without = params.get('without');
  if (without) return `Parishes with no ${without}`;
  const tab = LEVEL_TABS.find((entry) => entry.level === params.get('level'));
  return `All ${(tab?.label ?? 'Continents').toLowerCase()}`;
}

function descriptionFor(summary: ReportSummary | undefined, params: URLSearchParams): ReactNode {
  if (isParishId(params.get('parish'))) {
    const parish = summary?.parish;
    return parish ? `Parish in ${[...parish.chain].reverse().map((unit) => unit.name).join(', ')}, in today's RCCG directory.` : 'A parish in the RCCG directory.';
  }
  const unit = summary?.unit;
  if (params.get('unit') && unit) return `${LEVEL_LABELS[unit.level]} in today's RCCG directory. Each card is one level down: open it to go further.`;
  return "Applications by where each applicant's parish is in today's RCCG directory. Open a continent to see its regions, then provinces, parishes and each parish's applications.";
}

/** Applications by continent, region, province and parish: a drill-down from the continents to one parish's applications. */
export default function OrganisationReportPage() {
  const { params } = useReportFilters();
  const chosen = params.get('parish');
  return (
    <ReportPage title={(summary) => titleFor(summary, params)} description={(summary) => descriptionFor(summary, params)}>
      {({ summary }) =>
        isParishId(chosen) ? (
          summary.parish?.id === chosen ? (
            <ParishView key={chosen} summary={summary} parish={summary.parish} />
          ) : (
            <CardSkeleton />
          )
        ) : (
          <Organisation summary={summary} />
        )
      }
    </ReportPage>
  );
}

// ── The levels ──────────────────────────────────────────────────────────────────

function Organisation({ summary }: { summary: ReportSummary }) {
  const { params, query, set, carry } = useReportFilters();
  const canApplicants = useCan('applications.view_all');
  const level = params.get('level') ?? '';
  const q = params.get('q') ?? '';
  const include = params.get('include') ?? '';
  const view = params.get('view') === 'table' ? 'table' : 'cards';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const listingQuery: Record<string, string | undefined> = {
    ...query,
    level: query.unit ? undefined : level || undefined,
    q: q || undefined,
    sort: params.get('sort') || undefined,
    dir: params.get('dir') || undefined,
    include: include || undefined,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  };
  const listing = useAsync((signal) => adminApi.reportUnits(listingQuery, signal), [JSON.stringify(listingQuery)]);
  const data = listing.data;
  const whereNav = useFocusOnPlaceChange(data ? `${data.within?.id ?? ''}|${data.level ?? ''}|${data.direct}|${data.without ?? ''}` : null);

  const here = useCallback((changes: Record<string, string | null | undefined>) => nextSearch(params, changes), [params]);
  /** Opening a card: the level below it (clearing what was chosen beneath the old place), or a parish's own view. */
  const drillHref = useCallback(
    (card: Card_) => {
      if (!card.drill) return null;
      if (card.drill.parish) return here({ parish: card.drill.parish, q: null, include: null });
      return here({ ...PLACE_PARAMS, unit: card.drill.unit, direct: card.drill.direct, level: card.drill.level, without: card.drill.without });
    },
    [here],
  );
  const applicantsFor = useCallback(
    (card: Card_) => (canApplicants && card.applications !== 0 && card.kind !== 'parish' ? applicantsHref(query, card.filter) : null),
    [canApplicants, query],
  );
  const answersFor = useCallback((card: Card_) => (card.kind === 'unassigned' ? `/admin/reports/parish-answers?${carry()}` : null), [carry]);
  const atTop = !query.unit && !query.without;

  // One level up: the unit above, or all continents.
  let back: { href: string; label: string } | null = null;
  if (data && !atTop) {
    if (data.direct && data.within) back = { href: here({ direct: null, q: null, include: null }), label: `Back to ${data.within.name}` };
    else {
      const parent = data.within ? data.ancestors.at(-1) : undefined;
      back = parent ? { href: here({ ...PLACE_PARAMS, unit: parent.id }), label: `Back to ${parent.name}` } : { href: here(PLACE_PARAMS), label: 'Back to all continents' };
    }
  }

  const listingArea = (
    <PlacesListing
      listing={listing}
      summary={summary}
      view={view}
      noun={data ? listed(data).noun : 'places'}
      drillHref={drillHref}
      applicantsFor={applicantsFor}
      answersFor={answersFor}
      canApplicants={canApplicants}
      onView={(next) => set({ view: next === 'cards' ? null : 'table' })}
      csvHref={adminApi.reportUnitsCsvUrl({ ...listingQuery, page: undefined, pageSize: undefined })}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Breadcrumb ref={whereNav} aria-label="Where you are">
          <BreadcrumbList>
            <BreadcrumbItem>
              {atTop ? (
                <BreadcrumbPage tabIndex={-1}>{data ? listed(data).title : 'All continents'}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={here(PLACE_PARAMS)}>All continents</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {data?.ancestors.map((ancestor) => (
              <BreadcrumbItem key={ancestor.id}>
                <BreadcrumbSeparator />
                <BreadcrumbLink asChild>
                  <Link to={here({ ...PLACE_PARAMS, unit: ancestor.id })}>{ancestor.name}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            ))}
            {data?.within && (
              <BreadcrumbItem>
                <BreadcrumbSeparator />
                {data.direct ? (
                  <BreadcrumbLink asChild>
                    <Link to={here({ direct: null, q: null, include: null })}>{data.within.name}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage tabIndex={-1}>{data.within.name}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            )}
            {(data?.direct || (data?.without && !data.within)) && (
              <BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbPage tabIndex={-1}>{data.direct ? 'Directly under it' : `Parishes with no ${data.without}`}</BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        {back && <BackLink href={back.href} label={back.label} />}
      </div>

      {atTop ? (
        <Tabs value={level || 'continent'} activationMode="manual" onValueChange={(next) => set({ level: next === 'continent' ? null : next, q: null, include: null, sort: null, dir: null })}>
          <TabsList aria-label="List by" className="grid w-full grid-cols-2 rounded-2xl sm:inline-flex sm:w-fit sm:rounded-full">
            {LEVEL_TABS.map((tab) => (
              <TabsTrigger key={tab.level} value={tab.level} className="rounded-xl sm:rounded-full">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={level || 'continent'} tabIndex={-1}>
            {listingArea}
          </TabsContent>
        </Tabs>
      ) : (
        listingArea
      )}

      <PolicyNote summary={summary} />
    </>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link to={href} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 self-start font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline sm:self-auto">
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}

/** How places are counted: today's directory, the documented policy (docs/05, D-32 and D-36). */
function PolicyNote({ summary }: { summary: ReportSummary }) {
  return (
    <p className="max-w-[860px] font-sans text-[13px] leading-[1.5] text-muted">
      Applications are counted where each applicant’s parish is in today’s RCCG directory
      {summary.directory ? ` (${summary.directory.label}${summary.directory.structureAsAt ? `, correct as at ${summary.directory.structureAsAt}` : ''})` : ''}: if the directory moves a
      parish, its applications move with it. The parish and places each applicant confirmed stay on their application. Counts are applications, not church membership or
      attendance.
    </p>
  );
}

const STATUS_SORT_WORDS: Record<ApplicationStatus, string> = {
  submitted: 'new (not yet reviewed)',
  under_review: 'under review',
  shortlisted: 'shortlisted',
  invited: 'invited',
  not_selected: 'not selected',
  withdrawn: 'withdrawn',
};

/** "Most applications", "Name (Z to A)", "Fewest shortlisted"… */
function sortLabel(sort: ReportSort, dir: 'asc' | 'desc'): string {
  if (sort === 'name') return dir === 'asc' ? 'Name (A to Z)' : 'Name (Z to A)';
  const word = sort === 'applications' ? 'applications' : sort === 'parishes' ? 'parishes with applications' : STATUS_SORT_WORDS[sort];
  return `${dir === 'desc' ? 'Most' : 'Fewest'} ${word}`;
}

type CardLinks = {
  drillHref: (card: Card_) => string | null;
  applicantsFor: (card: Card_) => string | null;
  answersFor: (card: Card_) => string | null;
  canApplicants: boolean;
};

function PlacesListing({
  listing,
  summary,
  view,
  noun,
  onView,
  csvHref,
  ...links
}: {
  listing: AsyncState<ReportListing>;
  summary: ReportSummary;
  view: 'cards' | 'table';
  noun: string;
  onView: (view: 'cards' | 'table') => void;
  csvHref: string;
} & CardLinks) {
  const { params, set } = useReportFilters();
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const data = listing.data;
  const units = data ? data.mode !== 'parishes' : true;
  const sort = data?.sort ?? 'applications';
  const dir = data?.dir ?? 'desc';
  const options: { sort: ReportSort; dir: 'asc' | 'desc' }[] = [
    { sort: 'applications', dir: 'desc' },
    { sort: 'applications', dir: 'asc' },
    { sort: 'name', dir: 'asc' },
    { sort: 'name', dir: 'desc' },
    ...(data?.masked ? [] : [...(units ? [{ sort: 'parishes' as const, dir: 'desc' as const }] : []), ...APPLICATION_STATUSES.map((status) => ({ sort: status, dir: 'desc' as const }))]),
  ];
  if (!options.some((option) => option.sort === sort && option.dir === dir)) options.push({ sort, dir });
  const chooseSort = (next: ReportSort, nextDir: 'asc' | 'desc') => {
    const isDefault = next === 'applications' && nextDir === 'desc';
    set({ sort: isDefault ? null : next, dir: isDefault ? null : nextDir });
  };

  return (
    <Tabs value={view} onValueChange={(next) => onView(next as 'cards' | 'table')}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <form
            role="search"
            className="flex min-w-[min(100%,260px)] flex-[2_1_320px] items-end gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              set({ q: search.trim() || null });
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="place-search" className="font-sans text-[13px] font-semibold text-ink">
                Find {noun} by name
              </label>
              <div className="relative">
                <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <Input id="place-search" type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} className="pl-9" />
              </div>
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          <div className="flex min-w-[min(100%,220px)] flex-[1_1_220px] flex-col gap-1.5">
            <label htmlFor="place-sort" className="font-sans text-[13px] font-semibold text-ink">
              Sort by
            </label>
            <Select
              value={`${sort}:${dir}`}
              onValueChange={(value) => {
                const [next, nextDir] = value.split(':') as [ReportSort, 'asc' | 'desc'];
                chooseSort(next, nextDir);
              }}
            >
              <SelectTrigger id="place-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={`${option.sort}:${option.dir}`} value={`${option.sort}:${option.dir}`}>
                    {sortLabel(option.sort, option.dir)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList aria-label="Show as">
              <TabsTrigger value="cards">
                <LayoutGridIcon aria-hidden="true" />
                Cards
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table2Icon aria-hidden="true" />
                Table
              </TabsTrigger>
            </TabsList>
            <Button asChild variant="outline">
              <a href={csvHref} download>
                <DownloadIcon aria-hidden="true" />
                Download CSV
              </a>
            </Button>
          </div>
        </div>
        {data && <Checkbox label="With applications only" checked={!data.includeAll} onChange={(event) => set({ include: event.currentTarget.checked ? 'applications' : null })} />}
      </div>

      {listing.error ? (
        <ReportError what="The places" error={listing.error} onRetry={listing.reload} />
      ) : !data ? (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <p role="status" className="sr-only">
            Loading the places…
          </p>
          {Array.from({ length: 6 }, (_, index) => (
            <CardSkeleton key={index} height={96} />
          ))}
        </div>
      ) : (
        <div aria-busy={listing.loading} className={listing.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <Results data={data} summary={summary} onSort={chooseSort} {...links} />
        </div>
      )}
    </Tabs>
  );
}

function Results({ data, summary, onSort, ...links }: { data: ReportListing; summary: ReportSummary; onSort: (sort: ReportSort, dir: 'asc' | 'desc') => void } & CardLinks) {
  const { set, active, clearAll } = useReportFilters();
  const { noun, one, title } = listed(data);
  if (!data.total && !data.extras.length && data.search) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title={`No ${noun} match “${data.search}”.`}
        action={
          <Button variant="outline" onClick={() => set({ q: null })}>
            Clear the search
          </Button>
        }
      >
        <p>Check the spelling, or search for part of the name.</p>
      </EmptyState>
    );
  }
  const where = data.within ? ` in ${data.within.name}` : '';
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);
  const paged = data.total > data.pageSize || data.page > 1;
  const compared = data.items.filter((card) => card.applications !== 0);
  const clearFilters = active > 0 && (
    <Button variant="ghost" onClick={clearAll}>
      <FilterXIcon aria-hidden="true" />
      Clear all filters
    </Button>
  );
  const card = (item: Card_) => (
    <li key={item.key} className="flex">
      <PlaceCard card={item} drill={links.drillHref(item)} applicants={links.applicantsFor(item)} answers={links.answersFor(item)} canApplicants={links.canApplicants} />
    </li>
  );

  return (
    <section aria-labelledby="listing-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="listing-heading" className="font-sans text-[19px] font-bold text-ink">
          {title}
        </h2>
        <p className="font-sans text-[14px] text-muted">
          {!data.total ? `No ${noun} listed` : paged ? `${from}–${to} of ${data.total} ${noun}` : plural(data.total, one, noun)}
          {data.search ? ` matching “${data.search}”` : ''} · {formatCount(data.totals.applications)} {data.totals.applications === 1 ? 'application' : 'applications'} in all
          {data.extras.length ? `, counting those outside any ${one}` : ''}.
        </p>
      </div>

      {!data.total &&
        (!data.includeAll ? (
          // Units are there, but the filters leave none with applications.
          <EmptyState
            title={`No applications match these filters${where}.`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => set({ include: null })}>
                  Show all {noun}
                </Button>
                {clearFilters}
              </div>
            }
          >
            <p>“With applications only” is on, so {noun} with no applications are hidden.</p>
          </EmptyState>
        ) : (
          // Nothing in the directory here at all.
          <EmptyState icon={MapIcon} title="No organisational units found.">
            <p>
              {!data.within && !summary.activeParishes
                ? "The RCCG parish list hasn't been imported, so there are no continents, regions, provinces or parishes yet. The other reports still work."
                : `Today's directory lists no ${noun}${where}.`}
            </p>
          </EmptyState>
        ))}

      {data.total > 0 && data.totals.applications === 0 && (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>No applications match these filters{where}.</AlertTitle>
          <AlertDescription>
            <p>
              The {noun} are listed with no applications. Change the period or the other filters to see others{active > 0 ? ', or clear them' : ''}.
            </p>
            {clearFilters && <div>{clearFilters}</div>}
          </AlertDescription>
        </Alert>
      )}

      {data.total > 0 && (
        <>
          <TabsContent value="cards" tabIndex={-1} className="gap-5">
            {compared.length > 1 && (
              <Card as="section" aria-labelledby="compare-heading" className="gap-3">
                <div className="flex flex-col gap-1 px-5 sm:px-6">
                  <h3 id="compare-heading" className="font-sans text-[16px] font-bold text-ink">
                    Compare {noun}
                  </h3>
                  <p className="font-sans text-[13px] leading-[1.5] text-muted">
                    The {plural(compared.length, one, noun)} {paged ? 'on this page ' : ''}with applications, each split by review status. The cards below give every number
                    {data.masked ? '; counts of fewer than 5 aren’t drawn' : ''}.
                  </p>
                </div>
                <figure className="m-0 flex flex-col gap-3 px-5 sm:px-6">
                  <LazyPart what="chart" height={compared.length * 40 + 36}>
                    <CompareChart rows={compared.map((item) => ({ key: item.key, name: item.name, byStatus: item.byStatus }))} />
                  </LazyPart>
                  <figcaption>
                    <ul aria-label="Colours" className="flex flex-wrap gap-x-4 gap-y-1 font-sans text-[13px] text-muted">
                      {APPLICATION_STATUSES.filter((status) => compared.some((item) => item.byStatus[status])).map((status) => (
                        <li key={status} className="inline-flex items-center gap-1.5">
                          <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ backgroundColor: STATUS_COLOURS[status] }} />
                          {REVIEW_STATUS_LABELS[status]}
                        </li>
                      ))}
                    </ul>
                  </figcaption>
                </figure>
              </Card>
            )}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{data.items.map(card)}</ul>
          </TabsContent>
          <TabsContent value="table" tabIndex={-1}>
            <LazyPart what="table" height={480}>
              <PlaceTable data={data} drillHref={links.drillHref} applicantsFor={links.applicantsFor} onSort={onSort} />
            </LazyPart>
          </TabsContent>
        </>
      )}

      {data.extras.length > 0 && (
        <section aria-labelledby="outside-heading" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="outside-heading" className="font-sans text-[16px] font-bold text-ink">
              Outside any {one}
            </h3>
            <p className="font-sans text-[13px] leading-[1.5] text-muted">Counted here so the totals add up: nothing in scope is left out.</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{data.extras.map(card)}</ul>
        </section>
      )}
      {paged && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(next) => set({ page: String(next) })} />}
    </section>
  );
}

// ── A parish ────────────────────────────────────────────────────────────────────

function ParishView({ summary, parish }: { summary: ReportSummary; parish: ReportParish }) {
  const { params } = useReportFilters();
  const canApplicants = useCan('applications.view_all');
  const canExport = useCan('applications.export');
  const whereNav = useFocusOnPlaceChange(parish.id);
  const containing = parish.unit;
  // A parish in a province is listed with the province's parishes; one straight under a region or continent, with those directly under it.
  const directly = containing.level !== 'province';
  const back = nextSearch(params, { ...PLACE_PARAMS, unit: containing.id, direct: directly ? '1' : null });

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Breadcrumb ref={whereNav} aria-label="Where you are">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={nextSearch(params, PLACE_PARAMS)}>All continents</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {parish.chain.map((unit) => (
              <BreadcrumbItem key={unit.id}>
                <BreadcrumbSeparator />
                <BreadcrumbLink asChild>
                  <Link to={nextSearch(params, { ...PLACE_PARAMS, unit: unit.id })}>{unit.name}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            ))}
            <BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbPage tabIndex={-1}>{parish.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <BackLink href={back} label={directly ? `Back to parishes directly under ${containing.name}` : `Back to ${containing.name}`} />
      </div>

      {parish.status !== 'active' && (
        <Alert variant="warning">
          <InfoIcon aria-hidden="true" />
          <AlertTitle className="flex flex-wrap items-center gap-2">
            <DirectoryStatusBadge status={parish.status} /> {parish.status === 'merged' ? 'This parish was merged into another.' : "This parish is no longer in the RCCG list."}
          </AlertTitle>
          <AlertDescription>
            {parish.mergedInto ? (
              <p>
                Its applications moved to{' '}
                <Link to={nextSearch(params, { ...PLACE_PARAMS, parish: parish.mergedInto.id })} className="font-bold text-brand underline underline-offset-4">
                  {parish.mergedInto.name}
                </Link>
                . These figures cover any applications still linked here.
              </p>
            ) : (
              <p>Applications stay linked to it until staff link them elsewhere.</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {summary.applications === 0 ? (
        <EmptyReport title="No applications from this parish match these filters.">
          <p>Change the period or the other filters, or go back to see the rest of {containing.name}.</p>
        </EmptyReport>
      ) : (
        <>
          <section aria-labelledby="parish-figures" className="flex flex-col gap-3">
            <SectionHeading id="parish-figures" title="Key figures" />
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={FileTextIcon}
                label="Applications"
                value={formatCount(summary.applications)}
                context={`Submitted ${periodText(summary.period.from, summary.period.to)} by applicants whose parish this is.`}
                comparison={compare(summary.applications, summary.comparison)}
              />
              <MetricCard icon={UsersIcon} label="Unique applicants" value={formatCount(summary.uniqueApplicants)} context="People, counted once by email address, whichever cohorts they applied to." />
              <MetricCard icon={ChurchIcon} label="Chosen by the applicant" value={formatCount(summary.answers.listed)} context="They picked this parish from the RCCG list on the form." />
              <MetricCard icon={LinkIcon} label="Linked by staff" value={formatCount(summary.linkedByStaff)} context="They typed a name or gave none, and staff linked this parish." />
            </dl>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <ReportCard headingLevel={2} title="Review status" description="Where these applications are in review.">
              <StatusMeter counts={summary.byStatus} label={`${parish.name}: applications by review status`} legend={false} />
              <StatusList counts={summary.byStatus} kind="review" />
            </ReportCard>
            <ReportCard headingLevel={2} title="Published to applicants" description="What applicants can see: a status shows only once staff publish it.">
              <StatusMeter counts={summary.byPublished} kind="published" label={`${parish.name}: applications by published status`} legend={false} />
              <StatusList counts={summary.byPublished} kind="published" />
            </ReportCard>
          </div>
        </>
      )}

      {canApplicants ? (
        <ParishApplications parish={parish} canExport={canExport} />
      ) : (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>The applications themselves aren’t shown to your role.</AlertTitle>
          <AlertDescription>
            <p>These figures are totals only. Seeing applicants needs permission to view all applications; ask an owner if you need it.</p>
          </AlertDescription>
        </Alert>
      )}
      <PolicyNote summary={summary} />
    </>
  );
}

/** Every status with its count, as text beside the bar. */
function StatusList({ counts, kind }: { counts: StatusCounts; kind: 'review' | 'published' }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 font-sans text-[14px]">
      {APPLICATION_STATUSES.map((status) => (
        <Fragment key={status}>
          <dt className="inline-flex items-center gap-2 text-muted">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: STATUS_COLOURS[status] }} />
            {kind === 'review' ? REVIEW_STATUS_LABELS[status] : PUBLISHED_STATUS_LABELS[status].label}
          </dt>
          <dd className="text-right font-bold tabular-nums text-ink">{formatCount(counts[status])}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The parish's applications (staff who can see applicants only; the API checks too), newest first, a page at a time. */
function ParishApplications({ parish, canExport }: { parish: ReportParish; canExport: boolean }) {
  const { params, filters, set } = useReportFilters();
  const page = Math.max(1, Number(params.get('page')) || 1);
  // The parish decides the place on its own: the unit in the address is only where the drill-down came from.
  const scope: Record<string, string> = Object.fromEntries(
    Object.entries({ cohort: filters.cohort, status: filters.status, published: filters.published, from: filters.from, to: filters.to, parish: parish.id }).filter(([, value]) => value),
  );
  const list = useAsync((signal) => adminApi.applicants({ ...scope, sort: 'newest', page, pageSize: APPLICATIONS_PAGE_SIZE }, signal), [JSON.stringify(scope), page]);
  const data = list.data;

  return (
    <section aria-labelledby="parish-applications" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading id="parish-applications" title="Applications">
          Newest first, under the filters above. Open one to review it.
        </SectionHeading>
        <div className="flex flex-wrap gap-2">
          <ActionLink to={applicantsHref(scope)} label={`Open ${parish.name}'s applications in Applicants`}>
            Open in Applicants
          </ActionLink>
          {canExport && (
            <Button asChild variant="outline" size="sm">
              <a href={adminApi.exportUrl(scope)} download>
                <DownloadIcon aria-hidden="true" />
                Download CSV
              </a>
            </Button>
          )}
        </div>
      </div>
      {list.error ? (
        <ReportError what="The applications" error={list.error} onRetry={list.reload} />
      ) : !data ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p role="status" className="sr-only">
            Loading the applications…
          </p>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[74px] w-full rounded-2xl" />
          ))}
        </div>
      ) : !data.total ? (
        <EmptyReport title="No applications from this parish match these filters." />
      ) : (
        <div aria-busy={list.loading} className={list.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ul className="flex flex-col gap-2">
            {data.items.map((row) => (
              <Card key={row.id} as="li" className="gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:py-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link to={`/admin/applicants/${row.id}`} className="font-sans text-[16px] font-bold text-brand underline-offset-4 hover:underline">
                    {row.fullName}
                  </Link>
                  <p className="font-sans text-[13px] text-muted">
                    {row.reference} · {row.cohortName} · Submitted {when(row.submittedAt)}
                  </p>
                </div>
                <dl className="flex flex-wrap gap-x-5 gap-y-1 font-sans text-[13px] sm:justify-end">
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Review status</dt>
                    <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ backgroundColor: STATUS_COLOURS[row.status] }} />
                    <dd className="font-semibold text-ink">{REVIEW_STATUS_LABELS[row.status]}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="text-muted">Published:</dt>
                    <dd className="text-ink">{PUBLISHED_STATUS_LABELS[row.publishedStatus].label}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </ul>
          {data.total > APPLICATIONS_PAGE_SIZE && (
            <div className="pt-3">
              <Pagination page={page} pageSize={APPLICATIONS_PAGE_SIZE} total={data.total} onPage={(next) => set({ page: String(next) })} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
