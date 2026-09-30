import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Panel, errorMessage, when } from '../../components/ui';
import { APP_BUILD } from '../../lib/pwa';
import { useAsync } from '../../lib/useAsync';
import { adminApi, type DirectoryReadiness, type Health, type Settings } from '../api';
import { useCan } from '../session';

/** What a sync failure code means, in words (the codes are all the server keeps). */
const SYNC_PROBLEMS: Record<string, string> = {
  api_unauthorized: 'the RCCG directory refused the key (check DIRECTORY_API_KEY)',
  api_forbidden: 'the key doesn’t cover the whole directory (ask the registry team)',
  api_rate_limited: 'too many requests: it tries again at the next check',
  api_unavailable: 'the RCCG directory didn’t answer',
  api_timeout: 'the RCCG directory didn’t answer in time',
  api_network: 'the RCCG directory couldn’t be reached',
  api_invalid_response: 'the RCCG directory sent an unexpected answer',
  api_bad_request: 'the RCCG directory refused a request',
  incomplete_release: 'a release arrived incomplete, so it wasn’t applied',
  inconsistent_pages: 'a release arrived incomplete, so it wasn’t applied',
  release_chain: 'the releases don’t lead back to a base release',
  empty_release: 'the latest release describes no units',
  inconsistent: 'the result wouldn’t be consistent, so nothing was changed',
};

/** The RCCG directory API's side: which environment, which release, and how current the copy is. */
function apiRows(api: NonNullable<DirectoryReadiness['api']>): [string, ReactNode][] {
  const problem = api.lastError ? (SYNC_PROBLEMS[api.lastError] ?? `an error (${api.lastError})`) : null;
  const handover = api.oldList.matched + api.oldList.ambiguous + api.oldList.unmatched;
  return [
    ['Source', `RCCG directory API, ${api.env === 'production' ? 'production' : 'sandbox (test data)'}`],
    ['Release in use', api.release ? `${api.release}${api.releaseName ? ` (${api.releaseName})` : ''}` : 'None yet: waiting for the first sync'],
    [
      'Last confirmed current',
      <span>
        {api.checkedAt ? when(api.checkedAt) : 'Not yet'}{' '}
        {!api.fresh && <Badge tone="warning">May be out of date</Badge>}
      </span>,
    ],
    ['Last update applied', api.syncedAt ? when(api.syncedAt) : 'Not yet'],
    ['How it stays current', `Checked every ${api.syncIntervalMinutes} minutes. After ${api.freshnessHours} hours without a confirmation, each application checks its parish with the RCCG directory directly.`],
    ['Last problem', problem ? `${problem}: ${api.failures} in a row, last ${when(api.lastErrorAt)}` : 'None'],
    ...(handover
      ? ([
          [
            'Old list',
            `${handover} parishes from the earlier list have applications: ${api.oldList.matched} with one exact match in the RCCG directory, ${api.oldList.ambiguous} with several, ${api.oldList.unmatched} with none. Their applications keep their answer until staff link them (pnpm directory legacy-report lists them).`,
          ],
        ] as [string, ReactNode][])
      : []),
  ];
}

/** "Check for updates now": queues a sync for the worker. */
function CheckNow() {
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'failed'>('idle');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        tone="secondary"
        busy={state === 'busy'}
        onClick={() => {
          setState('busy');
          adminApi.syncDirectoryNow().then(
            () => setState('queued'),
            () => setState('failed'),
          );
        }}
      >
        Check for updates now
      </Button>
      <p role="status" className="font-sans text-[13px] text-muted">
        {state === 'queued' ? 'Queued: the worker checks within a minute. Reload to see the result.' : state === 'failed' ? 'That didn’t work. Try again in a moment.' : ''}
      </p>
    </div>
  );
}

