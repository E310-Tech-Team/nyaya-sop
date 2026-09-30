/**
 * The reports' charts: shadcn/ui Chart with Recharts, loaded on demand (lazy.tsx) so the admin's
 * first load doesn't carry Recharts. The plots are pictures for sighted users: each chart's card
 * states its numbers in text (a caption, a legend with counts or a table). No animation.
 */
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../components/ui/chart';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../../shared/platform';
import type { Count, StatusCounts } from '../api';
import { formatDay, formatShortDay, statusLabel, statusRows, type SeriesPoint } from './model';
import { STATUS_COLOURS } from './visuals';

const TICK = { fontSize: 12 };
const statusConfig = (kind: 'review' | 'published'): ChartConfig =>
  Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, { label: statusLabel(kind, status), color: STATUS_COLOURS[status] }]));

/** Applications per day or week, as columns. */
export function TrendChart({ points, interval, height = 240 }: { points: SeriesPoint[]; interval: 'day' | 'week'; height?: number }) {
  const config = { applications: { label: 'Applications', color: 'var(--color-brand)' } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} style={{ height }}>
      <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tick={TICK} tickFormatter={formatShortDay} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={TICK} />
        <ChartTooltip
          isAnimationActive={false}
          content={<ChartTooltipContent labelFormatter={(day) => (interval === 'week' ? `Week starting ${formatDay(day)}` : formatDay(day))} />}
        />
        <Bar dataKey="applications" fill="var(--color-applications)" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/** One horizontal bar per status, coloured by status, with its count at the end. */
export function StatusChart({ counts, kind, total }: { counts: StatusCounts; kind: 'review' | 'published'; total: Count }) {
  const rows = statusRows(counts, kind, total).map((row) => ({ ...row, fill: STATUS_COLOURS[row.status] }));
  const config = { value: { label: 'Applications', color: 'var(--color-brand)' } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} style={{ height: rows.length * 38 + 8 }}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 0 }} barCategoryGap={8} accessibilityLayer={false}>
        <XAxis type="number" dataKey="value" hide allowDecimals={false} domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="label" width={132} tickLine={false} axisLine={false} tick={{ ...TICK, fill: 'var(--color-ink)' }} />
        <ChartTooltip isAnimationActive={false} cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="value" radius={4} maxBarSize={24} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.status} fill={row.fill} />
          ))}
          <LabelList dataKey="value" position="right" offset={8} className="fill-ink" fontSize={12} fontWeight={700} formatter={(value: unknown) => (typeof value === 'number' ? value.toLocaleString('en-GB') : '<5')} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export type CompareRow = { key: string; name: string; byStatus: StatusCounts };

const shorten = (name: string, max = 24) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/** Places (or cohorts) side by side: one bar each, split by review status. Hidden counts (fewer than 5) aren't drawn. */
export function CompareChart({ rows }: { rows: CompareRow[] }) {
  const data = rows.map((row) => ({ name: row.name, ...Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, row.byStatus[status] ?? 0])) }));
  const present = APPLICATION_STATUSES.filter((status) => rows.some((row) => row.byStatus[status]));
  const last = present.at(-1);
  return (
    <ChartContainer config={statusConfig('review')} style={{ height: Math.max(rows.length, 2) * 40 + 36 }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap={10} accessibilityLayer={false}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} />
        <YAxis type="category" dataKey="name" width={156} tickLine={false} axisLine={false} tick={{ ...TICK, fill: 'var(--color-ink)' }} tickFormatter={(name: string) => shorten(name)} />
        <ChartTooltip isAnimationActive={false} cursor={{ fill: 'var(--color-cream)' }} content={<ChartTooltipContent hideZero />} />
        {present.map((status: ApplicationStatus) => (
          <Bar key={status} dataKey={status} stackId="status" fill={`var(--color-${status})`} radius={status === last ? [0, 4, 4, 0] : 0} maxBarSize={26} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
