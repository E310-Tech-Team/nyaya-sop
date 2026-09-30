import { createContext, useContext, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '../../lib/utils';

/** Each series: its label (for tooltips) and its colour, exposed to the chart as var(--color-<key>). */
export type ChartConfig = Record<string, { label: ReactNode; color: string }>;

const ChartContext = createContext<ChartConfig | null>(null);

function useChartConfig(): ChartConfig {
  const config = useContext(ChartContext);
  if (!config) throw new Error('Chart parts must be inside a <ChartContainer>.');
  return config;
}

/**
 * shadcn/ui Chart: a Recharts chart filling a sized box (give it a height), with the config's colours
 * set as CSS variables on the box. The plot is hidden from assistive technology, so every chart needs
 * its numbers in text beside it: a caption, a legend with counts, or a table.
 */
export function ChartContainer({ config, className, style, children, ...props }: ComponentProps<'div'> & { config: ChartConfig; children: ReactNode }) {
  const colours = Object.fromEntries(Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color])) as CSSProperties;
  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        aria-hidden="true"
        style={{ ...colours, ...style }}
        className={cn(
          'w-full min-w-0 font-sans text-[12px] [&_.recharts-cartesian-axis-tick_text]:fill-muted [&_.recharts-cartesian-grid_line]:stroke-line/60 [&_.recharts-layer]:outline-none [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-cream/80 [&_.recharts-surface]:outline-none',
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipItem = { dataKey?: unknown; name?: unknown; value?: unknown; color?: string; payload?: unknown };

/** A row's own colour, when the chart colours rows rather than series (one bar per status). */
const rowColour = (item: TooltipItem) => (item.payload && typeof item.payload === 'object' && 'fill' in item.payload ? String(item.payload.fill) : undefined);

/** The tooltip's box: the period or category, then each series with its colour and value. Recharts passes `active`, `payload` and `label`. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  hideZero = false,
}: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: string | number;
  labelFormatter?: (label: string) => ReactNode;
  hideZero?: boolean;
}) {
  const config = useChartConfig();
  if (!active || !payload?.length) return null;
  const items = payload.filter((item) => !(hideZero && item.value === 0));
  return (
    <div className="grid min-w-[10rem] gap-1.5 rounded-xl border border-line bg-white px-3 py-2 font-sans text-[13px] text-ink shadow-[0_12px_32px_-12px_rgba(45,9,20,0.3)]">
      {label !== undefined && label !== '' && <p className="font-bold">{labelFormatter ? labelFormatter(String(label)) : label}</p>}
      <ul className="grid gap-1">
        {items.map((item) => {
          const key = String(item.dataKey ?? item.name ?? '');
          return (
            <li key={key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: rowColour(item) ?? config[key]?.color ?? item.color }} />
              <span className="text-muted">{config[key]?.label ?? String(item.name ?? key)}</span>
              <span className="ml-auto pl-3 font-bold tabular-nums">
                {typeof item.value === 'number' ? item.value.toLocaleString('en-GB') : item.value == null ? 'fewer than 5' : String(item.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
