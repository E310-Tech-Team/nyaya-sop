import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** Status badges (docs/04 §10). Always words, never colour alone. */
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 font-sans text-[12px] leading-[1.5] font-bold whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-cream text-ink',
        brand: 'border-rose bg-rose/60 text-brand-deep',
        success: 'border-[#b9dcbb] bg-[#e6f4e7] text-[#1e5b22]',
        warning: 'border-[#ecd49a] bg-[#fbf1d9] text-[#6b4f0a]',
        danger: 'border-[#f2bab4] bg-[#fbe4e2] text-[#8c1d17]',
        outline: 'border-line-strong bg-white text-ink',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
