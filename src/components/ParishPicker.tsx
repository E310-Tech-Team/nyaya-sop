import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, searchParishes } from '../lib/api';
import { chainLine, chainRows, highlightParts, resultsAnnouncement, type ParishDraft } from '../lib/parish';
import { NIGERIAN_STATES, OUTSIDE_NIGERIA } from '../shared/application';
import { PARISH_SEARCH, type ParishSearchResponse, type ParishSuggestion } from '../shared/directory';
import { LIMITS } from '../shared/validation';
import type { ParishCheck } from '../state/application';
import { FieldError, QuestionNumber, RequiredMark, controlClass, describedBy } from './Fields';

const DEBOUNCE_MS = 250;
// "Searching…" appears only when a search is slow, so fast results don't flicker.
const SLOW_MS = 300;
const TIMEOUT_MS = 8_000;

type Search =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; response: ParishSearchResponse }
  | { status: 'error'; query: string; reason: 'offline' | 'busy' | 'failed' };

type Props = {
  /** The form field's id: the search box's id and the key of its error. */
  id: string;
  number: string;
  /** The applicant's state of residence: parishes there are suggested first. */
  state: string;
  value: ParishDraft | null;
  onChange: (value: ParishDraft | null, options?: { fresh?: boolean }) => void;
  check: ParishCheck;
  error?: string;
  /** Free text typed before the directory was switched on: the first search. */
  initialQuery?: string;
};

const pill =
  'inline-flex min-h-[46px] cursor-pointer items-center justify-center rounded-full px-[18px] font-sans text-[14px] font-bold ' +
  'focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand';
const textButton =
  'cursor-pointer self-start rounded-[4px] font-sans text-[14px] font-semibold text-brand underline underline-offset-[3px] ' +
  'hover:text-brand-hover focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand';
const note = 'font-sans text-[13px] leading-[1.5] text-muted';

/**
 * Question 08 while the parish directory is on (docs/03, Personal step): an accessible combobox
 * that searches the RCCG parish list, a card to confirm the chosen parish with its province,
 * region and continent (read-only), and "I can't find my parish" for a name that isn't listed.
 */
