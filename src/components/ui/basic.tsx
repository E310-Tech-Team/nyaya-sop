/**
 * The kit's basics that public pages use too (the app shell's Suspense fallback, /updates, the
 * notification settings and prompt): buttons, a checkbox, notices, loading and error states, and
 * staff-facing times. Plain elements with the same classes as the shadcn/ui primitives
 * (styles.ts), so public bundles never load cva, tailwind-merge or Radix. Account and admin code
 * gets these through the kit (./index).
 */
import { useId, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { DEFAULT_TIME_ZONE, formatInZone } from '../../shared/time';
import { buttonBase, buttonSizeClasses, buttonVariantClasses, noticeBase, noticeToneClasses, TONE_VARIANTS, type ButtonTone, type NoticeTone } from './styles';

export type { ButtonTone, NoticeTone } from './styles';

/** The classes of a kit button: shared with the Button primitive. */
export const buttonClasses = (tone: ButtonTone = 'primary', className = '') => `${buttonBase} ${buttonVariantClasses[TONE_VARIANTS[tone]]} ${buttonSizeClasses.default} ${className}`;

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
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={buttonClasses(tone, className)} {...props}>
      {busy && <span aria-hidden="true" className="size-[14px] animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Checkbox({ label, hint, className = '', id: explicit, ...input }: { label: ReactNode; hint?: ReactNode; className?: string } & ComponentProps<'input'>) {
  const generated = useId();
  const id = explicit ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
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

/** Errors are announced at once (role="alert"); other notices politely (role="status"). */
export function Notice({ tone = 'info', title, children, className = '' }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`${noticeBase} ${noticeToneClasses[tone]} ${className}`}>
      {title && <p className="font-bold">{title}</p>}
      {children}
    </div>
  );
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

/** Every time shown to staff names its zone (default Africa/Lagos, WAT). */
export const when = (iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE) => (iso ? formatInZone(iso, timeZone) : '—');
