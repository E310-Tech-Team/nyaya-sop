import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/**
 * shadcn/ui Sheet (a Radix Dialog at the screen's edge) for focused secondary tasks: modal, focus
 * kept inside, Escape closes, focus returns to the trigger. It needs a SheetTitle (and a
 * SheetDescription or aria-describedby={undefined}).
 */
export function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetContent({ className, children, side = 'right', ...props }: ComponentProps<typeof DialogPrimitive.Content> & { side?: 'right' | 'bottom' }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-ink/45" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col bg-paper text-ink shadow-[0_0_48px_rgba(45,9,20,0.25)] outline-none',
          side === 'right' && 'inset-y-0 right-0 h-full w-full border-l border-line sm:max-w-md',
          side === 'bottom' && 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t border-line',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-cream">
          <XIcon aria-hidden="true" className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1 border-b border-line/80 px-5 pt-5 pr-16 pb-4', className)} {...props} />;
}

export function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-body" className={cn('flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-footer" className={cn('flex flex-wrap items-center justify-between gap-2 border-t border-line/80 bg-white px-5 py-4', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn('font-sans text-[18px] font-bold text-ink', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="sheet-description" className={cn('font-sans text-[14px] leading-[1.5] text-muted', className)} {...props} />;
}
