import { ChurchIcon, DownloadIcon, FileTextIcon, MapPinnedIcon, UsersIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useAsync } from '../../lib/useAsync';
import { CHURCH_LEVELS } from '../../shared/directory';
import type { ReportCard as Card_, ReportSummary } from '../api';
import { adminApi } from '../api';
import { LEVEL_PLURALS } from '../directory-parts';
import { useCan, useCanAll } from '../session';
import { LazyPart, StatusChart, TrendChart } from './lazy';
import { compare, countWithShare, describeSeries, formatCount, percent, periodText, statusRows } from './model';
import { ActionLink, applicantsHref, CardSkeleton, EmptyReport, MetricCard, PLACE_PARAMS, ReportCard, ReportError, ReportPage, SectionHeading, useReportFilters } from './parts';
import { PlaceCard } from './PlaceCard';
import { BarList, CategoryBar } from './visuals';

/** Reports and analytics: the key figures, a card per continent (the way into the drill-down), then a card for each report and the downloads. */
export default function ReportsOverviewPage() {
  return (
    <ReportPage
      title="Reports and analytics"
      description="How many applications there are, where applicants' parishes are in the RCCG directory, and how review is going. The filters apply to every report."
    >
      {({ summary }) => <Overview summary={summary} />}
    </ReportPage>
  );
}

