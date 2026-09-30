/**
 * The reports' heavier parts, downloaded when first shown: the Recharts charts, the date picker
 * (react-day-picker) and the comparison table (TanStack Table). The pages themselves stay in the
 * admin bundle, so each keeps its <h1> focus on navigation. Each part has a same-sized placeholder
 * while it loads and its own small error message if it can't be downloaded.
 */
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { isChunkLoadError } from '../../lib/pwa';

const charts = () => import('./charts');
export const TrendChart = lazy(() => charts().then((module) => ({ default: module.TrendChart })));
export const StatusChart = lazy(() => charts().then((module) => ({ default: module.StatusChart })));
export const CompareChart = lazy(() => charts().then((module) => ({ default: module.CompareChart })));
export const PeriodCalendar = lazy(() => import('./PeriodCalendar'));
export const PlaceTable = lazy(() => import('./PlaceTable'));

class PartBoundary extends Component<{ what: string; children: ReactNode }, { failed: boolean; missing: boolean }> {
  state = { failed: false, missing: false };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, missing: isChunkLoadError(error) };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/40 bg-[#fbeef1] px-4 py-3 font-sans text-[14px] text-ink">
        <p>
          {this.state.missing ? `The ${this.props.what} couldn’t be downloaded (the site may have been updated).` : `The ${this.props.what} couldn’t be shown.`} Reload
          the page to try again.
        </p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

/** Where a lazy part goes: a placeholder of its height while it downloads, then the part. */
export function LazyPart({ what, height, children }: { what: string; height: number; children: ReactNode }) {
  return (
    <PartBoundary what={what}>
      <Suspense fallback={<Skeleton className="w-full rounded-xl" style={{ height }} />}>{children}</Suspense>
    </PartBoundary>
  );
}
