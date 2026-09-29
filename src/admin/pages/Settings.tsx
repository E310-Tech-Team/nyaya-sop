import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Panel, errorMessage, when } from '../../components/ui';
import { APP_BUILD } from '../../lib/pwa';
import { useAsync } from '../../lib/useAsync';
import { adminApi, type Health, type Settings } from '../api';

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

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
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
          <SettingsForm settings={data.settings} onSaved={reload} />
          <HealthPanel health={data.health} />
        </>
      )}
    </>
  );
}
