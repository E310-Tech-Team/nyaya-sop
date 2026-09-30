import type { ComponentProps, HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** A solid surface with a hairline border and a soft shadow. `as` gives it a landmark or list role where it needs one. */
export function Card({ as: Tag = 'div', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' | 'li' }) {
  return (
    <Tag
      data-slot="card"
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-2xl border border-line/80 bg-white py-5 text-ink shadow-[0_1px_2px_rgba(45,9,20,0.05),0_10px_28px_-14px_rgba(45,9,20,0.16)] sm:py-6',
        className,
      )}
      {...props}
    />
  );
}

/** Title and description, with an optional CardAction beside them (below them on phones). */
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('grid auto-rows-min items-start gap-1 px-5 sm:px-6 sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] sm:has-data-[slot=card-action]:gap-x-4', className)}
      {...props}
    />
  );
}

/** The card's heading: an h3 unless `as` says otherwise (keep the page's heading order). */
export function CardTitle({ as: Heading = 'h3', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'h2' | 'h3' | 'h4' | 'p' }) {
  return <Heading data-slot="card-title" className={cn('font-sans text-[17px] leading-[1.3] font-bold text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('font-sans text-[14px] leading-[1.5] text-muted', className)} {...props} />;
}

export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('mt-2 self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5 sm:px-6', className)} {...props} />;
}

/** Actions, pushed to the bottom so cards in a row line theirs up. */
export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('mt-auto flex flex-wrap items-center gap-2 px-5 pt-1 sm:px-6', className)} {...props} />;
}
