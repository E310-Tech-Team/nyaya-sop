/**
 * shadcn/ui primitives for the account and admin areas, adapted to the brand tokens in
 * src/index.css (burgundy `brand`, `cream`, `gold`, `ink`, `muted`, `line`): no theme variables,
 * no global base styles. Keyboard focus keeps the site-wide outline from index.css.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { buttonBase, buttonSizeClasses, buttonVariantClasses } from './styles';

export const buttonVariants = cva(buttonBase, {
  variants: { variant: buttonVariantClasses, size: buttonSizeClasses },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

/** A button (type="button" unless given), or with `asChild` its child (a link) styled as one. */
export function Button({ className, variant, size, asChild = false, type, ...props }: ComponentProps<'button'> & ButtonVariantProps & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" type={asChild ? type : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
