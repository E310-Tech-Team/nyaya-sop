import { useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, Input, Notice, errorMessage, type BadgeTone } from '../components/ui';
import { PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS, type ApplicationStatus } from '../shared/platform';

const REVIEW_TONE: Record<ApplicationStatus, BadgeTone> = {
  submitted: 'warning',
  under_review: 'brand',
  shortlisted: 'success',
  invited: 'success',
  not_selected: 'neutral',
  withdrawn: 'neutral',
};

export const ReviewBadge = ({ status }: { status: ApplicationStatus }) => <Badge tone={REVIEW_TONE[status]}>{REVIEW_STATUS_LABELS[status]}</Badge>;
export const PublishedBadge = ({ status }: { status: ApplicationStatus }) => <Badge>{PUBLISHED_STATUS_LABELS[status].label}</Badge>;

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-white px-4 py-3">
      <dt className="font-sans text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="font-sans text-[26px] font-bold leading-[1.1] text-ink">{value}</dd>
      {hint && <dd className="font-sans text-[12px] leading-[1.4] text-muted">{hint}</dd>}
    </div>
  );
}

/** Destructive actions need the exact value typed back (a reference or an email address). */
export function ConfirmByTyping({
  expected,
  label,
  action,
  onConfirm,
  explanation,
}: {
  expected: string;
  label: string;
  action: string;
  onConfirm: (typed: string) => Promise<unknown>;
  explanation: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await onConfirm(typed.trim());
    } catch (caught) {
      setProblem(errorMessage(caught));
      setBusy(false);
    }
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <div className="font-sans text-[14px] leading-[1.6] text-ink">{explanation}</div>
      {problem && <Notice tone="error">{problem}</Notice>}
      <Input label={label} autoComplete="off" value={typed} onChange={(event) => setTyped(event.currentTarget.value)} className="max-w-[360px]" />
      <div>
        <Button type="submit" tone="danger" busy={busy} disabled={typed.trim().toLowerCase() !== expected.toLowerCase()}>
          {action}
        </Button>
      </div>
    </form>
  );
}

/** Runs an action with busy state and a message; for small buttons in lists. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const run = async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ tone: 'success', text: success });
      return true;
    } catch (caught) {
      setMessage({ tone: 'error', text: errorMessage(caught) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const notice = message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
  return { busy, run, notice, setMessage };
}
