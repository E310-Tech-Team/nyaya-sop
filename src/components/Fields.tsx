import type { InputHTMLAttributes, ReactNode } from 'react';

export function QuestionNumber({ n }: { n: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-rose/45 font-sans text-[11px] font-extrabold text-brand"
    >
      {n}
    </span>
  );
}

function RequiredMark({ required }: { required: boolean }) {
  return required ? (
    <span className="text-brand" aria-hidden="true">
      {' '}
      *
    </span>
  ) : (
    <span className="font-sans text-[12px] font-medium text-muted"> (optional)</span>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-[6px] font-sans text-[13px] font-semibold leading-[1.4] text-brand">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-[2px] size-[14px] shrink-0 fill-current">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5h1.5v5h-1.5v-5Zm0 6.25h1.5v1.5h-1.5v-1.5Z" />
      </svg>
      {message}
    </p>
  );
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

const controlClass = (invalid: boolean) =>
  // No transition: focus and error states must appear immediately.
  `h-[52px] w-full rounded-[8px] border bg-paper px-[15px] font-sans text-[16px] text-ink outline-none ` +
  `placeholder:text-muted focus:border-brand focus:shadow-[0_0_0_3px_rgba(132,29,38,0.22)] ` +
  (invalid ? 'border-brand bg-[rgba(132,29,38,0.03)]' : 'border-line-strong');

type ShellProps = {
  id: string;
  number: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

/** Numbered question with a <label>, optional hint and an error line wired up with aria-describedby. */
function QuestionShell({ id, number, label, required = true, hint, error, children, className = '' }: ShellProps) {
  return (
    <div className={`flex w-full flex-col gap-[13px] ${className}`}>
      <div className="flex w-full items-start gap-[11px]">
        <QuestionNumber n={number} />
        <div className="flex flex-1 flex-col gap-[4px] pt-[4px]">
          <label htmlFor={id} className="font-sans text-[15px] leading-[1.4] text-ink">
            {label}
            <RequiredMark required={required} />
          </label>
          {hint && (
            <p id={`${id}-hint`} className="font-sans text-[12px] leading-[1.45] text-muted">
              {hint}
            </p>
          )}
        </div>
      </div>
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

type TextFieldProps = Omit<ShellProps, 'children'> &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange' | 'value' | 'className'> & {
    value: string;
    onChange: (value: string) => void;
  };

export function TextField({ id, number, label, required = true, hint, error, className, value, onChange, ...input }: TextFieldProps) {
  return (
    <QuestionShell id={id} number={number} label={label} required={required} hint={hint} error={error} className={className}>
      <input
        {...input}
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        className={controlClass(!!error)}
      />
    </QuestionShell>
  );
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='8' viewBox='0 0 14 8'%3E%3Cpath d='M1 1l6 6 6-6' stroke='%23841d26' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")";

type SelectFieldProps = Omit<ShellProps, 'children'> & {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: readonly (string | { readonly value: string; readonly label: string })[];
  autoComplete?: string;
};

export function SelectField({ id, number, label, required = true, hint, error, className, value, onChange, placeholder, options, autoComplete }: SelectFieldProps) {
  return (
    <QuestionShell id={id} number={number} label={label} required={required} hint={hint} error={error} className={className}>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        className={`${controlClass(!!error)} cursor-pointer appearance-none pr-[44px] ${value ? '' : 'text-muted'}`}
        style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => {
          const { value: v, label: l } = typeof option === 'string' ? { value: option, label: option } : option;
          return (
            <option key={v} value={v} className="text-ink">
              {l}
            </option>
          );
        })}
      </select>
    </QuestionShell>
  );
}

type ChoiceOption<V> = { readonly value: V; readonly label: string };

type ChoiceGroupProps<V extends string | number> = {
  name: string;
  number: string;
  legend: string;
  hint?: string;
  options: readonly ChoiceOption<V>[];
  value: V | '' | null;
  onChange: (value: V) => void;
  error?: string;
  /** 'tiles' = radio list; 'scale' = numbered 1–5 scale. */
  variant?: 'tiles' | 'scale';
};

/** A radio group built on native inputs (keyboard + screen reader support for free), styled as tiles. */
export function ChoiceGroup<V extends string | number>({ name, number, legend, hint, options, value, onChange, error, variant = 'tiles' }: ChoiceGroupProps<V>) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset className="flex w-full flex-col gap-[14px]" aria-describedby={describedBy(hintId, errorId)}>
      <legend className="float-left mb-[14px] flex w-full items-start gap-[11px]">
        <QuestionNumber n={number} />
        <span className="flex flex-1 flex-col gap-[4px] pt-[4px]">
          <span className="font-sans text-[15px] leading-[1.4] text-ink">
            {legend}
            <RequiredMark required />
          </span>
          {hint && (
            <span id={hintId} className="font-sans text-[12px] leading-[1.45] text-muted">
              {hint}
            </span>
          )}
        </span>
      </legend>
      <div className={`clear-both flex w-full flex-col ${variant === 'scale' ? 'gap-[11px]' : 'gap-[10px]'}`}>
        {options.map((option) => {
          const checked = value === option.value;
          const inputId = `${name}-${option.value}`;
          return (
            <label
              key={String(option.value)}
              htmlFor={inputId}
              // Selection eases in over the form duration; the focus outline stays instant.
              className={`group flex w-full cursor-pointer items-center rounded-[8px] border text-left transition-[border-color,background-color,box-shadow] duration-(--duration-form) has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-brand ${
                variant === 'scale' ? 'min-h-[72px] gap-[14px] px-[14px] py-[13px]' : 'min-h-[50px] gap-[11px] px-[14px] py-[12px]'
              } ${
                checked
                  ? 'border-brand bg-[rgba(132,29,38,0.06)] shadow-[0_0_0_2px_rgba(132,29,38,0.15)]'
                  : error
                    ? 'border-brand/60 bg-paper hover:border-brand'
                    : 'border-line bg-paper hover:border-brand hover:bg-[rgba(132,29,38,0.03)]'
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                value={String(option.value)}
                checked={checked}
                onChange={() => onChange(option.value)}
                required
                aria-invalid={error ? true : undefined}
                className="sr-only"
              />
              {variant === 'scale' ? (
                <>
                  <span
                    aria-hidden="true"
                    className={`flex size-[42px] shrink-0 items-center justify-center rounded-full border font-sans text-[16px] font-bold transition-[background-color,border-color,color] duration-(--duration-form) ${
                      checked ? 'border-brand bg-brand text-white' : 'border-line-strong bg-white text-brand'
                    }`}
                  >
                    {option.value}
                  </span>
                  <span
                    className={`flex-1 font-sans text-[14px] font-semibold leading-[1.4] transition-colors duration-(--duration-form) ${checked ? 'text-brand' : 'text-muted'}`}
                  >
                    {option.value} - {option.label}
                  </span>
                  {/* Always rendered (so the row never reflows); fades/scales in when chosen. */}
                  <span
                    aria-hidden="true"
                    className={`flex size-[24px] shrink-0 items-center justify-center rounded-full bg-brand transition-[opacity,scale] duration-(--duration-form) ${
                      checked ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
                    }`}
                  >
                    <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                      <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className={`flex size-[19px] shrink-0 items-center justify-center rounded-full border bg-white transition-colors duration-(--duration-form) ${
                      checked ? 'border-brand' : 'border-line-strong'
                    }`}
                  >
                    <span
                      className={`size-[8px] rounded-full bg-brand transition-[opacity,scale] duration-(--duration-form) ${
                        checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                      }`}
                    />
                  </span>
                  <span
                    className={`flex-1 font-sans text-[14px] font-medium leading-[1.35] transition-colors duration-(--duration-form) ${checked ? 'text-brand' : 'text-ink'}`}
                  >
                    {option.label}
                  </span>
                </>
              )}
            </label>
          );
        })}
      </div>
      <FieldError id={`${name}-error`} message={error} />
    </fieldset>
  );
}

/**
 * Hidden field that people never see or reach, but naive form-filling bots do.
 * The server silently discards submissions where it isn't empty.
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
      <label htmlFor="website">Leave this field empty</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
