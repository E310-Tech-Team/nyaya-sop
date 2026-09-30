import { Link } from 'react-router';
import { Badge, LoadError, Loading, PageHeader, Panel, TableScroll, td, th, when } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { APPLICATION_STATUSES, REVIEW_STATUS_LABELS, TOPIC_DETAILS, type ApplicationStatus } from '../../shared/platform';
import { adminApi, type Dashboard } from '../api';
import { formatCount } from '../directory-parts';
import { Stat } from '../parts';
import { useCan, useStaff } from '../session';

/** Applications by continent, the busiest regions, and those without a directory parish (reports.view). */
function ParishCard() {
  const { data, error, reload } = useAsync((signal) => adminApi.reportsOverview(signal), []);
  const link = 'font-bold text-brand underline-offset-4 hover:underline';
  return (
    <Panel
      title="Applications by parish"
      description="Counted where each application’s parish is in today’s directory."
      actions={
        <Link to="/admin/reports" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">
          Open reports
        </Link>
      }
    >
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Applications" value={formatCount(data.total)} />
            <Stat label="Without a directory parish" value={formatCount(data.unmatched)} hint="Not listed, typed on the earlier form, or not given." />
          </dl>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="font-sans text-[15px] font-bold text-ink">By continent</h3>
              <ul className="flex flex-col gap-1 font-sans text-[14px] text-ink">
                {data.continents.map((continent) => (
                  <li key={continent.id} className="flex justify-between gap-3">
                    <Link to={`/admin/reports/organisation?unit=${continent.id}`} className={link}>
                      {continent.name}
                    </Link>
                    <span className="tabular-nums">{formatCount(continent.applications)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-sans text-[15px] font-bold text-ink">Busiest regions</h3>
              {data.topRegions.length ? (
                <ol className="flex flex-col gap-1 font-sans text-[14px] text-ink">
                  {data.topRegions.map((region) => (
                    <li key={region.id} className="flex justify-between gap-3">
                      <Link to={`/admin/reports/organisation?unit=${region.id}`} className={link}>
                        {region.name}
                      </Link>
                      <span className="tabular-nums">{formatCount(region.applications)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="font-sans text-[14px] text-muted">No applications linked to a parish yet.</p>
              )}
            </div>
          </div>
          {data.masked && <p className="font-sans text-[13px] text-muted">For your role, counts from 1 to 4 show as “fewer than 5”.</p>}
        </>
      )}
    </Panel>
  );
}

function ApplicationsTable({ rows }: { rows: Dashboard['applicationsByCohort'] }) {
  const cohorts = [...new Set(rows.map((row) => row.cohort))];
  if (!cohorts.length) return <p className="font-sans text-[15px] text-muted">No applications yet.</p>;
  const count = (cohort: string, status: ApplicationStatus) => rows.find((row) => row.cohort === cohort && row.status === status)?.n ?? 0;
  return (
    <TableScroll label="Applications by cohort and review status">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className={th}>
              Cohort
            </th>
            {APPLICATION_STATUSES.map((status) => (
              <th key={status} scope="col" className={`${th} text-right`}>
                {REVIEW_STATUS_LABELS[status]}
              </th>
            ))}
            <th scope="col" className={`${th} text-right`}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort}>
              <th scope="row" className={`${td} text-left font-semibold`}>
                {cohort}
              </th>
              {APPLICATION_STATUSES.map((status) => (
                <td key={status} className={`${td} text-right tabular-nums`}>
                  {count(cohort, status)}
                </td>
              ))}
              <td className={`${td} text-right font-bold tabular-nums`}>{APPLICATION_STATUSES.reduce((sum, status) => sum + count(cohort, status), 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function HealthBadges({ health }: { health: Dashboard['health'] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      <li>
        <Badge tone={health.database === 'ok' ? 'success' : 'danger'}>Database {health.database === 'ok' ? 'OK' : 'error'}</Badge>
      </li>
      <li>
        <Badge tone={health.email.canSend && health.email.transport === 'smtp' ? 'success' : 'warning'}>
          Email {health.email.canSend ? (health.email.transport === 'outbox' ? 'test outbox only' : 'configured') : 'not configured'}
        </Badge>
      </li>
      <li>
        <Badge tone={health.push.configured ? 'success' : 'warning'}>Push {health.push.configured ? 'configured' : 'not configured'}</Badge>
      </li>
      <li>
        <Badge tone={health.worker.healthy ? 'success' : 'danger'}>Background worker {health.worker.healthy ? 'running' : 'not seen recently'}</Badge>
      </li>
    </ul>
  );
}

/** Aggregates only; every label says exactly what was counted. */
export default function DashboardPage() {
  const staff = useStaff();
  const canReports = useCan('reports.view');
  const { data, error, reload } = useAsync((signal) => adminApi.dashboard(signal), []);
  const name = staff.step === 'signed-in' ? staff.session.staff.displayName : '';
  return (
    <>
      <PageHeader eyebrow="Admin" title="Dashboard" documentTitle="Dashboard · Admin" description={`Welcome, ${name}. Figures cover the last 30 days unless they say otherwise.`} />
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Panel title="System status">
            <HealthBadges health={data.health} />
          </Panel>

          <Panel title="Applications by cohort and review status" actions={<Link to="/admin/applicants" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">Open applicants</Link>}>
            <ApplicationsTable rows={data.applicationsByCohort} />
          </Panel>

          {canReports && <ParishCard />}

          <Panel title="People and devices">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Verified accounts" value={data.accounts.active ?? 0} hint={data.accounts.suspended ? `${data.accounts.suspended} suspended` : undefined} />
              <Stat label="Active subscriptions (devices)" value={data.subscriptions.activeDevices} hint="Devices, not people: one person may have several." />
              <Stat label="Devices linked to accounts" value={data.subscriptions.linkedToAccounts} />
              <Stat label="Devices without an account" value={data.subscriptions.anonymous} />
            </dl>
            {data.subscriptions.byTopic.length > 0 && (
              <ul className="flex flex-wrap gap-2 font-sans text-[14px] text-muted">
                {data.subscriptions.byTopic.map((row) => (
                  <li key={row.topic}>
                    <Badge>
                      {TOPIC_DETAILS[row.topic].label}: {row.linked + row.anonymous} devices
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Notifications sent (last 30 days)" description="“Accepted by push service” means Apple, Google, Mozilla or Microsoft took the message. It doesn’t mean the notification was shown or read.">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Accepted by push service" value={data.deliveriesLast30Days.accepted ?? 0} />
              <Stat label="Waiting or retrying" value={data.deliveriesLast30Days.queued ?? 0} />
              <Stat label="Failed" value={data.deliveriesLast30Days.failed ?? 0} />
              <Stat label="Expired before sending" value={data.deliveriesLast30Days.expired ?? 0} />
              <Stat label="Skipped (no longer eligible)" value={data.deliveriesLast30Days.skipped ?? 0} />
            </dl>
            <p className="font-sans text-[14px] text-muted">
              Campaigns created: {Object.entries(data.campaignsLast30Days).map(([status, n]) => `${n} ${status}`).join(', ') || 'none'}.
            </p>
          </Panel>

          <Panel title="Website and app (last 30 days)" description="Anonymous counts. Installs we can’t observe (for example on iPhone) are not included.">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Applications submitted" value={data.productLast30Days.applicationsSubmitted} />
              <Stat label="Observed installs" value={data.productLast30Days.observedInstalls} hint="Only browsers that report installs (Chromium)." />
              <Stat label="Launches from the installed app" value={data.productLast30Days.standaloneLaunches} hint="Sessions opened in an app window." />
              <Stat
                label="Install prompt: accepted / dismissed"
                value={`${data.productLast30Days.installPromptAccepted} / ${data.productLast30Days.installPromptDismissed}`}
              />
              <Stat label="Notifications turned on" value={data.productLast30Days.notificationOptIns} />
              <Stat label="Notifications turned off" value={data.productLast30Days.notificationOptOuts} />
              <Stat label="Reported notification clicks" value={data.productLast30Days.recordedNotificationClicks} hint="As devices reported them: not every click gets through, and reports aren't verified." />
            </dl>
          </Panel>

          <Panel title="Background jobs">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Waiting" value={data.queue.pending} hint={data.queue.oldestPendingAt ? `Oldest due ${when(data.queue.oldestPendingAt)}` : undefined} />
              <Stat label="Running" value={data.queue.running} />
              <Stat label="Failed (last 7 days)" value={data.queue.failedLast7Days} />
            </dl>
            {data.queue.recentFailures.length > 0 && (
              <ul className="flex flex-col gap-1 font-sans text-[14px] text-ink">
                {data.queue.recentFailures.map((failure, index) => (
                  <li key={index}>
                    <strong>{failure.kind}</strong> · {when(failure.updated_at)}
                    {failure.last_error ? ` · ${failure.last_error}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.recentActions.length > 0 && (
            <Panel title="Recent admin actions" actions={<Link to="/admin/audit" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">Audit history</Link>}>
              <ul className="flex flex-col gap-1.5 font-sans text-[14px] text-ink">
                {data.recentActions.map((action, index) => (
                  <li key={index}>
                    <span className="text-muted">{when(action.at)}</span> · {action.actor} · <code className="font-mono text-[13px]">{action.action}</code>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
