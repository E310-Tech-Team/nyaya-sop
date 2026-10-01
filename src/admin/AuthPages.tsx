import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { BrandLockup } from '../components/BrandLockup';
import { Button, Input, Loading, Notice, errorMessage } from '../components/ui';
import { usePageTitle } from '../components/RouteEffects';
import { ApiError, setCsrfToken } from '../lib/api';
import { useLinkToken } from '../lib/linkToken';
import { adminApi, type SecondStepAnswer } from './api';
import { PasskeyButton, SecondStep, SetUpFirstMethod, WaysToAnswer, type Way } from './mfa';
import { passkeysSupported } from './passkeys';
import { loadStaffSession, useStaff } from './session';

const PASSWORD_HINT = 'At least 12 characters. A few unrelated words make a strong, memorable password.';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(`${title} · Admin`);
  return (
    <main id="main" className="flex min-h-screen w-full items-start justify-center bg-cream px-5 py-10 sm:items-center">
      <div className="flex w-full max-w-[460px] flex-col gap-5 rounded-[16px] border border-line bg-white p-6 shadow-[0px_12px_30px_0px_rgba(45,9,20,0.07)] sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandLockup on="light" className="h-[44px]" />
          <span className="rounded-full bg-rose px-3 py-1 font-sans text-[11px] font-bold uppercase tracking-[1.2px] text-brand">Admin</span>
        </div>
        <h1 data-page-heading tabIndex={-1} className="font-display text-[32px] leading-[1.05] text-ink outline-none">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

/** Signing in with a passkey alone (06 D-58): it checks the fingerprint, face or PIN itself. */
function PasskeySignIn() {
  const signIn = async (passkey: unknown) => {
    setCsrfToken('staff', (await adminApi.passkeySignIn(passkey)).csrfToken);
    await loadStaffSession();
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <p className="font-sans text-[14px] leading-[1.5] text-muted">Added a passkey to your account? You can sign in with it alone.</p>
      <PasskeyButton label="Sign in with a passkey" tone="secondary" loadOptions={adminApi.passkeySignInOptions} onAnswer={signIn} />
    </div>
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
        <SecondStep session={staff.session} />
      </Shell>
    );
  }
  if (staff.step === 'mfa-setup') {
    return (
      <Shell title="Set up two-step verification">
        <SetUpFirstMethod session={staff.session} onDone={() => void loadStaffSession()} />
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
      {passkeysSupported() && <PasskeySignIn />}
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
  const token = useLinkToken();
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
          <p className="font-sans text-[15px] leading-[1.6] text-ink">
            We’ll email you a single-use link. You’ll also need your passkey, your authenticator app or a recovery code.
          </p>
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

/**
 * /admin/reset?token=…: a new password, confirmed with a passkey, an app code or a recovery code
 * (never an email code: the link came by email). The page can't see the account, so it offers a
 * passkey only if the link's account has one.
 */
export function ResetPasswordPage() {
  const token = useLinkToken();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hasPasskey, setHasPasskey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const passwordReady = password.length >= 12 && password === confirm;

  const passkeyOptions = useCallback(async () => {
    try {
      return await adminApi.resetPasskeyOptions(token);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'NO_PASSKEY') setHasPasskey(false);
      throw caught;
    }
  }, [token]);

  const reset = async (answer: SecondStepAnswer) => {
    await adminApi.resetPassword({ token, password, ...answer });
    setDone(true);
  };
  const withoutSecondStep = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await reset({});
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const ways: Way[] = hasPasskey && passkeysSupported() ? ['passkey', 'app', 'recovery'] : ['app', 'recovery'];

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
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <PasswordPair password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
          </div>
          <section aria-labelledby="reset-confirm" className="flex flex-col gap-3 border-t border-line pt-4">
            <h2 id="reset-confirm" className="font-sans text-[17px] font-bold text-ink">
              Confirm it’s you
            </h2>
            <p className="font-sans text-[13px] leading-[1.5] text-muted">
              {passwordReady ? 'With your passkey, a code from your authenticator app or a recovery code.' : 'Choose your new password first.'} A code sent by
              email can’t confirm a reset: the link came by email too.
            </p>
            <WaysToAnswer
              ways={ways}
              passkeyOptions={passkeyOptions}
              disabled={!passwordReady}
              passkeyLabel="Change password with your passkey"
              submitLabel="Change password"
              onAnswer={reset}
            />
            {problem && <Notice tone="error">{problem}</Notice>}
            <button
              type="button"
              disabled={!passwordReady || busy}
              onClick={() => void withoutSecondStep()}
              className="min-h-[40px] cursor-pointer self-start font-sans text-[13px] font-bold text-muted underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
            >
              My account doesn’t have two-step verification yet
            </button>
          </section>
        </div>
      )}
    </Shell>
  );
}
