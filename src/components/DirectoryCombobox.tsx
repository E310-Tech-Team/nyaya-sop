import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { controlClass } from './Fields';

type Props<T> = {
  /** The input's id: a <label htmlFor> outside names it. */
  id: string;
  inputRef?: Ref<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onChoose: (item: T) => void;
  /**
   * Changes when a new set of results arrives (not when a page is added to it): the list then opens
   * if the box has focus, with nothing highlighted. Null while there are none.
   */
  resultsKey: string | null;
  /** The last option when there are more to show ("Show 20 more parishes"). */
  more?: { label: string; onShow: () => void } | null;
  /** Shown between the box and the open list ("No exact match. Did you mean one of these?"). */
  notice?: ReactNode;
  /** Shown under the open list ("Showing 20 of 104 parishes in Lagos Province 12."). */
  footer?: ReactNode;
  listLabel: string;
  describedBy?: string;
  invalid: boolean;
  placeholder: string;
  maxLength: number;
};

/**
 * The parish question's comboboxes (docs/04): a text box with a list of suggestions it controls
 * (`aria-activedescendant`), arrows to move, Enter to choose, Escape to close or clear. Enter never
 * submits the form while the list is open. A "Show more" option at the end of the list adds the
 * next page without leaving the box. The caller fetches and announces results.
 */
export function DirectoryCombobox<T>({
  id,
  inputRef,
  query,
  onQuery,
  items,
  itemKey,
  renderItem,
  onChoose,
  resultsKey,
  more,
  notice,
  footer,
  listLabel,
  describedBy,
  invalid,
  placeholder,
  maxLength,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const focused = useRef(false);
  const count = items.length + (more ? 1 : 0);
  const expanded = open && count > 0;
  const moreIndex = more ? items.length : -1;
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  // New results: shown if the box has focus, with nothing highlighted yet.
  useEffect(() => {
    setActive(-1);
    if (resultsKey !== null && focused.current) setOpen(true);
  }, [resultsKey]);

  useEffect(() => {
    if (expanded) listRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded]);
  // Also when a page is added: its first new entry takes the highlighted "Show more"'s place.
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, items.length, id]);

  function pick(index: number) {
    if (index === moreIndex) more?.onShow();
    else if (items[index] !== undefined) onChoose(items[index]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        setActive(0);
      } else setActive((index) => Math.min(count - 1, index + 1));
    } else if (event.key === 'ArrowUp' && expanded) {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && expanded) {
      // Never submit the form while the list is open.
      event.preventDefault();
      if (active >= 0) pick(active);
      else if (items.length === 1 && !more) pick(0);
    } else if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        event.preventDefault();
        onQuery('');
      }
    } else if (event.key === 'Tab') setOpen(false);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={maxLength}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
        className={controlClass(invalid)}
      />
      {expanded && notice}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={listLabel}
        hidden={!expanded}
        className="max-h-[min(60vh,420px)] w-full overflow-y-auto rounded-[10px] border border-line-strong bg-white"
      >
        {items.map((item, index) => (
          <li
            key={itemKey(item)}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // Keeps focus in the box, so the click lands on the option.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(index)}
            onMouseMove={() => setActive(index)}
            className={`flex min-h-[52px] cursor-pointer flex-col justify-center gap-[2px] border-b border-line px-[14px] py-[9px] last:border-b-0 ${
              index === active ? 'bg-[rgba(132,29,38,0.08)]' : ''
            }`}
          >
            {renderItem(item)}
          </li>
        ))}
        {more && (
          <li
            id={optionId(moreIndex)}
            role="option"
            aria-selected={active === moreIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(moreIndex)}
            onMouseMove={() => setActive(moreIndex)}
            className={`flex min-h-[48px] cursor-pointer items-center px-[14px] py-[9px] font-sans text-[14px] font-bold text-brand underline underline-offset-[3px] ${
              active === moreIndex ? 'bg-[rgba(132,29,38,0.08)]' : ''
            }`}
          >
            {more.label}
          </li>
        )}
      </ul>
      {expanded && footer}
    </>
  );
}
