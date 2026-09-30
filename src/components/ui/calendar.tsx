import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, type ComponentProps } from 'react';
import { DayButton, DayPicker, getDefaultClassNames } from 'react-day-picker';
import { cn } from '../../lib/utils';
import { buttonVariants } from './button';

/**
 * shadcn/ui Calendar (react-day-picker): a keyboard-operable grid of days (arrow keys, Page Up/Down
 * for months, Home/End). Callers pass calendar days as noon Dates built from Y-M-D parts and pass
 * `today`, so the browser's own time zone never moves a day (see src/admin/reports/period.ts).
 */
export function Calendar({ className, classNames, showOutsideDays = true, components, ...props }: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('w-fit font-sans text-ink [--cell-size:2.5rem]', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('relative flex flex-col gap-4 md:flex-row', defaults.months),
        month: cn('flex w-full flex-col gap-3', defaults.month),
        nav: cn('absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1', defaults.nav),
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'size-(--cell-size) text-ink aria-disabled:opacity-40', defaults.button_previous),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'size-(--cell-size) text-ink aria-disabled:opacity-40', defaults.button_next),
        month_caption: cn('flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)', defaults.month_caption),
        caption_label: cn('text-[15px] font-bold select-none', defaults.caption_label),
        month_grid: 'w-full border-collapse',
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn('flex-1 text-[12px] font-semibold text-muted select-none', defaults.weekday),
        week: cn('mt-1 flex w-full', defaults.week),
        day: cn(
          'group/day relative aspect-square h-full w-full p-0 text-center select-none [&:first-child[data-selected=true]_button]:rounded-l-full [&:last-child[data-selected=true]_button]:rounded-r-full',
          defaults.day,
        ),
        range_start: cn('rounded-l-full bg-rose/50', defaults.range_start),
        range_middle: cn('rounded-none', defaults.range_middle),
        range_end: cn('rounded-r-full bg-rose/50', defaults.range_end),
        today: cn('rounded-full font-bold text-brand data-[selected=true]:rounded-none', defaults.today),
        outside: cn('text-muted', defaults.outside),
        disabled: cn('text-muted opacity-50', defaults.disabled),
        hidden: cn('invisible', defaults.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className: rootClass, rootRef, ...rest }) => <div data-slot="calendar" ref={rootRef} className={cn(rootClass)} {...rest} />,
        Chevron: ({ className: chevronClass, orientation }) =>
          orientation === 'left' ? (
            <ChevronLeftIcon aria-hidden="true" className={cn('size-4', chevronClass)} />
          ) : (
            <ChevronRightIcon aria-hidden="true" className={cn('size-4', chevronClass)} />
          ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({ className, day, modifiers, ...props }: ComponentProps<typeof DayButton>) {
  const defaults = getDefaultClassNames();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  const single = modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle;
  return (
    <button
      ref={ref}
      type="button"
      data-selected-single={single || undefined}
      data-range-start={modifiers.range_start || undefined}
      data-range-end={modifiers.range_end || undefined}
      data-range-middle={modifiers.range_middle || undefined}
      className={cn(
        'flex aspect-square w-full min-w-(--cell-size) cursor-pointer items-center justify-center rounded-full text-[14px] leading-none tabular-nums outline-offset-0 hover:bg-cream disabled:cursor-not-allowed disabled:hover:bg-transparent',
        'data-[range-middle]:rounded-none data-[range-middle]:bg-rose/50 data-[range-middle]:text-ink',
        'data-[selected-single]:bg-brand data-[selected-single]:font-bold data-[selected-single]:text-white data-[range-start]:bg-brand data-[range-start]:font-bold data-[range-start]:text-white data-[range-end]:bg-brand data-[range-end]:font-bold data-[range-end]:text-white',
        defaults.day_button,
        className,
      )}
      {...props}
    />
  );
}
