/**
 * A card in the drill-down from continents to parishes (and the overview's continents): the name
 * the directory gives it, its applications and their review status, the units and parishes beneath
 * it with how many have applications, and the way in.
 */
import { ChevronRightIcon, UsersIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import type { ReportCard as Card_ } from '../api';
import { DirectoryStatusBadge } from '../directory-parts';
import { formatCount } from './model';
import { ActionLink, ReportCard } from './parts';
import { beneath, describePlace, drillLabel } from './places';
import { StatusMeter } from './visuals';

export function PlaceCard({
  card,
  drill,
  applicants,
  answers,
  canApplicants,
}: {
  card: Card_;
  /** Where the card leads in the drill-down: the level below, or a parish's own view. */
  drill: string | null;
  /** The Applicants list for exactly these applications (only for staff who can see applicants). */
  applicants: string | null;
  /** For the Unassigned group: the report on how applicants answered the parish question. */
  answers?: string | null;
  canApplicants: boolean;
}) {
  const count = card.applications;
  const lines = beneath(card);
  // A parish's view shows its applications only to staff who can see applicants.
  const label = card.kind === 'parish' && !canApplicants ? 'View parish' : drillLabel(card);
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
        drill || applicants || answers ? (
          <>
            {drill && (
              <Button asChild variant="outline" size="sm">
                <Link to={drill} aria-label={`${label}: ${card.name}`}>
                  {label}
                  <ChevronRightIcon aria-hidden="true" />
                </Link>
              </Button>
            )}
            {answers && (
              <ActionLink to={answers} label="See the parish answers report">
                Parish answers
              </ActionLink>
            )}
            {applicants && (
              <ActionLink variant="ghost" arrow={false} to={applicants} label={`View in Applicants: ${card.name}`}>
                <UsersIcon aria-hidden="true" />
                Applicants
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
      {lines.length > 0 && (
        <dl aria-label={`What is under ${card.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-t border-line/70 pt-3 font-sans text-[13px]">
          {lines.map((line) => (
            <Fragment key={line.label}>
              <dt className="text-muted">{line.label}</dt>
              <dd className="text-right tabular-nums text-ink">
                <span className="font-bold">{line.total.toLocaleString('en-GB')}</span>
                <span className="text-muted"> · {formatCount(line.withApplications)} with applications</span>
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </ReportCard>
  );
}
