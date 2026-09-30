import { ChevronRightIcon, DownloadIcon, LayoutGridIcon, MapIcon, SearchIcon, SearchXIcon, Table2Icon, UsersIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Checkbox, Pagination } from '../../components/ui';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../../components/ui/breadcrumb';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import type { ChurchLevel } from '../../shared/directory';
import { APPLICATION_STATUSES, REVIEW_STATUS_LABELS } from '../../shared/platform';
import { adminApi, type ReportCard as Card_, type ReportListing, type ReportSort, type ReportSummary } from '../api';
import { DirectoryStatusBadge, plural, useFocusOnPlaceChange } from '../directory-parts';
import { useCan } from '../session';
import { CompareChart, LazyPart, PlaceTable } from './lazy';
import { formatCount } from './model';
import { ActionLink, applicantsHref, CardSkeleton, EmptyReport, EmptyState, ReportCard, ReportError, ReportPage, useReportFilters } from './parts';
import { describePlace, drillLabel, listed, plurals } from './places';
import { STATUS_COLOURS, StatusMeter } from './visuals';

const LEVEL_TABS = [
  { level: 'region', label: 'Regions' },
  { level: 'province', label: 'Provinces' },
  { level: 'parish', label: 'Parishes' },
  { level: 'continent', label: 'Continents' },
] as const;
const PAGE_SIZE = 12;

