import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { firstIncompletePath, isReachable, useApplication, useParishQuestion } from '../state/application';

/**
 * Redirects to the first unfinished step if someone deep-links (or refreshes) past it. It also keeps
 * the parish question in step with the server's settings, so a draft started while the parish
 * directory was off must choose a parish once it's on, whichever step it's resumed from.
 */
export function RequireStep({ children }: { children: ReactNode }) {
  const { draft } = useApplication();
  const { pathname } = useLocation();
  useParishQuestion();
  if (!isReachable(draft, pathname)) return <Navigate to={firstIncompletePath(draft)} replace />;
  return <>{children}</>;
}
