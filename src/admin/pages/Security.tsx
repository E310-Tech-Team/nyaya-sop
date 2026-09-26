import { useState, type FormEvent } from 'react';
import { Badge, Button, Input, LoadError, Loading, Notice, PageHeader, Panel, errorMessage, when } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { useAsync } from '../../lib/useAsync';
import { ROLE_LABELS } from '../../shared/permissions';
import { adminApi } from '../api';
import { useAction } from '../parts';
import { staffSignedOut, useStaff } from '../session';

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await adminApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setResult({ tone: 'success', text: 'Password changed. Your other sessions were signed out.' });
    } catch (caught) {
      setResult({ tone: 'error', text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Password">
      <form noValidate onSubmit={submit} className="flex max-w-[420px] flex-col gap-4">
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.currentTarget.value)} />
        <Input label="New password" type="password" autoComplete="new-password" hint="At least 12 characters." value={next} onChange={(event) => setNext(event.currentTarget.value)} />
        <Input
          label="Type the new password again"
          type="password"
          autoComplete="new-password"
          error={again && again !== next ? 'The passwords don’t match.' : undefined}
          value={again}
          onChange={(event) => setAgain(event.currentTarget.value)}
        />
        <div>
          <Button type="submit" busy={busy} disabled={!current || next.length < 12 || next !== again}>
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function RecoveryCodes() {
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, run, notice } = useAction();
  return (
    <Panel title="Recovery codes" description="New codes replace the old ones. You need a current code from your authenticator app.">
      {notice}
      {codes ? (
        <>
          <Notice tone="success">Save these somewhere safe. They won’t be shown again.</Notice>
          <ul className="grid max-w-[360px] grid-cols-2 gap-2 rounded-[10px] border border-line bg-cream p-4 font-mono text-[15px]">
            {codes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <Button tone="secondary" onClick={async () => setCopied(await copyText(codes.join('\n')))}>
              Copy codes
            </Button>
            <span role="status" className="font-sans text-[13px] text-muted">
              {copied ? 'Copied.' : ''}
            </span>
          </div>
        </>
      ) : (
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run('codes', async () => setCodes((await adminApi.newRecoveryCodes(code.replace(/\s/g, ''))).recoveryCodes));
          }}
        >
          <Input label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.currentTarget.value)} className="w-[200px]" />
          <Button type="submit" busy={busy === 'codes'} disabled={code.replace(/\s/g, '').length !== 6}>
            Create new recovery codes
          </Button>
        </form>
      )}
    </Panel>
  );
}

function Sessions() {
  const { data, error, reload } = useAsync(() => adminApi.mySessions(), []);
  const { busy, run, notice } = useAction();
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <Panel title="Where you’re signed in">
      {notice}
      <ul className="flex flex-col gap-2">
        {data.sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3">
            <span className="font-sans text-[14px] text-ink">
              <strong>{session.deviceLabel}</strong> {session.current && <Badge tone="success">This device</Badge>}
              <br />
              <span className="text-muted">
                Signed in {when(session.createdAt)} · last active {when(session.lastSeenAt)}
              </span>
            </span>
            <Button
              tone="secondary"
              busy={busy === session.id}
              onClick={() =>
                void run(session.id, () => adminApi.revokeMySession(session.id)).then((ok) => {
                  if (ok && session.current) staffSignedOut();
                  else reload();
                })
              }
            >
              Sign out
            </Button>
          </li>
        ))}
      </ul>
      {data.sessions.some((session) => !session.current) && (
        <div>
          <Button tone="secondary" busy={busy === 'others'} onClick={() => void run('others', () => adminApi.revokeMyOtherSessions(), 'Signed out of all other devices.').then(reload)}>
            Sign out of all other devices
          </Button>
        </div>
      )}
    </Panel>
  );
}

export default function SecurityPage() {
  const staff = useStaff();
  if (staff.step !== 'signed-in') return null;
  const { staff: me, mfa } = staff.session;
  return (
    <>
      <PageHeader eyebrow="Your account" title="Your security" documentTitle="Your security · Admin" description={`${me.displayName} · ${me.email} · ${ROLE_LABELS[me.role]}`} />
      <Panel title="Two-step verification">
        <p className="font-sans text-[15px] text-ink">
          {mfa.enabled ? 'On. You’ll be asked for a code from your authenticator app when you sign in.' : 'Not set up.'} If you lose your phone and your recovery
          codes, another owner can reset it for you.
        </p>
      </Panel>
      {mfa.enabled && <RecoveryCodes />}
      <ChangePassword />
      <Sessions />
    </>
  );
}
