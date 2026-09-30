import { ChevronRightIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** shadcn/ui Breadcrumb: where the page sits, each level a link back; the current one has aria-current="page". */
export function Breadcrumb({ 'aria-label': label = 'Breadcrumb', ...props }: ComponentProps<'nav'>) {
  return <nav data-slot="breadcrumb" aria-label={label} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return <ol data-slot="breadcrumb-list" className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 font-sans text-[14px] break-words text-muted', className)} {...props} />;
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="breadcrumb-item" className={cn('inline-flex items-center gap-1.5', className)} {...props} />;
}

export function BreadcrumbLink({ asChild, className, ...props }: ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'a';
  return <Comp data-slot="breadcrumb-link" className={cn('font-semibold text-brand underline-offset-4 hover:underline', className)} {...props} />;
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="breadcrumb-page" aria-current="page" className={cn('rounded-[4px] font-bold text-ink', className)} {...props} />;
}

export function BreadcrumbSeparator({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn('text-muted [&>svg]:size-3.5', className)} {...props}>
      <ChevronRightIcon />
    </li>
  );
}
