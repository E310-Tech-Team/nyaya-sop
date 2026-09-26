/** Announced (role="alert") when "Save & Continue" is pressed with unanswered or invalid questions. */
export function ErrorSummary({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      role="alert"
      className="w-full max-w-[840px] rounded-[10px] border border-brand/40 bg-[rgba(139,30,63,0.05)] px-[16px] py-[12px] font-sans text-[14px] font-semibold text-brand"
    >
      {count === 1 ? 'One answer needs attention' : `${count} answers need attention`} before you continue.
    </div>
  );
}

/** Moves focus to the first invalid control once the error styles have rendered. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  // setTimeout (not rAF): runs after React commits the error state, even in background tabs.
  setTimeout(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
}