/** What the parish question would search: the list that's loaded, from where, and what's waiting. */
function DirectoryPanel({ directory }: { directory: DirectoryReadiness }) {
  const { levels, parishes, latestImport } = directory;
  const canManage = useCan('directory.manage');
  const link = 'font-bold text-brand underline underline-offset-4';
  const rows: [string, ReactNode][] = [
    ...(directory.api ? apiRows(directory.api) : []),
    [
      'Active parishes',
      <span>
        {parishes.active.toLocaleString('en-GB')}
        {parishes.inactive + parishes.merged > 0 && <span className="text-muted"> ({parishes.inactive} inactive, {parishes.merged} merged)</span>}
      </span>,
    ],
    ['Units', `${levels.continent.active} continents · ${levels.region.active} regions · ${levels.province.active} provinces`],
    [
      'Loaded from',
      latestImport
        ? `${latestImport.label} (${latestImport.source === 'api' ? 'RCCG API' : 'spreadsheet'}${latestImport.structureAsAt ? `, correct as at ${latestImport.structureAsAt}` : ''}), ${when(latestImport.finishedAt)}`
        : 'Nothing imported yet',
    ],
    [
      'Waiting in Parish review',
      directory.pendingReviews ? (
        <Link to="/admin/parish-review" className={link}>
          {directory.pendingReviews}
        </Link>
      ) : (
        '0'
      ),
    ],
    ['Staff corrections', String(directory.corrections)],
    ['2026 changes waiting for data', directory.lineageWaiting ? <Link to="/admin/directory?tab=changes" className={link}>{directory.lineageWaiting}</Link> : '0'],
  ];
  return (
    <Panel
      title="Parish directory"
      description={
        directory.api
          ? 'The RCCG parish directory the parish question searches: a copy kept in step with the RCCG directory API.'
          : 'The RCCG parish list the parish question searches. Imports run on the server (docs/DEPLOYMENT.md, “Parish directory”).'
      }
      actions={
        <Link to="/admin/directory" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">
          Open the directory
        </Link>
      }
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[220px_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-sans text-[13px] font-semibold text-muted">{label}</dt>
            <dd className="font-sans text-[14px] text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {directory.api && canManage && <CheckNow />}
    </Panel>
  );
}

function HealthPanel({ health }: { health: Health }) {
  const rows: [string, ReactNode][] = [
    ['Database', <Badge tone={health.database === 'ok' ? 'success' : 'danger'}>{health.database === 'ok' ? 'Reachable' : 'Error'}</Badge>],
    [
      'Email',
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={health.email.canSend && health.email.transport === 'smtp' ? 'success' : 'warning'}>
          {health.email.transport === 'smtp' ? 'SMTP configured' : health.email.transport === 'outbox' ? 'Local test outbox (nothing is really sent)' : 'Not configured'}
        </Badge>
        {!health.email.canSend && <span className="text-[13px] text-muted">Applicant sign-in and emailed staff invitations are switched off.</span>}
      </span>,
    ],
    [
      'Web Push',
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={health.push.configured ? 'success' : 'warning'}>{health.push.configured ? 'VAPID keys configured' : 'Not configured'}</Badge>
        {health.push.publicKeyFingerprint && <span className="text-[13px] text-muted">Public key begins {health.push.publicKeyFingerprint}…</span>}
      </span>,
    ],
    [
      'Background worker',
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={health.worker.healthy ? 'success' : 'danger'}>{health.worker.healthy ? 'Running' : 'Not seen in the last 2 minutes'}</Badge>
        <span className="text-[13px] text-muted">
          {health.worker.mode === 'inline' ? 'Runs inside the web server' : 'Separate worker process'} · last seen {when(health.worker.lastHeartbeat)}
        </span>
      </span>,
    ],
    ['Job queue', `${health.queue.pending} waiting, ${health.queue.running} running, ${health.queue.failedLast7Days} failed in the last 7 days`],
    ['Site address', health.siteOrigin ?? 'Not set (development)'],
    ['Two-step verification', health.mfaRequired ? 'Required for all staff' : 'Optional (development setting)'],
    // The website and the API can be released separately (the website on Vercel): show both when they differ.
    ['Release', health.buildId === APP_BUILD ? health.buildId : `Server ${health.buildId} · this page ${APP_BUILD}`],
  ];
  return (
    <Panel title="Integrations and health" description="Status only: secret values are never shown here.">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[180px_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-sans text-[13px] font-semibold text-muted">{label}</dt>
            <dd className="font-sans text-[14px] text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function SettingsForm({ settings, directory, onSaved }: { settings: Settings; directory: DirectoryReadiness; onSaved: () => void }) {
  const directoryReady = directory.parishes.active > 0;
  const [values, setValues] = useState(settings);
  useEffect(() => setValues(settings), [settings]);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await adminApi.saveSettings({ ...values, support_email: values.support_email?.trim() || null });
      setResult({ tone: 'success', text: 'Settings saved.' });
      onSaved();
    } catch (caught) {
      setResult({ tone: 'error', text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Settings">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <Input
          label="Support email shown to applicants"
          type="email"
          hint="Leave empty to use the site’s contact address, if one is set."
          value={values.support_email ?? ''}
          onChange={(event) => setValues({ ...values, support_email: event.currentTarget.value })}
          className="max-w-[420px]"
        />
        <Checkbox
          label="Let applicants sign in to follow their applications"
          hint="Sign-in also needs working email. Turning this off doesn’t delete existing accounts."
          checked={values.applicant_accounts_enabled}
          onChange={(event) => setValues({ ...values, applicant_accounts_enabled: event.currentTarget.checked })}
        />
        <Checkbox
          label="Let visitors without an account turn on programme announcements"
          hint="Turning this off pauses new sign-ups only; people already signed up keep their notifications."
          checked={values.public_notifications_enabled}
          onChange={(event) => setValues({ ...values, public_notifications_enabled: event.currentTarget.checked })}
        />
        <Checkbox
          label="Ask applicants to choose their parish from the RCCG directory"
          hint={
            directoryReady
              ? `They search ${directory.parishes.active.toLocaleString('en-GB')} parishes, and the province, region and continent fill in. When this is off, the form asks for the parish as free text.`
              : 'Import the RCCG parish list first (docs/DEPLOYMENT.md, “Parish directory”). Until then the form asks for the parish as free text.'
          }
          checked={values.parish_directory_enabled}
          disabled={!directoryReady && !values.parish_directory_enabled}
          onChange={(event) => setValues({ ...values, parish_directory_enabled: event.currentTarget.checked })}
        />
        <div>
          <Button type="submit" busy={busy}>
            Save settings
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export default function SettingsPage() {
  const { data, error, reload } = useAsync((signal) => adminApi.settings(signal), []);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" documentTitle="Settings · Admin" description="Changes are recorded in the audit history." />
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <SettingsForm settings={data.settings} directory={data.directory} onSaved={reload} />
          <DirectoryPanel directory={data.directory} />
          <HealthPanel health={data.health} />
        </>
      )}
    </>
  );
}
