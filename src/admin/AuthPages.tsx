import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { Button, Input, Loading, Notice, errorMessage } from '../components/ui';
import { usePageTitle } from '../components/RouteEffects';
import { ApiError, setCsrfToken } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { adminApi } from './api';
import { loadStaffSession, useStaff } from './session';

const PASSWORD_HINT = 'At least 12 characters. A few unrelated words make a strong, memorable password.';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(`${title} · Admin`);
  return (
    <main id="main" className="flex min-h-screen w-full items-start justify-center bg-cream px-5 py-10 sm:items-center">
      <div className="flex w-full max-w-[460px] flex-col gap-5 rounded-[16px] border border-line bg-white p-6 shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-[36px] items-center justify-center rounded-full bg-brand font-sans text-[11px] font-black text-white">SOP</span>
          <span className="font-sans text-[12px] font-black tracking-[0.4px] text-brand">SCHOOL OF PURPOSE · ADMIN</span>
        </div>
        <h1 data-page-heading tabIndex={-1} className="font-display text-[32px] leading-[1.05] text-ink outline-none">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

/** Two-step verification setup: scan, confirm a code, then save the recovery codes (shown once). */
export function MfaEnrolment({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setSetup(await adminApi.startEnrolment());
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      setCodes((await adminApi.confirmEnrolment(code.replace(/\s/g, ''))).recoveryCodes);
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success" title="Two-step verification is on">
          Save these recovery codes somewhere safe, away from your phone. Each one works once if you lose access to your authenticator
          app. They won’t be shown again.
        </Notice>
        <ul className="grid grid-cols-2 gap-2 rounded-[10px] border border-line bg-cream p-4 font-mono text-[15px] text-ink">
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
        <label className="flex items-start gap-3 font-sans text-[15px] text-ink">
          <input type="checkbox" className="mt-[3px] size-[20px] accent-brand" checked={saved} onChange={(event) => setSaved(event.currentTarget.checked)} />
          I’ve saved my recovery codes
        </label>
        <div>
          <Button disabled={!saved} onClick={onDone}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-sans text-[15px] leading-[1.6] text-ink">
          Admin accounts use a second step: a six-digit code from an authenticator app on your phone (for example Google Authenticator,
          Microsoft Authenticator or 1Password), as well as your password.
        </p>
        {problem && <Notice tone="error">{problem}</Notice>}
        <div>
          <Button busy={busy} onClick={() => void start()}>
            Set up two-step verification
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={confirm} className="flex flex-col gap-4">
      <p className="font-sans text-[15px] leading-[1.6] text-ink">1. In your authenticator app, add an account and scan this code.</p>
      <img src={setup.qrDataUrl} alt="QR code to add School of Purpose to your authenticator app" className="size-[200px] self-center rounded-[8px] border border-line" />
      <p className="font-sans text-[14px] leading-[1.6] text-muted">
        Can’t scan it? Enter this key instead:{' '}
        <code className="break-all rounded bg-cream px-1.5 py-0.5 font-mono text-[14px] text-ink">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </p>
      <p className="font-sans text-[15px] leading-[1.6] text-ink">2. Enter the six-digit code the app shows.</p>
      {problem && <Notice tone="error">{problem}</Notice>}
      <Input
        label="Six-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(event) => setCode(event.currentTarget.value)}
        className="max-w-[220px]"
      />
      <div>
        <Button type="submit" busy={busy} disabled={code.replace(/\s/g, '').length !== 6}>
          Turn on two-step verification
        </Button>
      </div>
    </form>
  );
}

function MfaStep() {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await adminApi.verifyMfa(useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\s/g, '') });
      await loadStaffSession();
    } catch (caught) {
      setProblem(errorMessage(caught));
      setBusy(false);
      // Too many wrong codes ends the session: go back to the password step.
      if (caught instanceof ApiError && caught.status === 401 && /sign in again/i.test(caught.message)) await loadStaffSession();
    }
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <p className="font-sans text-[15px] leading-[1.6] text-ink">
        {useRecovery ? 'Enter one of your recovery codes. Each code works once.' : 'Enter the six-digit code from your authenticator app.'}
      </p>
      {problem && <Notice tone="error">{problem}</Notice>}
      <Input
        key={useRecovery ? 'recovery' : 'code'}
        label={useRecovery ? 'Recovery code' : 'Six-digit code'}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        className="max-w-[260px]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy} disabled={!value.trim()}>
          Continue
        </Button>
        <button
          type="button"
          className="min-h-[40px] cursor-pointer font-sans text-[14px] font-bold text-brand underline underline-offset-4"
          onClick={() => {
            setUseRecovery((current) => !current);
            setValue('');
            setProblem(null);
          }}
        >
          {useRecovery ? 'Use my authenticator app' : 'Use a recovery code'}
        </button>
      </div>
      <p className="font-sans text-[13px] leading-[1.5] text-muted">Lost your phone and your recovery codes? Ask an owner to reset your two-step verification.</p>
    </form>
  );
}

