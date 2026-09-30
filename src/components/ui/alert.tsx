import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { noticeBase, noticeToneClasses } from './styles';

const alertVariants = cva(
  `${noticeBase} grid w-full grid-cols-[0_minmax(0,1fr)] items-start gap-y-0.5 has-[>svg]:grid-cols-[1.25rem_minmax(0,1fr)] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-px`,
  {
    variants: {
      variant: {
        info: `${noticeToneClasses.info} [&>svg]:text-muted`,
        success: `${noticeToneClasses.success} [&>svg]:text-[#1e5b22]`,
        warning: `${noticeToneClasses.warning} [&>svg]:text-[#6b4f0a]`,
        error: `${noticeToneClasses.error} [&>svg]:text-brand`,
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

/** Errors are announced at once (role="alert"); other messages politely (role="status"). An icon, if any, goes first. */
export function Alert({ className, variant, role, ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={role ?? (variant === 'error' ? 'alert' : 'status')} className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('col-start-2 font-bold', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('col-start-2 flex flex-col gap-2', className)} {...props} />;
}
