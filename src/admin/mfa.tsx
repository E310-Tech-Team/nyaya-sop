/**
 * Two-step verification in the admin area (06 D-58): the step after the password, setting up the
 * first method, "confirm it's you" before a security change, and the pieces they share: passkeys,
 * the authenticator app's QR code, email codes and recovery codes.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Loading, Notice, errorMessage } from '../components/ui';
import { ApiError, setCsrfToken } from '../lib/api';
import { copyText } from '../lib/clipboard';
import type { StaffMfaSummary } from '../shared/platform';
import { adminApi, type SecondStepAnswer } from './api';
import { createPasskey, PasskeyCancelled, PasskeyProblem, passkeyAnswer, passkeysSupported, type PublicKeyCredentialRequestOptionsJSON } from './passkeys';
import { loadStaffSession, type StaffSession } from './session';

const text = 'font-sans text-[15px] leading-[1.6] text-ink';
const small = 'font-sans text-[13px] leading-[1.5] text-muted';
const linkButton = 'min-h-[40px] cursor-pointer self-start font-sans text-[14px] font-bold text-brand underline underline-offset-4';

/** Words for the person: a passkey prompt's own explanation, or the server's. */
const problemText = (caught: unknown) => (caught instanceof PasskeyProblem ? caught.message : errorMessage(caught));

type MethodResult = { recoveryCodes?: string[]; csrfToken?: string };

export type Way = 'passkey' | 'app' | 'email' | 'recovery';

const WAY_LABELS: Record<Way, string> = {
  passkey: 'Use your passkey',
  app: 'Use your authenticator app',
  email: 'Email me a code',
  recovery: 'Use a recovery code',
};

/**
 * The ways an account can answer, strongest first. An email code never confirms a password reset
 * (the link came by email), and confirms a change only where email codes are the only method.
 */
export function waysFor(summary: StaffMfaSummary, emailAvailable: boolean, purpose: 'sign_in' | 'step_up' | 'reset'): Way[] {
  const ways: Way[] = [];
  if (summary.passkeys > 0 && passkeysSupported()) ways.push('passkey');
  if (summary.app) ways.push('app');
  const stronger = summary.passkeys > 0 || summary.app;
  if (summary.emailCodes && emailAvailable && (purpose === 'sign_in' || (purpose === 'step_up' && !stronger))) ways.push('email');
  if (summary.recoveryCodes > 0) ways.push('recovery');
  return ways;
}

/** Passkey options, fetched ahead of the click (each works once: fetched again after a try). */
function usePrefetched<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setValue(null);
    load().then(
      (result) => live && setValue(result),
      (caught) => live && setProblem(errorMessage(caught)),
    );
    return () => {
      live = false;
    };
  }, [load, round]);
  const refresh = () => {
    setProblem(null);
    setRound((n) => n + 1);
  };
  return { value, problem, refresh };
}

