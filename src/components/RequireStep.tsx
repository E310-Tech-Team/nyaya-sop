import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { firstIncompletePath, isReachable, useApplication } from '../state/application';

/** Redirects to the first unfinished step if someone deep-links (or refreshes) past it. */
export function RequireStep({ children }: { children: ReactNode }) {
  const { draft } = useApplication();
  const { pathname } = useLocation();
  if (!isReachable(draft, pathname)) return <Navigate to={firstIncompletePath(draft)} replace />;
  return <>{children}</>;
}
