import { CalendarRangeIcon, FileTextIcon, InfoIcon, TrendingUpIcon } from 'lucide-react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useAsync } from '../../lib/useAsync';
import type { ReportSummary, Trend } from '../api';
import { adminApi } from '../api';
import { LazyPart, TrendChart } from './lazy';
import { compare, describeSeries, formatCount, formatDay, rangeLabel, seriesStats } from './model';
import { EmptyReport, MetricCard, ReportCard, ReportError, ReportPage, ReportSkeleton, useReportFilters } from './parts';

/** New applications per day or week, in Lagos time. */
export default function OverTimeReportPage() {
  return (
    <ReportPage title="Over time" description="New applications per week or per day, in Lagos time (WAT), under the filters above.">
      {({ summary }) => <OverTime summary={summary} />}
    </ReportPage>
  );
}

function OverTime({ summary }: { summary: ReportSummary }) {
  const { params, query, set } = useReportFilters();
  const interval = params.get('interval') === 'day' ? 'day' : 'week';
  const trend = useAsync((signal) => adminApi.reportTrend({ ...query, interval }, signal), [JSON.stringify(query), interval]);
  if (summary.applications === 0) return <EmptyReport title="No applications match these filters." />;
  if (trend.error) return <ReportError what="The trend" error={trend.error} onRetry={trend.reload} />;
  if (!trend.data) return <ReportSkeleton metrics={3} cards={1} />;
  return <TrendReport trend={trend.data} summary={summary} interval={interval} onInterval={(next) => set({ interval: next === 'day' ? 'day' : null })} />;
}

function TrendReport({ trend, summary, interval, onInterval }: { trend: Trend; summary: ReportSummary; interval: 'day' | 'week'; onInterval: (interval: string) => void }) {
  const { points, from, to, explicit } = trend;
  const { total, busiest, average } = seriesStats(points);
  const unit = interval;
  const span = interval === 'day' ? '30 days' : '12 weeks';
  return (
    <>
      {!explicit && (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            <p>
              No dates are chosen, so this shows the last {span}: {rangeLabel(from, to)} (WAT). Choose a period in the filters to change it.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          icon={FileTextIcon}
          label={explicit ? 'Applications in this period' : `Applications in the last ${span}`}
          value={total === null ? '—' : formatCount(total)}
          context={total === null ? 'Some periods have fewer than 5, so the total is hidden.' : `Submitted ${rangeLabel(from, to)} (WAT).`}
          comparison={explicit ? compare(summary.applications, summary.comparison) : null}
        />
        <MetricCard
          icon={TrendingUpIcon}
          label={`Busiest ${unit}`}
          value={busiest?.applications ? formatCount(busiest.applications) : '—'}
          context={busiest?.applications ? `${interval === 'week' ? 'The week starting ' : ''}${formatDay(busiest.period)}.` : `No ${unit} had any applications.`}
        />
        <MetricCard
          icon={CalendarRangeIcon}
          label={`Average per ${unit}`}
          value={average === null ? '—' : average.toLocaleString('en-GB')}
          context={`Across the ${points.length} ${unit}${points.length === 1 ? '' : 's'} shown, including ${unit}s with none.`}
        />
      </dl>
      <Tabs value={interval} activationMode="manual" onValueChange={onInterval}>
        <ReportCard
          headingLevel={2}
          title={`Applications per ${unit}`}
          description={`Each column is one ${unit} in Lagos time. The table under the chart has every number.`}
          aside={
            <TabsList aria-label="Group by">
              <TabsTrigger value="week">Weekly</TabsTrigger>
              <TabsTrigger value="day">Daily</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value={interval} tabIndex={-1}>
            <figure className="m-0 flex flex-col gap-3">
              <LazyPart what="chart" height={280}>
                <TrendChart points={points} interval={interval} height={280} />
              </LazyPart>
              <figcaption className="font-sans text-[13px] leading-[1.5] text-muted">{describeSeries(points, interval)}</figcaption>
            </figure>
            <details className="group rounded-xl border border-line/80 bg-paper">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 font-sans text-[14px] font-bold text-brand">Show the numbers</summary>
              <div className="border-t border-line/80 bg-white">
                <Table framed={false} label={`Applications per ${unit}`}>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead scope="col">{interval === 'day' ? 'Day' : 'Week starting'} (WAT)</TableHead>
                      <TableHead scope="col" className="text-right">
                        Applications
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {points.map((point) => (
                      <TableRow key={point.period}>
                        <th scope="row" className="px-4 py-2 text-left font-normal">
                          {formatDay(point.period)}
                        </th>
                        <TableCell className="py-2 text-right tabular-nums">{formatCount(point.applications)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </TabsContent>
        </ReportCard>
      </Tabs>
    </>
  );
}