function Overview({ summary }: { summary: ReportSummary }) {
  const { query, carry } = useReportFilters();
  const key = JSON.stringify(query);
  const canReview = useCanAll('applications.view_all', 'applications.edit', 'directory.manage');
  const canApplicants = useCan('applications.view_all');
  const canExport = useCan('applications.export');
  // The way into the drill-down: every continent, or what's under the place the report is limited to.
  const places = useAsync((signal) => adminApi.reportUnits({ ...query, ...(query.unit ? {} : { level: 'continent' }), sort: 'name', pageSize: '12' }, signal), [key]);
  const trend = useAsync((signal) => adminApi.reportTrend({ ...query, interval: 'week' }, signal), [key]);
  const cohorts = useAsync((signal) => adminApi.reportCohorts(query, signal), [key]);
  const link = (path: string, extra: Record<string, string | null> = {}) => {
    const search = carry(extra);
    return search ? `${path}?${search}` : path;
  };

  if (summary.applications === 0) {
    return (
      <EmptyReport title="No applications match these filters.">
        <p>Every report counts the same applications, so they're all empty for now.</p>
      </EmptyReport>
    );
  }
  const waiting = [summary.waiting.notListed, summary.waiting.detailsWrong, summary.waiting.lookalike, summary.waiting.earlierText];
  const waitingTotal = waiting.some((count) => count === null) ? null : waiting.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const noDirectory = summary.activeParishes === 0;
  const drillHref = (card: Card_) => (card.drill ? link('/admin/reports/organisation', { ...PLACE_PARAMS, ...card.drill }) : null);
  // Totals by place only for the levels under the place the report is limited to.
  const csvLevels = (['continent', 'region', 'province', 'parish'] as const).filter(
    (level) => !summary.unit || level === 'parish' || CHURCH_LEVELS.indexOf(level) > CHURCH_LEVELS.indexOf(summary.unit.level),
  );

  return (
    <>
      <section aria-labelledby="key-figures" className="flex flex-col gap-3">
        <SectionHeading id="key-figures" title="Key figures" />
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={FileTextIcon}
            label="Applications"
            value={formatCount(summary.applications)}
            context={`Submitted ${periodText(summary.period.from, summary.period.to)}. Each email address can apply once per cohort.`}
            comparison={compare(summary.applications, summary.comparison)}
          />
          <MetricCard
            icon={UsersIcon}
            label="Unique applicants"
            value={formatCount(summary.uniqueApplicants)}
            context="People, counted once by email address, whichever cohorts they applied to."
          />
          <MetricCard
            icon={ChurchIcon}
            label="With a directory parish"
            value={countWithShare(summary.withParish, percent(summary.withParish, summary.applications))}
            context="Linked to a parish in today's RCCG directory, by the applicant or by staff."
          />
          <MetricCard
            icon={MapPinnedIcon}
            label="Parishes represented"
            value={noDirectory ? '—' : `${formatCount(summary.parishesRepresented)} of ${summary.activeParishes.toLocaleString('en-GB')}`}
            context={
              noDirectory ? "The RCCG parish list hasn't been imported yet." : `Active parishes${summary.unit ? ` in ${summary.unit.name}` : ''} with at least one of these applications.`
            }
          />
        </dl>
      </section>

      <section aria-labelledby="places-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading id="places-heading" title={summary.unit ? `In ${summary.unit.name}` : 'By continent'}>
            {summary.unit
              ? `What's under ${summary.unit.name} in today's RCCG directory, with these applications.`
              : "Where applicants' parishes are in today's RCCG directory. Open a continent to go down to its regions, provinces, parishes and each parish's applications."}
          </SectionHeading>
          <ActionLink to={link('/admin/reports/organisation')} label="Open the report: continents to parishes">
            Open the full report
          </ActionLink>
        </div>
        {places.error ? (
          <ReportError what="The places" error={places.error} onRetry={places.reload} />
        ) : !places.data ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <CardSkeleton key={index} height={96} />
            ))}
          </div>
        ) : (
          <>
            {!places.data.total && (
              <p className="font-sans text-[14px] text-muted">
                {noDirectory ? "The RCCG parish list hasn't been imported yet, so there are no continents, regions or provinces to show." : 'Nothing is listed here in the directory.'}
              </p>
            )}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[...places.data.items, ...places.data.extras].map((card) => (
                <li key={card.key} className="flex">
                  <PlaceCard
                    card={card}
                    drill={drillHref(card)}
                    applicants={canApplicants && card.applications !== 0 && card.kind !== 'parish' ? applicantsHref(query, card.filter) : null}
                    answers={card.kind === 'unassigned' ? link('/admin/reports/parish-answers') : null}
                    canApplicants={canApplicants}
                  />
                </li>
              ))}
            </ul>
            {places.data.total > places.data.pageSize && (
              <p className="font-sans text-[13px] text-muted">
                The first {places.data.pageSize} of {places.data.total}: the full report lists them all.
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="reports-heading" className="flex flex-col gap-3">
        <SectionHeading id="reports-heading" title="Reports">
          A first look at each report. They all count the same applications, under the filters above.
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <ReportCard
            className="lg:col-span-2"
            title="Over time"
            description="New applications per week, in Lagos time (WAT)."
            actions={
              <ActionLink to={link('/admin/reports/over-time')} label="Open report: over time">
                Open report
              </ActionLink>
            }
          >
            {trend.error ? (
              <ReportError what="The trend" error={trend.error} onRetry={trend.reload} />
            ) : !trend.data ? (
              <CardSkeleton height={220} />
            ) : (
              <figure className="m-0 flex flex-col gap-3">
                <LazyPart what="chart" height={220}>
                  <TrendChart points={trend.data.points} interval="week" height={220} />
                </LazyPart>
                <figcaption className="font-sans text-[13px] leading-[1.5] text-muted">{describeSeries(trend.data.points, 'week')}</figcaption>
              </figure>
            )}
          </ReportCard>

          <ReportCard
            title="Review status"
            description="Where these applications are in review. Applicants only see a status once staff publish it."
            actions={
              <ActionLink to={link('/admin/reports/decisions')} label="Open report: review and decisions">
                Open report
              </ActionLink>
            }
          >
            <figure className="m-0">
              <LazyPart what="chart" height={236}>
                <StatusChart counts={summary.byStatus} kind="review" total={summary.applications} />
              </LazyPart>
              <figcaption className="sr-only">
                Applications by review status:{' '}
                {statusRows(summary.byStatus, 'review', summary.applications)
                  .map((row) => `${row.label} ${formatCount(row.value)}`)
                  .join(', ')}
                .
              </figcaption>
            </figure>
          </ReportCard>

          <ReportCard
            className="xl:col-span-2"
            title="Parish answers"
            description="How applicants answered the parish question, and which answers still have no directory parish."
            actions={
              <>
                <ActionLink to={link('/admin/reports/parish-answers')} label="Open report: parish answers">
                  Open report
                </ActionLink>
                {canReview && waitingTotal !== 0 && (
                  <ActionLink variant="ghost" arrow={false} to="/admin/parish-review">
                    Parish review{waitingTotal ? ` (${waitingTotal} waiting)` : ''}
                  </ActionLink>
                )}
              </>
            }
          >
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] md:items-start">
              <CategoryBar
                label="Applications by parish answer"
                segments={[
                  { key: 'listed', label: 'Chosen from the directory', value: summary.answers.listed, colour: 'var(--color-brand)' },
                  { key: 'staff', label: 'Linked by staff', value: summary.linkedByStaff, colour: '#3f7f45' },
                  { key: 'none', label: 'No directory parish', value: summary.withoutParish, colour: 'var(--color-line-strong)' },
                ]}
              />
              <div className="flex flex-col gap-1.5 rounded-xl bg-paper px-4 py-3 font-sans text-[13px]">
                <p className="font-semibold text-ink">Waiting in Parish review: {formatCount(waitingTotal)}</p>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-muted">
                  <dt>Parish not listed</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">{formatCount(summary.waiting.notListed)}</dd>
                  <dt>Details flagged</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">{formatCount(summary.waiting.detailsWrong)}</dd>
                  <dt>Which parish?</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">{formatCount(summary.waiting.lookalike)}</dd>
                  <dt>Earlier answers</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">{formatCount(summary.waiting.earlierText)}</dd>
                </dl>
              </div>
            </div>
          </ReportCard>

          <ReportCard
            title="Cohorts"
            description="Applications in each cohort. Within a cohort, each application is a different person."
            actions={
              <ActionLink to={link('/admin/reports/cohorts')} label="Open report: cohorts">
                Open report
              </ActionLink>
            }
          >
            {cohorts.error ? (
              <ReportError what="The cohorts" error={cohorts.error} onRetry={cohorts.reload} />
            ) : !cohorts.data ? (
              <CardSkeleton height={96} />
            ) : (
              <>
                <BarList
                  label="Applications by cohort"
                  items={cohorts.data.items.map((cohort) => ({ key: cohort.id, label: cohort.name, value: cohort.applications, note: cohort.openNow ? 'Open now' : undefined }))}
                />
                <p className="font-sans text-[13px] leading-[1.5] text-muted">
                  {query.cohort ? 'In the chosen cohort' : 'Across all cohorts'}: {formatCount(summary.applications)} {summary.applications === 1 ? 'application' : 'applications'} from {formatCount(summary.uniqueApplicants)} unique{' '}
                  {summary.uniqueApplicants === 1 ? 'applicant' : 'applicants'}, counted by email address.
                </p>
              </>
            )}
          </ReportCard>

          <ReportCard
            className="lg:col-span-2 xl:col-span-3"
            title="Downloads"
            description="Spreadsheets (CSV) of these applications, under the same filters. Every download is recorded in the audit history."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2.5 rounded-xl border border-line/80 bg-paper p-4">
                <p className="font-sans text-[14px] font-bold text-ink">Totals by place</p>
                <p className="font-sans text-[13px] leading-[1.5] text-muted">
                  Applications and review status for every place at one level{summary.unit ? ` in ${summary.unit.name}` : ''}, with a row for those outside any place. Totals only, no
                  applicant details.
                </p>
                <div className="flex flex-wrap gap-2">
                  {csvLevels.map((level) => (
                    <Button key={level} asChild variant="outline" size="sm">
                      <a href={adminApi.reportUnitsCsvUrl({ ...query, level })} download>
                        <DownloadIcon aria-hidden="true" />
                        {level === 'parish' ? 'Parishes' : LEVEL_PLURALS[level]}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
              {canExport && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-line/80 bg-paper p-4">
                  <p className="font-sans text-[14px] font-bold text-ink">Applications with applicant details</p>
                  <p className="font-sans text-[13px] leading-[1.5] text-muted">One row per application, with personal details. Keep the file secure and delete it when you're done.</p>
                  <div>
                    <Button asChild variant="outline" size="sm">
                      <a href={adminApi.exportUrl(query)} download>
                        <DownloadIcon aria-hidden="true" />
                        Applications (CSV)
                      </a>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ReportCard>
        </div>
      </section>

      {summary.directory && (
        <p className="font-sans text-[13px] leading-[1.5] text-muted">
          Places follow today's RCCG directory ({summary.directory.label}
          {summary.directory.structureAsAt ? `, correct as at ${summary.directory.structureAsAt}` : ''}); each application keeps the parish its applicant confirmed. Levels the
          list doesn't have ({LEVEL_PLURALS.zone.toLowerCase()} and {LEVEL_PLURALS.area.toLowerCase()}) aren't reported.
        </p>
      )}
    </>
  );
}
