import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Input, LoadError, Loading, Notice, PageHeader, Panel, errorMessage, when } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { ROLE_LABELS } from '../../shared/permissions';
import type { StaffPasskey } from '../../shared/platform';
import { adminApi, type MfaMethods } from '../api';
import { AddPasskey, AppEnrolment, EmailCodesEnrolment, RecoveryCodesShown, SetUpFirstMethod, StepUp } from '../mfa';
import { useAction } from '../parts';
import { loadStaffSession, staffSignedOut, useStaff, type StaffSession } from '../session';

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

const muted = 'font-sans text-[14px] leading-[1.55] text-muted';

/** One passkey: its name (renamable), when it was added and last used, and Remove. */
function PasskeyRow({ passkey, canChange, onChanged }: { passkey: StaffPasskey; canChange: boolean; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.nickname);
  const [confirming, setConfirming] = useState(false);
  const { busy, run, notice } = useAction();
  return (
    <li className="flex flex-col gap-3 rounded-[10px] border border-line px-4 py-3">
      {notice}
      {renaming ? (
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run('rename', () => adminApi.renamePasskey(passkey.id, name.trim())).then((ok) => {
              if (ok) {
                setRenaming(false);
                onChanged();
              }
            });
          }}
        >
          <Input label="Passkey name" maxLength={60} value={name} onChange={(event) => setName(event.currentTarget.value)} className="w-[260px]" />
          <Button type="submit" busy={busy === 'rename'} disabled={!name.trim()}>
            Save
          </Button>
          <Button tone="secondary" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-sans text-[14px] text-ink">
            <strong>{passkey.nickname}</strong> {passkey.backedUp && <Badge tone="success">Backed up</Badge>}
            <br />
            <span className="text-muted">
              Added {when(passkey.createdAt)} · {passkey.lastUsedAt ? `last used ${when(passkey.lastUsedAt)}` : 'not used yet'}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            <Button tone="secondary" onClick={() => setRenaming(true)}>
              Rename
            </Button>
            {canChange && (
              <Button tone="secondary" onClick={() => setConfirming(true)}>
                Remove
              </Button>
            )}
          </span>
        </div>
      )}
      {confirming && canChange && (
        <RemovalConfirm
          prompt={`Remove “${passkey.nickname}”? You won’t be able to sign in with it any more.`}
          confirmLabel="Remove passkey"
          action={() => adminApi.removePasskey(passkey.id)}
          onDone={onChanged}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}

/** "Are you sure?" right under the action, with its own result message (not at the top of the page). */
function RemovalConfirm({ prompt, confirmLabel, action, onDone, onCancel }: { prompt: string; confirmLabel: string; action: () => Promise<unknown>; onDone: () => void; onCancel: () => void }) {
  const { busy, run, notice } = useAction();
  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-cream px-3 py-2">
      {notice}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-sans text-[14px] text-ink">{prompt}</span>
        <Button tone="danger" busy={busy === 'remove'} onClick={() => void run('remove', action).then((ok) => ok && onDone())}>
          {confirmLabel}
        </Button>
        <Button tone="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** New recovery codes, shown once, with the result message beside the button. */
function NewRecoveryCodes({ remaining, canChange, onReplaced }: { remaining: number; canChange: boolean; onReplaced: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const { busy, run, notice } = useAction();
  if (codes) return <RecoveryCodesShown codes={codes} />;
  return (
    <>
      {notice}
      <p className={muted}>{remaining === 1 ? '1 unused code.' : `${remaining} unused codes.`}</p>
      {canChange && (
        <div>
          <Button
            tone="secondary"
            busy={busy === 'codes'}
            onClick={() =>
              void run('codes', async () => {
                setCodes((await adminApi.newRecoveryCodes()).recoveryCodes);
                onReplaced();
              })
            }
          >
            Create new recovery codes
          </Button>
        </div>
      )}
    </>
  );
}

type Adding = 'passkey' | 'app' | 'email' | null;

/** Your sign-in methods (06 D-58). Changes need a recent "confirm it's you" (five minutes). */
function SignInMethods({ session }: { session: StaffSession }) {
  const { data, error, reload } = useAsync(() => adminApi.mfaMethods(), []);
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState<Adding>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<'app' | 'email' | null>(null);

  // When the five minutes run out, the change buttons go and "Confirm it's you" comes back.
  const until = data?.stepUpUntil ? Date.parse(data.stepUpUntil) : 0;
  useEffect(() => {
    const wait = until - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 250);
    return () => window.clearTimeout(timer);
  }, [until]);

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const refresh = () => {
    setNow(Date.now());
    reload();
    void loadStaffSession();
  };
  if (!session.mfa.enabled) {
    return (
      <Panel title="Two-step verification" description="Not set up. Choose your first way to confirm it’s you.">
        <SetUpFirstMethod session={session} onDone={refresh} />
      </Panel>
    );
  }

  const { summary, passkeys } = data as MfaMethods;
  const canChange = until > now;
  const finished = () => {
    setAdding(null);
    refresh();
  };
  const methods = [
    summary.passkeys ? `${summary.passkeys === 1 ? 'a passkey' : `${summary.passkeys} passkeys`}` : null,
    summary.app ? 'an authenticator app' : null,
    summary.emailCodes ? 'codes by email' : null,
  ].filter(Boolean);

  return (
    <>
      <Panel title="Two-step verification" description={`On: ${methods.join(', ')}. If you lose them all, another owner can reset it for you.`}>
        {canChange ? (
          <Notice tone="success">You can change your sign-in methods until {when(data.stepUpUntil)}.</Notice>
        ) : (
          <StepUp summary={summary} emailAvailable={data.emailAvailable} onConfirmed={refresh} />
        )}
      </Panel>

      <Panel title="Passkeys" description="Your fingerprint, face or device PIN. Sign in with a passkey alone, or use it after your password.">
        {passkeys.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {passkeys.map((passkey) => (
              <PasskeyRow key={passkey.id} passkey={passkey} canChange={canChange} onChanged={refresh} />
            ))}
          </ul>
        ) : (
          <p className={muted}>None yet.</p>
        )}
        {canChange &&
          (adding === 'passkey' ? (
            <AddPasskey onAdded={finished} />
          ) : (
            <div>
              <Button tone="secondary" onClick={() => setAdding('passkey')}>
                Add a passkey
              </Button>
            </div>
          ))}
      </Panel>

      <Panel title="Authenticator app" description="A six-digit code from an app on your phone.">
        <p className={muted}>{summary.app ? 'On.' : 'Not set up.'}</p>
        {canChange &&
          (adding === 'app' ? (
            <AppEnrolment onConfirmed={finished} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button tone="secondary" onClick={() => setAdding('app')}>
                {summary.app ? 'Replace the app' : 'Set up an app'}
              </Button>
              {summary.app && (
                <Button tone="secondary" onClick={() => setConfirmingRemoval('app')}>
                  Remove the app
                </Button>
              )}
            </div>
          ))}
        {canChange && confirmingRemoval === 'app' && (
          <RemovalConfirm
            prompt="Remove the authenticator app? Its codes will stop working."
            confirmLabel="Remove the app"
            action={() => adminApi.removeApp()}
            onDone={() => {
              setConfirmingRemoval(null);
              refresh();
            }}
            onCancel={() => setConfirmingRemoval(null)}
          />
        )}
      </Panel>

      {(data.emailAvailable || summary.emailCodes) && (
        <Panel
          title="Codes by email"
          description={`A six-digit code sent to ${session.staff.email}. The simplest way, but the weakest: anyone who knows your password and can open your email could sign in.`}
        >
          <p className={muted}>{summary.emailCodes ? 'On.' : 'Off.'}</p>
          {canChange &&
            (adding === 'email' ? (
              <EmailCodesEnrolment email={session.staff.email} onConfirmed={finished} />
            ) : summary.emailCodes ? (
              <div>
                <Button tone="secondary" onClick={() => setConfirmingRemoval('email')}>
                  Turn off email codes
                </Button>
              </div>
            ) : (
              data.emailAvailable && (
                <div>
                  <Button tone="secondary" onClick={() => setAdding('email')}>
                    Turn on email codes
                  </Button>
                </div>
              )
            ))}
          {canChange && confirmingRemoval === 'email' && (
            <RemovalConfirm
              prompt="Turn off email codes? You won’t be able to confirm it’s you by email."
              confirmLabel="Turn off"
              action={() => adminApi.removeEmailCodes()}
              onDone={() => {
                setConfirmingRemoval(null);
                refresh();
              }}
              onCancel={() => setConfirmingRemoval(null)}
            />
          )}
        </Panel>
      )}

      <Panel title="Recovery codes" description="Each works once, if you can’t use your other ways in. New codes replace the old ones.">
        <NewRecoveryCodes remaining={summary.recoveryCodes} canChange={canChange} onReplaced={reload} />
      </Panel>
    </>
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
  const { staff: me } = staff.session;
  return (
    <>
      <PageHeader eyebrow="Your account" title="Your security" documentTitle="Your security · Admin" description={`${me.displayName} · ${me.email} · ${ROLE_LABELS[me.role]}`} />
      <SignInMethods session={staff.session} />
      <ChangePassword />
      <Sessions />
    </>
  );
}
