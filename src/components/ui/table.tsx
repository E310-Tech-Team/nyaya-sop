import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/**
 * shadcn/ui Table. With `label`, a wide table scrolls sideways inside a focusable, labelled region
 * (keyboard users can scroll it) instead of widening the page. `framed={false}` drops the border
 * for a table that already sits in a card.
 */
export function Table({ className, label, framed = true, ...props }: ComponentProps<'table'> & { label?: string; framed?: boolean }) {
  return (
    <div
      data-slot="table-container"
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      className={cn('relative w-full overflow-x-auto', framed && 'rounded-2xl border border-line/80 bg-white')}
    >
      <table data-slot="table" className={cn('w-full caption-bottom border-collapse font-sans text-[14px] text-ink', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('bg-cream', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={cn('border-t border-line bg-cream/60 font-bold', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('border-b border-line/70 transition-colors hover:bg-cream/50', className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn('h-11 border-b border-line px-4 py-2 text-left align-bottom font-sans text-[12px] font-extrabold tracking-[0.8px] text-muted uppercase', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-4 py-3 align-top', className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('mt-3 font-sans text-[13px] text-muted', className)} {...props} />;
}
