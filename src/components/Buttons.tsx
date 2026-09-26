import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

// motion-button (index.css): 2px lift + arrow nudge on precise hover, 0.98 press, colour change.
const primaryClass =
  'motion-button group inline-flex h-[54px] min-w-0 cursor-pointer items-center justify-between gap-3 rounded-full bg-brand pl-[20px] pr-[11px] sm:gap-4 sm:pl-[22px] ' +
  'hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand';

function Arrow({ busy }: { busy?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="motion-arrow flex size-[32px] shrink-0 items-center justify-center rounded-full bg-white"
    >
      {busy ? (
        <span className="size-[14px] animate-spin rounded-full border-2 border-brand border-t-transparent" />
      ) : (
        <span className="font-sans text-[16px] font-bold text-brand">→</span>
      )}
    </span>
  );
}

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; children: ReactNode };

export function PrimaryButton({ busy, children, className = '', ...props }: PrimaryButtonProps) {
  return (
    <button {...props} aria-busy={busy || undefined} className={`${primaryClass} ${className}`}>
      <span className="whitespace-nowrap font-sans text-[14px] font-bold text-white">{children}</span>
      <Arrow busy={busy} />
    </button>
  );
}

export function PrimaryLink({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`${primaryClass} ${className}`}>
      <span className="whitespace-nowrap font-sans text-[14px] font-bold text-white">{children}</span>
      <Arrow />
    </Link>
  );
}

export function BackLink({ to, label = 'Back' }: { to: string; label?: string }) {
  return (
    <Link
      to={to}
      className="motion-button inline-flex h-[50px] shrink-0 items-center justify-center gap-[8px] rounded-full border border-line-strong bg-white px-[16px] text-brand hover:border-brand sm:w-[108px] sm:gap-[9px] sm:px-[18px]"
    >
      <span aria-hidden="true" className="motion-arrow-back motion-arrow font-sans text-[16px]">
        ←
      </span>
      <span className="font-sans text-[14px] font-bold">{label}</span>
    </Link>
  );
}
