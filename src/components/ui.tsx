/**
 * Building blocks for the account and admin areas (the application form keeps its own numbered
 * question style in Fields.tsx). Native controls with visible labels; hints and errors are
 * wired to their control with aria-describedby, errors also with aria-invalid.
 */
import { useId, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../lib/api';
import { DEFAULT_TIME_ZONE, formatInZone } from '../shared/time';
import { usePageTitle } from './RouteEffects';

// ── Form controls ─────────────────────────────────────────────────────────────

type Shell = { label: ReactNode; hint?: ReactNode; error?: string; className?: string };

const control = (invalid: boolean) =>
  `w-full rounded-[8px] border bg-white px-3 font-sans text-[15px] text-ink outline-none placeholder:text-muted ` +
  `focus:border-brand focus:shadow-[0_0_0_3px_rgba(139,30,63,0.22)] disabled:bg-cream disabled:text-muted ` +
  (invalid ? 'border-brand' : 'border-line-strong');

function useFieldIds(explicit: string | undefined, hint: unknown, error: unknown) {
  const generated = useId();
  const id = explicit ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { id, hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="font-sans text-[14px] font-semibold text-ink">
      {children}
    </label>
  );
}

export function ErrorLine({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="font-sans text-[13px] font-semibold leading-[1.4] text-brand">
      {message}
    </p>
  );
}

export function Input({ label, hint, error, className = '', id: explicit, ...input }: Shell & ComponentProps<'input'>) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicit, hint, error);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={`${control(Boolean(error))} min-h-[44px] py-2`} {...input} />
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}

export function TextArea({ label, hint, error, className = '', id: explicit, ...input }: Shell & ComponentProps<'textarea'>) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicit, hint, error);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={`${control(Boolean(error))} min-h-[110px] py-2 leading-[1.5]`} {...input} />
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  className = '',
  id: explicit,
  options,
  ...select
}: Shell & ComponentProps<'select'> & { options: readonly { value: string; label: string }[] }) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicit, hint, error);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={`${control(Boolean(error))} min-h-[44px] py-2`} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}

export function Checkbox({ label, hint, className = '', id: explicit, ...input }: Omit<Shell, 'error'> & ComponentProps<'input'>) {
  const { id, hintId } = useFieldIds(explicit, hint, undefined);
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <input id={id} type="checkbox" aria-describedby={hintId} className="mt-[3px] size-[20px] shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed" {...input} />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-sans text-[15px] font-semibold text-ink">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

const TONES = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'border border-line-strong bg-white text-ink hover:border-brand hover:text-brand',
  danger: 'bg-[#b3261e] text-white hover:bg-[#8c1d17]',
  ghost: 'text-brand hover:bg-rose/40',
} as const;

export type ButtonTone = keyof typeof TONES;

export function Button({
  tone = 'primary',
  busy = false,
  className = '',
  type = 'button',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; busy?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full px-5 font-sans text-[14px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${TONES[tone]} ${className}`}
      {...props}
    >
      {busy && <span aria-hidden="true" className="size-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, tone = 'secondary', children, className = '' }: { to: string; tone?: ButtonTone; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-5 font-sans text-[14px] font-bold transition-colors ${TONES[tone]} ${className}`}>
      {children}
    </Link>
  );
}

// ── Layout and feedback ───────────────────────────────────────────────────────

/** The screen's single <h1> (focused after navigation by RouteEffects) and the document title. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  documentTitle,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  documentTitle?: string;
}) {
  usePageTitle(documentTitle ?? title);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <p className="font-sans text-[11px] font-extrabold uppercase tracking-[2px] text-brand">{eyebrow}</p>}
        <h1 data-page-heading tabIndex={-1} className="font-display text-[32px] leading-[1.05] text-ink outline-none sm:text-[40px]">
          {title}
        </h1>
        {description && <div className="max-w-[720px] font-sans text-[15px] leading-[1.55] text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`flex flex-col gap-4 rounded-[14px] border border-line bg-white p-5 shadow-[0px_8px_24px_0px_rgba(45,9,20,0.05)] sm:p-6 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title && <Heading className="font-sans text-[18px] font-bold leading-[1.3] text-ink">{title}</Heading>}
            {description && <div className="font-sans text-[14px] leading-[1.5] text-muted">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const NOTICE_TONES = {
  info: 'border-line bg-white',
  success: 'border-[#2e7d32]/40 bg-[#eef7ee]',
  warning: 'border-[#b8962e]/60 bg-[#fbf5e6]',
  error: 'border-brand/50 bg-[#fbeef1]',
} as const;

/** Errors are announced at once (role="alert"); other notices politely (role="status"). */
export function Notice({ tone = 'info', title, children, className = '' }: { tone?: keyof typeof NOTICE_TONES; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[12px] border px-4 py-3 font-sans text-[14px] leading-[1.55] text-ink ${NOTICE_TONES[tone]} ${className}`}>
      {title && <p className="font-bold">{title}</p>}
      {children}
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'bg-cream text-ink border-line',
  brand: 'bg-rose/60 text-brand-deep border-rose',
  success: 'bg-[#e6f4e7] text-[#1e5b22] border-[#b9dcbb]',
  warning: 'bg-[#fbf1d9] text-[#6b4f0a] border-[#ecd49a]',
  danger: 'bg-[#fbe4e2] text-[#8c1d17] border-[#f2bab4]',
} as const;
export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-sans text-[12px] font-bold ${BADGE_TONES[tone]}`}>{children}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 font-sans text-[14px] text-muted">
      <span aria-hidden="true" className="size-[16px] animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {label}
    </p>
  );
}

export const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT'
      ? 'We couldn’t reach the server. Check your connection and try again.'
      : error.message
    : 'Something went wrong. Please try again.';

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice tone="error" title="This couldn’t be loaded.">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button tone="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Notice>
  );
}

/** Wide tables scroll sideways inside a focusable, labelled region instead of widening the page. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="w-full overflow-x-auto rounded-[12px] border border-line bg-white">
      {children}
    </div>
  );
}

export const th = 'whitespace-nowrap border-b border-line bg-cream px-4 py-2.5 text-left font-sans text-[12px] font-extrabold uppercase tracking-[0.8px] text-muted';
export const td = 'border-b border-line/70 px-4 py-3 align-top font-sans text-[14px] text-ink';

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 font-sans text-[14px] text-muted">
      <p>
        {total ? `Showing ${from}–${to} of ${total}` : 'Nothing to show'}
      </p>
      <div className="flex gap-2">
        <Button tone="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button tone="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Every time shown to staff names its zone (default Africa/Lagos, WAT). */
export const when = (iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE) => (iso ? formatInZone(iso, timeZone) : '—');
