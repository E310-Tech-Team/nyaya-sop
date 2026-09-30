import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Input, Loading, Notice, errorMessage } from '../components/ui';
import { loadAccount, markSignedIn } from '../lib/account';
import { ApiError } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { useLinkToken } from '../lib/linkToken';
import { isValidEmail } from '../shared/validation';
import { AccountFrame } from './AccountApp';
import { accountApi } from './api';

/**
 * Passwordless sign-in: we email a single-use link (valid 15 minutes). The answer is the same
 * whether or not the address has an account or an application, so nobody can use this form to
 * find out who applied.
 */
export function SignInPage() {
  const config = usePublicConfig();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const value = email.trim();
    if (!isValidEmail(value.toLowerCase())) {
      setFieldError('Enter a valid email address, like name@example.com');
      inputRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      const { message } = await accountApi.requestLink(value);
      setSent(message);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VALIDATION_FAILED') {
        setFieldError(caught.message);
        inputRef.current?.focus();
      } else if (caught instanceof ApiError && caught.code === 'RATE_LIMITED') {
        setError('Too many sign-in requests. Please wait a few minutes and try again.');
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <AccountFrame title="Sign in" nav={false}>
        <Loading />
      </AccountFrame>
    );
  }
  if (!config.accounts.enabled) {
    return (
      <AccountFrame title="Sign in" nav={false}>
        <Notice title="Accounts aren’t available yet">
          <p>
            Signing in to follow your application isn’t switched on yet. You don’t need an account to apply: keep your reference number,
            and the Programme team will contact you by email.
          </p>
        </Notice>
        <p className="font-sans text-[15px]">
          <Link to="/apply" className="font-bold text-brand underline underline-offset-4">
            Go to the application
          </Link>
        </p>
      </AccountFrame>
    );
  }

  return (
    <AccountFrame
      title="Sign in"
      nav={false}
      description="Follow your application, read messages from the Programme team and choose your notifications. Having an account is optional."
    >
      <div className="flex max-w-[560px] flex-col gap-5 rounded-[14px] border border-line bg-white p-6">
        {sent ? (
          <div className="flex flex-col gap-3">
            <Notice tone="success" title="Check your email">
              <p>{sent}</p>
            </Notice>
            <p className="font-sans text-[14px] leading-[1.6] text-muted">
              The link signs you in on the device where you open it. If nothing arrives within a few minutes, check your spam folder,
              or try again.
            </p>
            <div>
              <Button tone="secondary" onClick={() => setSent(null)}>
                Use a different email
              </Button>
            </div>
          </div>
        ) : (
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <p className="font-sans text-[15px] leading-[1.6] text-ink">
              No password needed: we’ll email you a link to sign in. To see your application, use the email address you applied with.
            </p>
            {error && <Notice tone="error">{error}</Notice>}
            <Input
              ref={inputRef}
              label="Email address"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              error={fieldError}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <div>
              <Button type="submit" busy={busy}>
                Email me a sign-in link
              </Button>
            </div>
          </form>
        )}
      </div>
    </AccountFrame>
  );
}

/**
 * The emailed link opens this page. Signing in needs a button press, so email security scanners
 * that open links don't use up the single-use link.
 */
export function VerifyPage() {
  const token = useLinkToken();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setProblem(null);
    try {
      const result = await accountApi.verify(token);
      markSignedIn({ email: result.account.email, createdAt: '' }, result.csrfToken);
      void loadAccount(); // fills in the account details
      navigate('/account', { replace: true });
    } catch (caught) {
      setProblem(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <AccountFrame title="Finish signing in" nav={false}>
      <div className="flex max-w-[560px] flex-col gap-4 rounded-[14px] border border-line bg-white p-6">
        {!token ? (
          <Notice tone="error" title="This link is incomplete">
            Copy the whole link from the email, or ask for a new one.
          </Notice>
        ) : (
          <>
            <p className="font-sans text-[15px] leading-[1.6] text-ink">Press the button to sign in on this device.</p>
            {problem && <Notice tone="error">{problem}</Notice>}
            <div>
              <Button busy={busy} onClick={() => void signIn()}>
                Sign in
              </Button>
            </div>
          </>
        )}
        <p className="font-sans text-[14px] text-muted">
          Link not working?{' '}
          <Link to="/account/sign-in" className="font-bold text-brand underline underline-offset-4">
            Get a new sign-in link
          </Link>
        </p>
      </div>
    </AccountFrame>
  );
}
