/**
 * The class lists behind the button and alert styles, in one place: the shadcn/ui primitives
 * (button.tsx, alert.tsx) build their variants from them, and basic.tsx renders the same classes
 * as plain elements for public pages, which mustn't load cva, tailwind-merge or Radix.
 */

export const buttonBase =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-sans font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4';

export const buttonVariantClasses = {
  default: 'bg-brand text-white hover:bg-brand-hover',
  outline: 'border border-line-strong bg-white text-ink hover:border-brand hover:text-brand',
  ghost: 'text-brand hover:bg-rose/40',
  destructive: 'bg-[#b3261e] text-white hover:bg-[#8c1d17]',
  link: 'text-brand underline underline-offset-4 hover:text-brand-hover',
} as const;

export const buttonSizeClasses = {
  default: 'min-h-[44px] px-5 text-[14px]',
  sm: 'min-h-9 px-4 text-[13px]',
  icon: 'size-11',
  'icon-sm': 'size-9',
  inline: 'p-0 text-[14px]',
} as const;

/** The kit's button tones, as variants. */
export const TONE_VARIANTS = { primary: 'default', secondary: 'outline', danger: 'destructive', ghost: 'ghost' } as const;
export type ButtonTone = keyof typeof TONE_VARIANTS;

export const noticeBase = 'rounded-xl border px-4 py-3 font-sans text-[14px] leading-[1.55] text-ink';

export const noticeToneClasses = {
  info: 'border-line bg-white',
  success: 'border-[#2e7d32]/40 bg-[#eef7ee]',
  warning: 'border-gold/60 bg-[#fbf5e6]',
  error: 'border-brand/50 bg-[#fbeef1]',
} as const;
export type NoticeTone = keyof typeof noticeToneClasses;
