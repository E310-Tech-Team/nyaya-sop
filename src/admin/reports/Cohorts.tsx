import { UsersIcon } from 'lucide-react';
import { when } from '../../components/ui';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { useAsync } from '../../lib/useAsync';
import { APPLICATION_STATUSES, REVIEW_STATUS_LABELS } from '../../shared/platform';
import { adminApi, type ReportSummary } from '../api';
import { useCan } from '../session';
import { CompareChart, LazyPart } from './lazy';
import { countWithShare, formatCount, percent } from './model';
import { ActionLink, applicantsHref, EmptyReport, EmptyState, ReportCard, ReportError, ReportPage, ReportSkeleton, useReportFilters } from './parts';
import { STATUS_COLOURS, StatusMeter } from './visuals';

/** Each cohort's applications, with its dates and review status. */
export default function CohortsReportPage() {
  return (
    <ReportPage title="Cohorts" description="Applications in each cohort, under the filters above. Every cohort is listed, whichever one the filters name." hide={['cohort']}>
      {({ summary }) => <Cohorts summary={summary} />}
    </ReportPage>
  );
}

function Cohorts({ summary: scoped }: { summary: ReportSummary }) {
  const { query, carry } = useReportFilters();
  const canApplicants = useCan('applications.view_all');
  // Every cohort is listed, so the cohort filter doesn't apply here: not to the cards, nor to the totals.
  const others = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'cohort'));
  const key = JSON.stringify(others);
  const cohorts = useAsync((signal) => adminApi.reportCohorts(others, signal), [key]);
  const all = useAsync((signal) => (query.cohort ? adminApi.reportSummary(others, signal) : Promise.resolve(scoped)), [key, query.cohort ?? '']);
  if (cohorts.error || all.error) {
    return <ReportError what="The cohorts" error={cohorts.error ?? all.error} onRetry={() => (cohorts.error ? cohorts.reload() : all.reload())} />;
  }
  if (!cohorts.data || !all.data) return <ReportSkeleton metrics={0} cards={2} />;
  const summary = all.data;
  if (!cohorts.data.items.length) return <EmptyState icon={UsersIcon} title="There are no cohorts yet." />;
  if (summary.applications === 0) return <EmptyReport title="No applications match these filters." />;
  const dates = (opensAt: string | null, closesAt: string | null) =>
    opensAt || closesAt ? `${opensAt ? `Opens ${when(opensAt)}` : 'No opening date'} · ${closesAt ? `closes ${when(closesAt)}` : 'no closing date'}` : 'No dates set';
  const withApplications = cohorts.data.items.filter((cohort) => cohort.applications !== 0);

  return (
    <>
      <Alert>
        <UsersIcon aria-hidden="true" />
        <AlertDescription>
          <p>
            Each email address can apply once per cohort, so within a cohort each application is a different person. Across all cohorts, these{' '}
            <strong>{formatCount(summary.applications)} applications</strong> come from <strong>{formatCount(summary.uniqueApplicants)} unique applicants</strong> (counted by
            email address).
          </p>
        </AlertDescription>
      </Alert>

      {withApplications.length > 1 && (
        <Card as="section" aria-labelledby="compare-cohorts" className="gap-3">
          <div className="flex flex-col gap-1 px-5 sm:px-6">
            <h2 id="compare-cohorts" className="font-sans text-[17px] font-bold text-ink">
              Compare cohorts
            </h2>
            <p className="font-sans text-[13px] leading-[1.5] text-muted">Each bar is one cohort, split by review status. The cards below give every number.</p>
          </div>
          <figure className="m-0 flex flex-col gap-3 px-5 sm:px-6">
            <LazyPart what="chart" height={withApplications.length * 40 + 36}>
              <CompareChart rows={withApplications.map((cohort) => ({ key: cohort.id, name: cohort.name, byStatus: cohort.byStatus }))} />
            </LazyPart>
            <figcaption>
              <ul aria-label="Colours" className="flex flex-wrap gap-x-4 gap-y-1 font-sans text-[13px] text-muted">
                {APPLICATION_STATUSES.filter((status) => withApplications.some((cohort) => cohort.byStatus[status])).map((status) => (
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

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cohorts.data.items.map((cohort) => (
          <li key={cohort.id} className="flex">
            <ReportCard
              className="w-full"
              title={cohort.name}
              description={dates(cohort.opensAt, cohort.closesAt)}
              aside={<Badge variant={cohort.openNow ? 'success' : 'neutral'}>{cohort.openNow ? 'Open now' : 'Closed'}</Badge>}
              actions={
                <>
                  <ActionLink to={`/admin/reports?${carry({ cohort: cohort.id })}`} label={`Cohort report: ${cohort.name}`}>
                    Cohort report
                  </ActionLink>
                  {canApplicants && cohort.applications !== 0 && (
                    <ActionLink variant="ghost" arrow={false} to={applicantsHref({ ...others, cohort: cohort.id })} label={`View applications: ${cohort.name}`}>
                      <UsersIcon aria-hidden="true" />
                      Applications
                    </ActionLink>
                  )}
                </>
              }
            >
              <p className="font-sans text-[15px] text-ink">
                <span className="font-sans text-[28px] leading-none font-bold tabular-nums">{formatCount(cohort.applications)}</span>{' '}
                {cohort.applications === 1 ? 'application' : 'applications'}
              </p>
              <StatusMeter counts={cohort.byStatus} label={`${cohort.name}: applications by review status`} />
              <p className="font-sans text-[13px] text-muted">{countWithShare(cohort.withParish, percent(cohort.withParish, cohort.applications))} with a directory parish.</p>
            </ReportCard>
          </li>
        ))}
      </ul>
    </>
  );
}