/** Applications by region, province and parish, with drill-down to each place's applications. */
export default function OrganisationReportPage() {
  return (
    <ReportPage
      title="Regions, provinces and parishes"
      description="Applications by where each applicant's parish is in today's RCCG directory. Open a region to see its provinces, a province to see its parishes, and any place to see its applications."
    >
      {({ summary }) => <Organisation summary={summary} />}
    </ReportPage>
  );
}

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

  /** A link within this report: keeps the filters and how it's shown (sort, cards or table); starts at page 1. */
  const here = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      next.delete('page');
      return `?${next}`;
    },
    [params],
  );
  const drillHref = useCallback(
    (card: Card_) =>
      card.drill ? here({ unit: card.drill.unit ?? null, direct: card.drill.direct ?? null, level: card.drill.level ?? null, without: card.drill.without ?? null, q: null, include: null }) : null,
    [here],
  );
  const applicantsFor = useCallback((card: Card_) => (canApplicants && card.applications !== 0 ? applicantsHref(query, card.filter) : null), [canApplicants, query]);
  const atTop = !query.unit && !query.without;
  const top = data ? listed(data) : null;
  const topName = data?.level && data.level !== 'parish' && !data.within ? `All ${plurals(data.level as ChurchLevel)}` : 'All regions';

  const listingArea = (
    <PlacesListing
      listing={listing}
      summary={summary}
      view={view}
      noun={top?.noun ?? 'places'}
      drillHref={drillHref}
      applicantsFor={applicantsFor}
      onView={(next) => set({ view: next === 'cards' ? null : 'table' })}
      csvHref={adminApi.reportUnitsCsvUrl({ ...listingQuery, page: undefined, pageSize: undefined })}
      unmatched={
        atTop && summary.withoutParish !== 0 ? (
          <Alert>
            <AlertDescription className="block">
              {formatCount(summary.withoutParish)} of these applications {summary.withoutParish === 1 ? 'has' : 'have'} no directory parish, so{' '}
              {summary.withoutParish === 1 ? "it isn't" : "they aren't"} in this report.{' '}
              <Link to={`/admin/reports/parish-answers?${carry()}`} className="font-bold text-brand underline underline-offset-4">
                See the parish answers
              </Link>
              {canApplicants && (
                <>
                  {' · '}
                  <Link to={applicantsHref(query, { parish: 'none' })} className="font-bold text-brand underline underline-offset-4">
                    View them
                  </Link>
                </>
              )}
            </AlertDescription>
          </Alert>
        ) : null
      }
    />
  );

  return (
    <>
      <Breadcrumb ref={whereNav} aria-label="Where you are">
        <BreadcrumbList>
          <BreadcrumbItem>
            {atTop ? (
              <BreadcrumbPage tabIndex={-1}>{top?.title ?? 'All regions'}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link to={here({ unit: null, direct: null, without: null, level: null, q: null, include: null })}>{data?.without ? topName : 'All regions'}</Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {data?.ancestors.map((ancestor) => (
            <BreadcrumbItem key={ancestor.id}>
              <BreadcrumbSeparator />
              <BreadcrumbLink asChild>
                <Link to={here({ unit: ancestor.id, direct: null, without: null, level: null, q: null, include: null })}>{ancestor.name}</Link>
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

      {atTop ? (
        <Tabs value={level || 'region'} activationMode="manual" onValueChange={(next) => set({ level: next === 'region' ? null : next, q: null, include: null, sort: null, dir: null })}>
          <TabsList aria-label="List by" className="grid w-full grid-cols-2 rounded-2xl sm:inline-flex sm:w-fit sm:rounded-full">
            {LEVEL_TABS.map((tab) => (
              <TabsTrigger key={tab.level} value={tab.level} className="rounded-xl sm:rounded-full">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={level || 'region'} tabIndex={-1}>
            {listingArea}
          </TabsContent>
        </Tabs>
      ) : (
        listingArea
      )}
    </>
  );
}

const STATUS_SORT_WORDS: Record<(typeof APPLICATION_STATUSES)[number], string> = {
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

function PlacesListing({
  listing,
  summary,
  view,
  noun,
  drillHref,
  applicantsFor,
  onView,
  csvHref,
  unmatched,
}: {
  listing: AsyncState<ReportListing>;
  summary: ReportSummary;
  view: 'cards' | 'table';
  noun: string;
  drillHref: (card: Card_) => string | null;
  applicantsFor: (card: Card_) => string | null;
  onView: (view: 'cards' | 'table') => void;
  csvHref: string;
  unmatched: ReactNode;
}) {
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
        {data && (
          <Checkbox label={`Include ${noun} with no applications`} checked={data.includeAll} onChange={(event) => set({ include: event.currentTarget.checked ? 'all' : 'applications' })} />
        )}
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
          <Results data={data} summary={summary} drillHref={drillHref} applicantsFor={applicantsFor} onSort={chooseSort} unmatched={unmatched} />
        </div>
      )}
    </Tabs>
  );
}

function Results({
  data,
  summary,
  drillHref,
  applicantsFor,
  onSort,
  unmatched,
}: {
  data: ReportListing;
  summary: ReportSummary;
  drillHref: (card: Card_) => string | null;
  applicantsFor: (card: Card_) => string | null;
  onSort: (sort: ReportSort, dir: 'asc' | 'desc') => void;
  unmatched: ReactNode;
}) {
  const { set } = useReportFilters();
  const { noun, one, title } = listed(data);
  if (!data.total && !data.extras.length) {
    if (data.search) {
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
    if (!summary.activeParishes && !summary.withParish) {
      return (
        <>
          <EmptyState icon={MapIcon} title="There's no parish directory to report on yet.">
            <p>The RCCG parish list hasn't been imported, so there are no regions, provinces or parishes. The other reports still work.</p>
          </EmptyState>
          {unmatched}
        </>
      );
    }
    return (
      <>
        <EmptyReport title={`No ${noun} have applications here.`}>
          <p>Tick “Include {noun} with no applications” to see them all.</p>
        </EmptyReport>
        {unmatched}
      </>
    );
  }
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);
  const paged = data.total > data.pageSize || data.page > 1;
  const compared = data.items.filter((card) => card.applications !== 0);
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
      {unmatched}
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
                <CompareChart rows={compared.map((card) => ({ key: card.key, name: card.name, byStatus: card.byStatus }))} />
              </LazyPart>
              <figcaption>
                <ul aria-label="Colours" className="flex flex-wrap gap-x-4 gap-y-1 font-sans text-[13px] text-muted">
                  {APPLICATION_STATUSES.filter((status) => compared.some((card) => card.byStatus[status])).map((status) => (
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
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.items.map((card) => (
            <li key={card.key} className="flex">
              <PlaceCard card={card} drill={drillHref(card)} applicants={applicantsFor(card)} />
            </li>
          ))}
        </ul>
        {data.extras.length > 0 && (
          <section aria-labelledby="outside-heading" className="flex flex-col gap-3">
            <h3 id="outside-heading" className="font-sans text-[16px] font-bold text-ink">
              Outside any {one}
            </h3>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data.extras.map((card) => (
                <li key={card.key} className="flex">
                  <PlaceCard card={card} drill={drillHref(card)} applicants={applicantsFor(card)} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </TabsContent>
      <TabsContent value="table" tabIndex={-1}>
        <LazyPart what="table" height={480}>
          <PlaceTable data={data} drillHref={drillHref} applicantsFor={applicantsFor} onSort={onSort} />
        </LazyPart>
      </TabsContent>
      {paged && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(next) => set({ page: String(next) })} />}
    </section>
  );
}

function PlaceCard({ card, drill, applicants }: { card: Card_; drill: string | null; applicants: string | null }) {
  const count = card.applications;
  return (
    <ReportCard
      className="w-full"
      title={card.name}
      description={describePlace(card)}
      aside={
        (card.status && card.status !== 'active') || card.changed2026 ? (
          <>
            <DirectoryStatusBadge status={card.status} />
            {card.changed2026 && <Badge variant="warning">Changed in 2026</Badge>}
          </>
        ) : undefined
      }
      actions={
        drill || applicants ? (
          <>
            {drill && (
              <Button asChild variant="outline" size="sm">
                <Link to={drill} aria-label={`${drillLabel(card)}: ${card.name}`}>
                  {drillLabel(card)}
                  <ChevronRightIcon aria-hidden="true" />
                </Link>
              </Button>
            )}
            {applicants && (
              <ActionLink variant="ghost" arrow={false} to={applicants} label={`View applications: ${card.name}`}>
                <UsersIcon aria-hidden="true" />
                Applications
              </ActionLink>
            )}
          </>
        ) : undefined
      }
    >
      <p className="font-sans text-[15px] text-ink">
        <span className="font-sans text-[28px] leading-none font-bold tabular-nums">{formatCount(count)}</span> {count === 1 ? 'application' : 'applications'}
      </p>
      <StatusMeter counts={card.byStatus} label={`${card.name}: applications by review status`} />
      {card.kind !== 'parish' && card.activeParishes !== null && (
        <p className="font-sans text-[13px] text-muted">
          {card.activeParishes
            ? `${formatCount(card.parishesWithApplications)} of ${plural(card.activeParishes, 'active parish', 'active parishes')} ${card.parishesWithApplications === 1 ? 'has' : 'have'} applications.`
            : 'No active parishes.'}
        </p>
      )}
    </ReportCard>
  );
}