/** One button for a passkey: the prompt opens straight from the click (Safari's user-gesture rule). */
export function PasskeyButton({
  label,
  loadOptions,
  onAnswer,
  tone = 'primary',
  disabled = false,
}: {
  label: string;
  loadOptions: () => Promise<PublicKeyCredentialRequestOptionsJSON>;
  onAnswer: (passkey: unknown) => Promise<void>;
  tone?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const options = usePrefetched(loadOptions);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; cancelled: boolean } | null>(null);
  const click = async () => {
    if (!options.value) return;
    setBusy(true);
    setProblem(null);
    try {
      const passkey = await passkeyAnswer(options.value);
      await onAnswer(passkey);
    } catch (caught) {
      setProblem({ text: problemText(caught), cancelled: caught instanceof PasskeyCancelled });
      options.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {problem && <Notice tone={problem.cancelled ? 'warning' : 'error'}>{problem.text}</Notice>}
      {options.problem ? (
        <>
          <Notice tone="error">{options.problem}</Notice>
          <div>
            <Button tone="secondary" onClick={options.refresh}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button tone={tone} busy={busy} disabled={disabled || !options.value} onClick={() => void click()}>
            {label}
          </Button>
        </div>
      )}
    </div>
  );
}

function CodeForm({
  label,
  hint,
  numeric = false,
  submitLabel = 'Continue',
  disabled = false,
  onSubmit,
}: {
  label: string;
  hint?: string;
  numeric?: boolean;
  submitLabel?: string;
  disabled?: boolean;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await onSubmit(value);
    } catch (caught) {
      setProblem(problemText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <Input
        label={label}
        hint={hint}
        error={problem}
        inputMode={numeric ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        className="max-w-[300px]"
      />
      <div>
        <Button type="submit" busy={busy} disabled={disabled || !value.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** "Email me a code", then the code. The answer is the same whether or not a code was sent. */
function EmailCodeForm({
  send,
  onSubmit,
  sendLabel = 'Email me a code',
  submitLabel,
}: {
  send: () => Promise<{ message: string }>;
  onSubmit: (code: string) => Promise<void>;
  sendLabel?: string;
  submitLabel?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const request = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setMessage((await send()).message);
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {problem && <Notice tone="error">{problem}</Notice>}
      {message ? (
        <>
          <Notice>{message}</Notice>
          <CodeForm label="Six-digit code from the email" numeric submitLabel={submitLabel} onSubmit={onSubmit} />
          <button type="button" className={linkButton} disabled={busy} onClick={() => void request()}>
            Send a new code
          </button>
        </>
      ) : (
        <div>
          <Button busy={busy} onClick={() => void request()}>
            {sendLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One answer, by the first of `ways`, with the others offered underneath. */
export function WaysToAnswer({
  ways,
  passkeyOptions,
  sendEmail,
  onAnswer,
  passkeyLabel = 'Use your passkey',
  submitLabel,
  disabled = false,
}: {
  ways: Way[];
  passkeyOptions?: () => Promise<PublicKeyCredentialRequestOptionsJSON>;
  sendEmail?: () => Promise<{ message: string }>;
  onAnswer: (answer: SecondStepAnswer) => Promise<void>;
  passkeyLabel?: string;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const [chosen, setChosen] = useState<Way | null>(null);
  // The ways can change after the first render (a reset link turns out to have no passkey).
  const way = chosen && ways.includes(chosen) ? chosen : (ways[0] ?? 'recovery');
  const setWay = setChosen;
  const others = ways.filter((item) => item !== way);
  return (
    <div className="flex flex-col gap-4">
      {way === 'passkey' && passkeyOptions && (
        <>
          <p className={text}>Your device will ask for your fingerprint, face or PIN.</p>
          <PasskeyButton label={passkeyLabel} loadOptions={passkeyOptions} disabled={disabled} onAnswer={(passkey) => onAnswer({ passkey })} />
        </>
      )}
      {way === 'app' && (
        <CodeForm
          key="app"
          label="Six-digit code from your authenticator app"
          numeric
          submitLabel={submitLabel}
          disabled={disabled}
          onSubmit={(code) => onAnswer({ code: code.replace(/\s/g, '') })}
        />
      )}
      {way === 'email' && sendEmail && (
        <EmailCodeForm key="email" send={sendEmail} submitLabel={submitLabel} onSubmit={(emailCode) => onAnswer({ emailCode: emailCode.replace(/\s/g, '') })} />
      )}
      {way === 'recovery' && (
        <CodeForm
          key="recovery"
          label="Recovery code"
          hint="Each recovery code works once."
          submitLabel={submitLabel}
          disabled={disabled}
          onSubmit={(recoveryCode) => onAnswer({ recoveryCode: recoveryCode.trim() })}
        />
      )}
      {others.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <p className={small}>Another way:</p>
          {others.map((item) => (
            <button key={item} type="button" className={linkButton} onClick={() => setWay(item)}>
              {WAY_LABELS[item]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The step after the password. */
export function SecondStep({ session }: { session: StaffSession }) {
  const ways = waysFor(session.mfa.methods, session.mfa.emailAvailable, 'sign_in');
  const finish = async (answer: SecondStepAnswer) => {
    try {
      // Passing it starts a new session (new cookie and CSRF token).
      setCsrfToken('staff', (await adminApi.verifyMfa(answer)).csrfToken);
      await loadStaffSession();
    } catch (caught) {
      // Too many wrong answers ends the session: back to the password.
      if (caught instanceof ApiError && caught.status === 401 && /sign in again/i.test(caught.message)) await loadStaffSession();
      throw caught;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className={text}>Confirm it’s you to finish signing in.</p>
      {ways.length ? (
        <WaysToAnswer ways={ways} passkeyOptions={adminApi.secondStepPasskeyOptions} sendEmail={adminApi.sendEmailCode} onAnswer={finish} />
      ) : (
        <Notice tone="warning">This browser can’t use passkeys. Sign in with another browser or device, or use a recovery code if you have one.</Notice>
      )}
      <p className={small}>Lost access to all of these? Ask an owner to reset your two-step verification.</p>
    </div>
  );
}

/** "Confirm it's you" before a security change: the strongest ways the account has. */
export function StepUp({ summary, emailAvailable, onConfirmed }: { summary: StaffMfaSummary; emailAvailable: boolean; onConfirmed: () => void }) {
  const ways = waysFor(summary, emailAvailable, 'step_up');
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="warning" title="Confirm it’s you">
        To change how you sign in, confirm it’s you first. You can then make changes for five minutes.
      </Notice>
      {ways.length ? (
        <WaysToAnswer
          ways={ways}
          passkeyOptions={adminApi.stepUpPasskeyOptions}
          sendEmail={adminApi.stepUpEmail}
          passkeyLabel="Confirm with your passkey"
          submitLabel="Confirm"
          onAnswer={async (answer) => {
            await adminApi.stepUp(answer);
            onConfirmed();
          }}
        />
      ) : (
        <Notice tone="error">This browser can’t confirm it’s you with your passkey. Use another browser or device.</Notice>
      )}
    </div>
  );
}

/** Recovery codes, shown once. With `onDone`, the person ticks that they saved them first. */
export function RecoveryCodesShown({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="success" title={onDone ? 'Two-step verification is on' : 'New recovery codes'}>
        Save these recovery codes somewhere safe, away from your devices. Each one works once if you can’t use your other methods. They won’t be shown again.
      </Notice>
      <ul className="grid max-w-[360px] grid-cols-2 gap-2 rounded-[10px] border border-line bg-cream p-4 font-mono text-[15px] text-ink">
        {codes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="secondary" onClick={async () => setCopied(await copyText(codes.join('\n')))}>
          Copy codes
        </Button>
        <span role="status" className="font-sans text-[13px] text-muted">
          {copied ? 'Copied.' : ''}
        </span>
      </div>
      {onDone && (
        <>
          <label className="flex items-start gap-3 font-sans text-[15px] text-ink">
            <input type="checkbox" className="mt-[3px] size-[20px] accent-brand" checked={saved} onChange={(event) => setSaved(event.currentTarget.checked)} />
            I’ve saved my recovery codes
          </label>
          <div>
            <Button disabled={!saved} onClick={onDone}>
              Continue
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A new passkey: an optional name, then the device's prompt. */
export function AddPasskey({ onAdded }: { onAdded: (result: MethodResult) => void }) {
  const options = usePrefetched(adminApi.passkeyRegistrationOptions);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const create = async () => {
    if (!options.value) return;
    setBusy(true);
    setProblem(null);
    try {
      const passkey = await createPasskey(options.value);
      onAdded(await adminApi.addPasskey(passkey, nickname.trim()));
    } catch (caught) {
      setProblem(problemText(caught));
      options.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className={text}>
        Your device will ask for your fingerprint, face or PIN, then keep the passkey on this device or in your password manager. You can then sign in with
        the passkey alone, or use it after your password.
      </p>
      <Input
        label="Name (optional)"
        hint="So you can tell your passkeys apart, for example “Work laptop”."
        maxLength={60}
        value={nickname}
        onChange={(event) => setNickname(event.currentTarget.value)}
        className="max-w-[360px]"
      />
      {(problem || options.problem) && <Notice tone="error">{problem ?? options.problem}</Notice>}
      <div>
        <Button busy={busy} disabled={!options.value} onClick={() => void create()}>
          Create a passkey
        </Button>
      </div>
    </div>
  );
}

/** The authenticator app: scan, then confirm a code. */
export function AppEnrolment({ onConfirmed }: { onConfirmed: (result: MethodResult) => void }) {
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminApi.startEnrolment().then(
      (result) => live && setSetup(result),
      (caught) => live && setProblem(errorMessage(caught)),
    );
    return () => {
      live = false;
    };
  }, []);
  if (problem) return <Notice tone="error">{problem}</Notice>;
  if (!setup) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <p className={text}>1. In your authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password), add an account and scan this code.</p>
      <img src={setup.qrDataUrl} alt="QR code to add School of Purpose to your authenticator app" className="size-[200px] self-center rounded-[8px] border border-line" />
      <p className={small}>
        Can’t scan it? Enter this key instead:{' '}
        <code className="break-all rounded bg-cream px-1.5 py-0.5 font-mono text-[14px] text-ink">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </p>
      <p className={text}>2. Enter the six-digit code the app shows.</p>
      <CodeForm label="Six-digit code" numeric submitLabel="Turn on the app" onSubmit={async (code) => onConfirmed(await adminApi.confirmEnrolment(code.replace(/\s/g, '')))} />
    </div>
  );
}

/** Email codes: a first code proves the inbox works. */
export function EmailCodesEnrolment({ email, onConfirmed }: { email: string; onConfirmed: (result: MethodResult) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className={text}>
        We’ll send a code to <strong>{email}</strong> to check it reaches you. After that, a new code goes there each time you confirm it’s you.
      </p>
      <EmailCodeForm
        send={adminApi.startEmailCodes}
        sendLabel="Send the code"
        submitLabel="Turn on email codes"
        onSubmit={async (code) => onConfirmed(await adminApi.confirmEmailCodes(code.replace(/\s/g, '')))}
      />
    </div>
  );
}

/** Setting up two-step verification: the first method, then the recovery codes. */
export function SetUpFirstMethod({ session, onDone }: { session: StaffSession; onDone: () => void }) {
  const [choice, setChoice] = useState<'passkey' | 'app' | 'email' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const done = (result: MethodResult) => {
    setCsrfToken('staff', result.csrfToken); // the first method starts a new session
    if (result.recoveryCodes) setCodes(result.recoveryCodes);
    else onDone();
  };
  if (codes) return <RecoveryCodesShown codes={codes} onDone={onDone} />;

  const choices: { id: 'passkey' | 'app' | 'email'; title: string; body: string }[] = [
    ...(passkeysSupported()
      ? [
          {
            id: 'passkey' as const,
            title: 'A passkey (recommended)',
            body: 'Your fingerprint, face or device PIN. It can’t be phished, and you can then sign in with the passkey alone.',
          },
        ]
      : []),
    {
      id: 'app' as const,
      title: 'An authenticator app',
      body: 'A six-digit code from an app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password.',
    },
    ...(session.mfa.emailAvailable
      ? [
          {
            id: 'email' as const,
            title: 'Codes by email',
            body: `A six-digit code sent to ${session.staff.email} each time. The simplest, but the weakest: anyone who knows your password and can open your email could sign in.`,
          },
        ]
      : []),
  ];

  if (!choice) {
    return (
      <div className="flex flex-col gap-4">
        <p className={text}>Admin accounts need a second step as well as the password. Choose how you’ll confirm it’s you. You can add more ways later, under Your security.</p>
        <ul className="flex flex-col gap-3">
          {choices.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => setChoice(option.id)}
                className="flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border border-line bg-white px-4 py-3 text-left transition-colors hover:border-brand"
              >
                <span className="font-sans text-[15px] font-bold text-ink">{option.title}</span>
                <span className={small}>{option.body}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {choice === 'passkey' && <AddPasskey onAdded={done} />}
      {choice === 'app' && <AppEnrolment onConfirmed={done} />}
      {choice === 'email' && <EmailCodesEnrolment email={session.staff.email} onConfirmed={done} />}
      <button type="button" className={linkButton} onClick={() => setChoice(null)}>
        Choose another way
      </button>
    </div>
  );
}
