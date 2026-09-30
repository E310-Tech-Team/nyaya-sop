import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** A segmented bar. Shared with links that switch pages (aria-current), which must stay links, not tabs. */
export const tabsListClass = 'inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-full border border-line/80 bg-cream p-1';
export const tabsTriggerClass =
  'inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-center font-sans text-[14px] font-semibold whitespace-nowrap text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:bg-white data-[state=active]:text-brand data-[state=active]:shadow-[0_1px_3px_rgba(45,9,20,0.14)] aria-[current=page]:bg-white aria-[current=page]:text-brand aria-[current=page]:shadow-[0_1px_3px_rgba(45,9,20,0.14)] [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * shadcn/ui Tabs (Radix): related views of the same content. Arrow keys move between tabs; with
 * activationMode="manual" Enter or Space shows one, for views that load data.
 */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn(tabsListClass, className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn(tabsTriggerClass, className)} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex min-w-0 flex-col gap-4 outline-offset-4', className)} {...props} />;
}