export function LoginPage() {
  const staff = useStaff();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from && from.startsWith('/admin') && !from.startsWith('/admin/login') ? from : '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (staff.step === 'signed-in') return <Navigate to={destination} replace />;
  if (staff.step === 'mfa') {
    return (
      <Shell title="Two-step verification">
        <MfaStep />
      </Shell>
    );
  }
  if (staff.step === 'mfa-setup') {
    return (
      <Shell title="Set up two-step verification">
        <MfaEnrolment onDone={() => void loadStaffSession()} />
      </Shell>
    );
  }
  if (staff.step === 'unknown' || staff.step === 'loading') {
    return (
      <Shell title="Sign in">
        <Loading />
      </Shell>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const result = await adminApi.login(email.trim(), password);
      setCsrfToken('staff', result.csrfToken);
      setPassword('');
      await loadStaffSession();
    } catch (caught) {
      setProblem(caught instanceof ApiError && caught.code === 'RATE_LIMITED' ? 'Too many attempts. Please wait a few minutes and try again.' : errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Shell title="Sign in">
      {staff.step === 'signed-out' && staff.reason === 'expired' && <Notice tone="warning">Your session ended. Please sign in again.</Notice>}
      {staff.step === 'error' && <Notice tone="error">We couldn’t reach the server. Check your connection and try again.</Notice>}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Notice tone="error">{problem}</Notice>}
        <Input label="Email address" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" busy={busy} disabled={!email.trim() || !password}>
            Sign in
          </Button>
          <Link to="/admin/forgot" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">
            Forgotten your password?
          </Link>
        </div>
      </form>
    </Shell>
  );
}

function PasswordPair({ password, setPassword, confirm, setConfirm }: { password: string; setPassword: (value: string) => void; confirm: string; setConfirm: (value: string) => void }) {
  const mismatch = confirm.length > 0 && confirm !== password ? 'The passwords don’t match.' : undefined;
  return (
    <>
      <Input label="New password" type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
      <Input label="Type it again" type="password" autoComplete="new-password" error={mismatch} value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} />
    </>
  );
}

/** /admin/setup?token=…: accept an invitation (choose a password, then two-step verification). */
export function InviteSetupPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [invite, setInvite] = useState<{ email: string; displayName: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid('This invitation link is incomplete. Copy the whole link from the email.');
      return;
    }
    adminApi.checkInvite(token).then(setInvite, (caught) => setInvalid(errorMessage(caught)));
  }, [token]);

  if (done) return <Navigate to="/admin/login" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const result = await adminApi.completeInvite(token, password);
      setCsrfToken('staff', result.csrfToken);
      await loadStaffSession();
      setDone(true);
    } catch (caught) {
      setProblem(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Shell title="Set up your admin account">
      {invalid ? (
        <Notice tone="error">{invalid}</Notice>
      ) : !invite ? (
        <Loading />
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <p className="font-sans text-[15px] leading-[1.6] text-ink">
            Welcome, {invite.displayName}. Choose a password for <strong>{invite.email}</strong>. Next you’ll set up two-step verification.
          </p>
          {problem && <Notice tone="error">{problem}</Notice>}
          <PasswordPair password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
          <div>
            <Button type="submit" busy={busy} disabled={password.length < 12 || password !== confirm}>
              Create my account
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      setMessage((await adminApi.forgotPassword(email.trim())).message);
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Reset your password">
      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <p className="font-sans text-[15px] leading-[1.6] text-ink">We’ll email you a single-use link. You’ll also need your two-step verification code.</p>
          {problem && <Notice tone="error">{problem}</Notice>}
          <Input label="Email address" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
          <div>
            <Button type="submit" busy={busy} disabled={!email.trim()}>
              Email me a reset link
            </Button>
          </div>
        </form>
      )}
      <Link to="/admin/login" className="font-sans text-[14px] font-bold text-brand underline underline-offset-4">
        Back to sign in
      </Link>
    </Shell>
  );
}

/** /admin/reset?token=…: a new password, confirmed with a current second-factor code. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await adminApi.resetPassword({ token, password, ...(useRecovery ? { recoveryCode: code.trim() } : { code: code.replace(/\s/g, '') }) });
      setDone(true);
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Choose a new password">
      {done ? (
        <Notice tone="success" title="Password changed">
          You’ve been signed out everywhere.{' '}
          <Link to="/admin/login" className="font-bold text-brand underline underline-offset-4">
            Sign in
          </Link>{' '}
          with your new password.
        </Notice>
      ) : !token ? (
        <Notice tone="error">This reset link is incomplete. Copy the whole link from the email.</Notice>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {problem && <Notice tone="error">{problem}</Notice>}
          <PasswordPair password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
          <Input
            label={useRecovery ? 'Recovery code' : 'Six-digit code from your authenticator app'}
            hint="Needed if two-step verification is on for your account."
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
          />
          <button type="button" className="self-start font-sans text-[14px] font-bold text-brand underline underline-offset-4" onClick={() => setUseRecovery((value) => !value)}>
            {useRecovery ? 'Use my authenticator app' : 'Use a recovery code'}
          </button>
          <div>
            <Button type="submit" busy={busy} disabled={password.length < 12 || password !== confirm}>
              Change password
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}
