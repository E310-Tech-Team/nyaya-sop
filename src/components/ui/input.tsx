import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** The field look every control shares: 44px tall, a ≥3:1 border, a burgundy focus ring (no outline). */
export const fieldClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-white px-3 py-2 font-sans text-[15px] text-ink outline-none placeholder:text-muted focus:border-brand focus:shadow-[0_0_0_3px_rgba(132,29,38,0.22)] disabled:cursor-not-allowed disabled:bg-cream disabled:text-muted aria-invalid:border-brand';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldClass, className)} {...props} />;
}
