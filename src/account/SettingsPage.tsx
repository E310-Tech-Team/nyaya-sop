import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Input, LoadError, Loading, Notice, Panel, errorMessage, when } from '../components/ui';
import { site } from '../config/site';
import { markSignedOut, useAccount } from '../lib/account';
import { usePublicConfig } from '../lib/config';
import { useAsync } from '../lib/useAsync';
import { AccountFrame } from './AccountApp';
import { accountApi } from './api';

function Sessions() {
  const { data, error, reload } = useAsync((signal) => accountApi.sessions(signal), []);
  const [problem, setProblem] = useState<string | null>(null);
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const run = async (action: () => Promise<unknown>, signsOutHere = false) => {
    setProblem(null);
    try {
      await action();
      if (signsOutHere) markSignedOut();
      else reload();
    } catch (caught) {
      setProblem(errorMessage(caught));
    }
  };
  const others = data.sessions.filter((session) => !session.current).length;
  return (
    <div className="flex flex-col gap-3">
      {problem && <Notice tone="error">{problem}</Notice>}
      <ul className="flex flex-col gap-3">
        {data.sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-white px-4 py-3">
            <div>
              <p className="font-sans text-[15px] font-bold text-ink">
                {session.deviceLabel} {session.current && <Badge tone="success">This device</Badge>}
              </p>
              <p className="font-sans text-[13px] text-muted">
                Signed in {when(session.createdAt)} · last active {when(session.lastSeenAt)}
              </p>
            </div>
            <Button tone="secondary" onClick={() => void run(() => accountApi.revokeSession(session.id), session.current)}>
              Sign out
            </Button>
          </li>
        ))}
      </ul>
      {others > 0 && (
        <div>
          <Button tone="secondary" onClick={() => void run(() => accountApi.revokeOtherSessions())}>
            Sign out of all other devices
          </Button>
        </div>
      )}
    </div>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await accountApi.deleteAccount(confirm.trim());
      markSignedOut();
      navigate('/', { replace: true });
    } catch (caught) {
      setProblem(errorMessage(caught));
      setBusy(false);
    }
  }
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <p className="font-sans text-[15px] leading-[1.6] text-ink">
        Deleting your account signs you out everywhere, stops notifications to your devices and removes your messages. Applications you sent
        stay with the Programme team, as they were submitted.
      </p>
      {problem && <Notice tone="error">{problem}</Notice>}
      <Input label={`Type ${email} to confirm`} value={confirm} autoComplete="off" onChange={(event) => setConfirm(event.currentTarget.value)} />
      <div>
        <Button type="submit" tone="danger" busy={busy} disabled={confirm.trim().toLowerCase() !== email}>
          Delete my account
        </Button>
      </div>
    </form>
  );
}

export default function AccountSettingsPage() {
  const account = useAccount();
  const config = usePublicConfig();
  if (account.status !== 'signed-in') return null;
  const contact = config?.supportEmail || site.contactEmail;
  return (
    <AccountFrame title="Settings" documentTitle="Account settings">
      <Panel title="Your details">
        <p className="font-sans text-[15px] text-ink">
          Email address: <strong>{account.account.email}</strong>
        </p>
        {account.account.createdAt && <p className="font-sans text-[14px] text-muted">Account created {when(account.account.createdAt)}</p>}
        <p className="font-sans text-[14px] leading-[1.6] text-muted">
          To correct details on your application, contact the Programme team
          {contact ? (
            <>
              {' '}
              at{' '}
              <a className="font-bold text-brand underline underline-offset-4" href={`mailto:${contact}`}>
                {contact}
              </a>
            </>
          ) : null}
          .
        </p>
      </Panel>
      <Panel title="Where you’re signed in">
        <Sessions />
      </Panel>
      <Panel title="Delete your account">
        <DeleteAccount email={account.account.email} />
      </Panel>
    </AccountFrame>
  );
}
