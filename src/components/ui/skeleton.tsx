import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** A placeholder shaped like the content on its way. Hidden from assistive technology: announce loading with a status message. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('rounded-lg bg-line/45 motion-safe:animate-pulse', className)} {...props} />;
}
