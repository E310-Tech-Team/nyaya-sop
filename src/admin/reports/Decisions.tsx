import { Link } from 'react-router';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { PUBLISHED_STATUS_LABELS } from '../../shared/platform';
import type { Count, ReportSummary, StatusCounts } from '../api';
import { useCan } from '../session';
import { LazyPart, StatusChart } from './lazy';
import { formatCount, statusRows } from './model';
import { applicantsHref, EmptyReport, ReportCard, ReportPage, useReportFilters } from './parts';
import { STATUS_COLOURS } from './visuals';

/** Where applications are in review, and what applicants have been shown. */
export default function DecisionsReportPage() {
  return (
    <ReportPage
      title="Review and decisions"
      description="Where these applications are in review, and what applicants see in their accounts. Applicants see a status only once staff publish it."
    >
      {({ summary }) => <Decisions summary={summary} />}
    </ReportPage>
  );
}

function Decisions({ summary }: { summary: ReportSummary }) {
  if (summary.applications === 0) return <EmptyReport title="No applications match these filters." />;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <StatusReport
        kind="review"
        title="Review status"
        description="The internal status staff set while reviewing. Each count opens its applications."
        counts={summary.byStatus}
        total={summary.applications}
      />
      <StatusReport
        kind="published"
        title="What applicants see"
        description="The status published to applicants, in their words. It changes only when staff publish a decision."
        counts={summary.byPublished}
        total={summary.applications}
      />
    </div>
  );
}

function StatusReport({ kind, title, description, counts, total }: { kind: 'review' | 'published'; title: string; description: string; counts: StatusCounts; total: Count }) {
  const { query } = useReportFilters();
  const canApplicants = useCan('applications.view_all');
  const rows = statusRows(counts, kind, total);
  const filter = kind === 'review' ? 'status' : 'published';
  return (
    <ReportCard headingLevel={2} title={title} description={description}>
      <figure className="m-0">
        <LazyPart what="chart" height={236}>
          <StatusChart counts={counts} kind={kind} total={total} />
        </LazyPart>
        <figcaption className="sr-only">
          {title}: {rows.map((row) => `${row.label} ${formatCount(row.value)}`).join(', ')}.
        </figcaption>
      </figure>
      <Table framed={false} label={`${title}: the numbers`}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">{kind === 'review' ? 'Status' : 'Applicants see'}</TableHead>
            <TableHead scope="col" className="text-right">
              Applications
            </TableHead>
            <TableHead scope="col" className="text-right">
              Share
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.status}>
              <th scope="row" className="px-4 py-2.5 text-left align-top font-normal">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: STATUS_COLOURS[row.status] }} />
                  {row.label}
                </span>
                {kind === 'published' && <span className="block pl-[18px] text-[13px] text-muted">{PUBLISHED_STATUS_LABELS[row.status].description}</span>}
              </th>
              <TableCell className="py-2.5 text-right tabular-nums">
                {canApplicants && row.value !== 0 ? (
                  <Link
                    to={applicantsHref(query, { [filter]: row.status })}
                    aria-label={`View ${formatCount(row.value)} ${row.value === 1 ? 'application' : 'applications'}: ${row.label}`}
                    className="font-bold text-brand underline underline-offset-4"
                  >
                    {formatCount(row.value)}
                  </Link>
                ) : (
                  <span className="font-bold">{formatCount(row.value)}</span>
                )}
              </TableCell>
              <TableCell className="py-2.5 text-right text-muted tabular-nums">{row.share === null ? '—' : `${row.share}%`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportCard>
  );
}
