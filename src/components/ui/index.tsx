/**
 * The account and admin kit (the application form keeps its own numbered question style in
 * Fields.tsx), built on the shadcn/ui primitives beside this file. Native controls with visible
 * labels; hints and errors are wired to their control with aria-describedby, errors also with
 * aria-invalid. The basics public pages also use live in ./basic (plain elements, same classes),
 * which public code imports directly so its bundle stays free of cva, tailwind-merge and Radix.
 */
import { useId, type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import { usePageTitle } from '../RouteEffects';
import { Badge as BadgePrimitive, type BadgeVariant } from './badge';
import { Button } from './basic';
import { Button as ButtonPrimitive } from './button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from './card';
import { fieldClass } from './input';
import { TONE_VARIANTS, type ButtonTone } from './styles';

export { Button, buttonClasses, Checkbox, errorMessage, LoadError, Loading, Notice, when, type ButtonTone, type NoticeTone } from './basic';

// ── Form controls ─────────────────────────────────────────────────────────────

type Shell = { label: ReactNode; hint?: ReactNode; error?: string; className?: string };

function useFieldIds(explicit: string | undefined, hint: unknown, error: unknown) {
  const generated = useId();
  const id = explicit ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { id, hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="font-sans text-[14px] font-semibold text-ink">
      {children}
    </label>
  );
}

export function ErrorLine({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="font-sans text-[13px] font-semibold leading-[1.4] text-brand">
      {message}
    </p>
  );
}

export function Input({ label, hint, error, className = '', id: explicit, ...input }: Shell & ComponentProps<'input'>) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicit, hint, error);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={fieldClass} {...input} />
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}

export function TextArea({ label, hint, error, className = '', id: explicit, ...input }: Shell & ComponentProps<'textarea'>) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicit, hint, error);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={cn(fieldClass, 'min-h-[110px] leading-[1.5]')} {...input} />
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  className = '',
  id: explicit,
  options,
  ...select
}: Shell & ComponentProps<'select'> & { options: readonly { value: string; label: string }[] }) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicit, hint, error);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={hintId} className="font-sans text-[13px] leading-[1.45] text-muted">
          {hint}
        </p>
      )}
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={fieldClass} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ErrorLine id={errorId} message={error} />
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

export function ButtonLink({ to, tone = 'secondary', children, className }: { to: string; tone?: ButtonTone; children: ReactNode; className?: string }) {
  return (
    <ButtonPrimitive asChild variant={TONE_VARIANTS[tone]} className={className}>
      <Link to={to}>{children}</Link>
    </ButtonPrimitive>
  );
}

// ── Layout and feedback ───────────────────────────────────────────────────────

/** The screen's single <h1> (focused after navigation by RouteEffects) and the document title. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  documentTitle,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  documentTitle?: string;
}) {
  usePageTitle(documentTitle ?? title);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <p className="font-sans text-[11px] font-extrabold uppercase tracking-[2px] text-brand">{eyebrow}</p>}
        <h1 data-page-heading tabIndex={-1} className="font-display text-[32px] leading-[1.05] text-ink outline-none sm:text-[40px]">
          {title}
        </h1>
        {description && <div className="max-w-[720px] font-sans text-[15px] leading-[1.55] text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A section on a Card: its heading (h2 unless nested), description and actions, then the content. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  return (
    <Card as="section" className={className}>
      {(title || actions) && (
        <CardHeader>
          {title && (
            <CardTitle as={headingLevel === 2 ? 'h2' : 'h3'} className="text-[18px]">
              {title}
            </CardTitle>
          )}
          {description && <CardDescription>{description}</CardDescription>}
          {actions && <CardAction className="flex flex-wrap gap-2">{actions}</CardAction>}
        </CardHeader>
      )}
      <div className="flex flex-col gap-4 px-5 sm:px-6">{children}</div>
    </Card>
  );
}

export type BadgeTone = Exclude<BadgeVariant, 'outline'>;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <BadgePrimitive variant={tone}>{children}</BadgePrimitive>;
}

/** Wide tables scroll sideways inside a focusable, labelled region instead of widening the page. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="w-full overflow-x-auto rounded-[12px] border border-line bg-white">
      {children}
    </div>
  );
}

export const th = 'whitespace-nowrap border-b border-line bg-cream px-4 py-2.5 text-left font-sans text-[12px] font-extrabold uppercase tracking-[0.8px] text-muted';
export const td = 'border-b border-line/70 px-4 py-3 align-top font-sans text-[14px] text-ink';

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 font-sans text-[14px] text-muted">
      <p>
        {total ? `Showing ${from}–${to} of ${total}` : 'Nothing to show'}
      </p>
      <div className="flex gap-2">
        <Button tone="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button tone="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