export function ParishPicker({ id, number, state, value, onChange, check, error, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery.trim());
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  const [slow, setSlow] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusNext = useRef<'search' | 'confirm' | 'manual' | 'card' | null>(null);

  const mode = value?.kind === 'listed' ? 'chosen' : value?.kind === 'not_listed' ? 'manual' : 'search';
  const rankState = (NIGERIAN_STATES as readonly string[]).includes(state) ? state : null;
  const text = query.trim().slice(0, PARISH_SEARCH.maxLength);
  const results = search.status === 'done' ? search.response.results : [];
  const expanded = open && mode === 'search' && results.length > 0;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  // A choice withdrawn by the re-check (merged or no longer listed): search for it again.
  const withdrawnName = value?.kind === 'withdrawn' ? value.name : null;
  useEffect(() => {
    if (withdrawnName) setQuery((current) => current || withdrawnName);
  }, [withdrawnName]);

  // Search as they type: debounced, and any earlier request cancelled.
  useEffect(() => {
    if (mode !== 'search' || text.length < PARISH_SEARCH.minLength) {
      setSearch({ status: 'idle' });
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    let timedOut = false;
    let slowTimer = 0;
    let timeoutTimer = 0;
    const debounce = window.setTimeout(() => {
      setSearch({ status: 'loading', query: text });
      slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);
      timeoutTimer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);
      searchParishes(text, rankState, controller.signal)
        .then((response) => {
          setSearch({ status: 'done', query: text, response });
          setActive(-1);
          setOpen(true);
          setAnnouncement(resultsAnnouncement(response));
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted && !timedOut) return; // a newer search replaced it
          const reason =
            navigator.onLine === false ? 'offline' : caught instanceof ApiError && caught.code === 'RATE_LIMITED' ? 'busy' : 'failed';
          setSearch({ status: 'error', query: text, reason });
          setOpen(false);
        })
        .finally(() => {
          window.clearTimeout(slowTimer);
          window.clearTimeout(timeoutTimer);
          setSlow(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(debounce);
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
      controller.abort();
    };
  }, [mode, text, rankState, attempt]);

  // Offline: search again as soon as the connection is back.
  const offline = search.status === 'error' && search.reason === 'offline';
  useEffect(() => {
    if (!offline) return;
    const retry = () => setAttempt((count) => count + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline]);

  // Focus follows the step the applicant is on, after the render that shows it.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'search') inputRef.current?.focus();
    else if (target === 'confirm') confirmRef.current?.focus();
    else if (target === 'manual') manualRef.current?.focus();
    else if (target === 'card') cardRef.current?.focus();
  });

  useEffect(() => {
    if (expanded) listRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);

  function choose(suggestion: ParishSuggestion) {
    focusNext.current = 'confirm';
    setOpen(false);
    setAnnouncement(`${suggestion.name} chosen. Check the details, then confirm.`);
    onChange(
      { kind: 'listed', id: suggestion.id, name: suggestion.name, chain: suggestion.chain, confirmed: false, detailsWrong: false, changed: false },
      { fresh: true },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        setActive(0);
      } else setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp' && expanded) {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && expanded) {
      // Never submit the form while the list is open.
      event.preventDefault();
      const pick = active >= 0 ? results[active] : results.length === 1 ? results[0] : undefined;
      if (pick) choose(pick);
    } else if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        event.preventDefault();
        setQuery('');
      }
    } else if (event.key === 'Tab') setOpen(false);
  }

  return (
    <div className="flex w-full flex-col gap-[13px]">
      <div className="flex w-full items-start gap-[11px]">
        <QuestionNumber n={number} />
        <div className="flex flex-1 flex-col gap-[4px] pt-[4px]">
          {mode === 'search' ? (
            <label htmlFor={id} className="font-sans text-[15px] leading-[1.4] text-ink">
              Your RCCG parish
              <RequiredMark required />
            </label>
          ) : (
            <p className="font-sans text-[15px] leading-[1.4] text-ink">
              Your RCCG parish
              <RequiredMark required />
            </p>
          )}
          {mode === 'search' && (
            <p id={hintId} className="font-sans text-[12px] leading-[1.45] text-muted">
              Type your parish’s name and choose it from the list. Many parishes share a name, so you can add your province
              number, for example “Jesus House 12”.
            </p>
          )}
        </div>
      </div>
      {mode === 'chosen' ? listedCard() : mode === 'manual' ? notListed() : searchBox()}
      {/* Outside the branches, so it stays mounted and what it says is announced. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );

  function listedCard() {
    if (value?.kind !== 'listed') return null;
    const { confirmed } = value;
    return (
      <>
        <div
          ref={cardRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-card-title`}
          className={`form-enter flex w-full flex-col gap-[12px] rounded-[12px] border bg-paper p-[16px] outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand ${
            error ? 'border-brand' : 'border-line-strong'
          }`}
        >
          <div className="flex flex-col gap-[2px]">
            <p className="font-sans text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
              {confirmed ? 'Your parish' : 'Check your parish'}
            </p>
            <p id={`${id}-card-title`} className="flex items-center gap-[8px] font-sans text-[18px] font-bold text-ink">
              {confirmed && (
                <span aria-hidden="true" className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-brand">
                  <svg width="11" height="8" viewBox="0 0 12 9" fill="none">
                    <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              {value.name}
            </p>
          </div>
          <dl className="grid w-full grid-cols-[minmax(0,1fr)] gap-y-[6px] sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-x-[16px]">
            {chainRows(value.chain).map(([label, detail]) => (
              <div key={label} className="contents">
                <dt className="font-sans text-[13px] font-semibold text-muted">{label}</dt>
                <dd className="mb-[4px] font-sans text-[15px] text-ink [overflow-wrap:anywhere] sm:mb-0">{detail}</dd>
              </div>
            ))}
          </dl>
          {value.changed && !confirmed && (
            <p className="font-sans text-[13px] font-semibold leading-[1.5] text-brand">
              These details have changed since you chose this parish. Check them, then confirm again.
            </p>
          )}
          {check === 'offline' && <p className={note}>Chosen earlier. We’ll check it against the list again when you’re back online.</p>}
          <div className="flex flex-wrap gap-[10px]">
            {!confirmed && (
              <button
                ref={confirmRef}
                type="button"
                data-focus-invalid={error ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                onClick={() => {
                  focusNext.current = 'card';
                  setAnnouncement(`${value.name} confirmed as your parish.`);
                  onChange({ ...value, confirmed: true, changed: false });
                }}
                className={`${pill} bg-brand text-white hover:bg-brand-hover`}
              >
                Yes, this is my parish
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                focusNext.current = 'search';
                setAnnouncement('');
                onChange(null);
              }}
              className={`${pill} border border-line-strong bg-white text-brand hover:border-brand`}
            >
              Change parish
            </button>
          </div>
          <button
            type="button"
            aria-pressed={value.detailsWrong}
            onClick={() => onChange({ ...value, detailsWrong: !value.detailsWrong })}
            className={textButton}
          >
            Details look wrong? Tell us
          </button>
          {value.detailsWrong && <p className={note}>Thanks: the Programme team will check this parish’s details. You can still continue.</p>}
        </div>
        <FieldError id={errorId} message={error} />
      </>
    );
  }

  function notListed() {
    if (value?.kind !== 'not_listed') return null;
    const manualId = `${id}-reported`;
    return (
      <div className="form-enter flex w-full flex-col gap-[10px]">
        <label htmlFor={manualId} className="font-sans text-[14px] font-semibold text-ink">
          Your parish’s name, as you know it
        </label>
        <input
          ref={manualRef}
          id={manualId}
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={LIMITS.parishName.max}
          value={value.name}
          onChange={(event) => onChange({ kind: 'not_listed', name: event.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${manualId}-hint`, error && errorId)}
          className={controlClass(!!error)}
        />
        <p id={`${manualId}-hint`} className={note}>
          It isn’t on our list yet, so the Programme team will check it. You can still continue.
        </p>
        <FieldError id={errorId} message={error} />
        <button
          type="button"
          onClick={() => {
            focusNext.current = 'search';
            onChange(null);
          }}
          className={textButton}
        >
          Search the list instead
        </button>
      </div>
    );
  }

  function searchBox() {
    return (
      <>
        {value?.kind === 'withdrawn' && (
          <div className="rounded-[10px] border border-brand/30 bg-[rgba(132,29,38,0.04)] px-[14px] py-[12px] font-sans text-[14px] leading-[1.5] text-ink">
            <p>
              <span className="font-semibold">{value.name}</span>, which you chose earlier,{' '}
              {value.reason === 'merged' && value.mergedInto
                ? `is now part of ${value.mergedInto.name}.`
                : 'is no longer on our list. Search for it again, or tell us it isn’t listed.'}
            </p>
            {value.reason === 'merged' && value.mergedInto && (
              <button
                type="button"
                onClick={() => {
                  focusNext.current = 'search';
                  setQuery(value.mergedInto!.name);
                }}
                className={`${textButton} mt-[6px]`}
              >
                Search for {value.mergedInto.name}
              </button>
            )}
          </div>
        )}
        {state === OUTSIDE_NIGERIA && (
          <p className={note}>Our parish list covers Nigeria only for now. If your parish is outside Nigeria, choose “I can’t find my parish”.</p>
        )}
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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hintId, error && errorId)}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={PARISH_SEARCH.maxLength}
          placeholder="Start typing your parish’s name"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className={controlClass(!!error)}
        />
        {expanded && search.status === 'done' && search.response.fuzzy && (
          <p className="font-sans text-[13px] font-semibold text-ink">No exact match. Did you mean one of these?</p>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Parishes"
          hidden={!expanded}
          className="max-h-[min(60vh,420px)] w-full overflow-y-auto rounded-[10px] border border-line-strong bg-white"
        >
          {results.map((result, index) => (
            <li
              key={result.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // Keeps focus in the search box, so the click lands on the option.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(result)}
              onMouseMove={() => setActive(index)}
              className={`flex min-h-[52px] cursor-pointer flex-col justify-center gap-[2px] border-b border-line px-[14px] py-[9px] last:border-b-0 ${
                index === active ? 'bg-[rgba(132,29,38,0.08)]' : ''
              }`}
            >
              <span className="font-sans text-[15px] text-ink">
                {highlightParts(result.name, search.status === 'done' ? search.query : '').map((part, partIndex) =>
                  part.match ? (
                    <b key={partIndex} className="font-bold">
                      {part.text}
                    </b>
                  ) : (
                    <span key={partIndex}>{part.text}</span>
                  ),
                )}
              </span>
              <span className="font-sans text-[13px] leading-[1.4] text-muted">{chainLine(result.chain)}</span>
            </li>
          ))}
        </ul>
        {expanded && search.status === 'done' && search.response.total > results.length && (
          <p className={note}>
            Showing {results.length} of {search.response.total}
            {rankState ? `, parishes in ${rankState} first` : ''}. Add your province number to narrow the list.
          </p>
        )}
        {search.status === 'loading' && slow && <p className={note}>Searching…</p>}
        {search.status === 'done' && !results.length && (
          <p className={note}>
            No parishes match “{search.query}”. Check the spelling, leave out “RCCG” or “Parish”, or add your province number.
          </p>
        )}
        {search.status === 'error' && (
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
            <p className="font-sans text-[13px] leading-[1.5] text-ink">
              {search.reason === 'offline'
                ? 'You’re offline. Finish the other questions and choose your parish when you’re back online.'
                : search.reason === 'busy'
                  ? 'Too many searches from your network just now. Wait a moment, then try again.'
                  : 'We couldn’t search just now.'}
            </p>
            {search.reason !== 'offline' && (
              <button type="button" onClick={() => setAttempt((count) => count + 1)} className={textButton}>
                Try again
              </button>
            )}
          </div>
        )}
        <FieldError id={errorId} message={error} />
        <button
          type="button"
          onClick={() => {
            focusNext.current = 'manual';
            onChange({ kind: 'not_listed', name: text });
          }}
          className={textButton}
        >
          I can’t find my parish
        </button>
      </>
    );
  }
}
