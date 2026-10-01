import { useEffect, useRef, useState, type ReactNode } from 'react';
import { searchParishes, searchPlaceParishes, searchUnits } from '../lib/api';
import {
  belowPlace,
  chainLine,
  chainRows,
  highlightParts,
  lookalikeNote,
  placeContext,
  placeLabel,
  placeParishesAnnouncement,
  placesAnnouncement,
  resultsAnnouncement,
  type ChosenPlace,
  type ParishDraft,
  type PlaceLevel,
  type ProvinceDraft,
} from '../lib/parish';
import { useDirectorySearch, usePagedSearch, type SearchState } from '../lib/useDirectorySearch';
import { NIGERIAN_STATES, OUTSIDE_NIGERIA } from '../shared/application';
import {
  isChainComplete,
  PARISH_SEARCH,
  UNIT_SEARCH,
  type DirectoryFreshness,
  type ParishSearchResponse,
  type ParishSuggestion,
  type UnitSearchResponse,
  type UnitSuggestion,
} from '../shared/directory';
import { LIMITS } from '../shared/validation';
import type { ParishCheck } from '../state/application';
import { DirectoryCombobox } from './DirectoryCombobox';
import { FieldError, QuestionNumber, RequiredMark, controlClass, describedBy } from './Fields';

type Props = {
  /** The form field's id: the visible search box's id and the key of the question's error. */
  id: string;
  number: string;
  /** The applicant's state of residence: provinces and parishes there are suggested first. */
  state: string;
  /** Step 1 (D-59): the province (or region or continent), or "I don't know my province". */
  province: ProvinceDraft | null;
  onProvince: (value: ProvinceDraft | null, options?: { fresh?: boolean }) => void;
  value: ParishDraft | null;
  onChange: (value: ParishDraft | null, options?: { fresh?: boolean }) => void;
  check: ParishCheck;
  error?: string;
  /** Free text typed before the directory was switched on: the first filter of the parish list. */
  initialQuery?: string;
};

const pill =
  'inline-flex min-h-[46px] cursor-pointer items-center justify-center rounded-full px-[18px] font-sans text-[14px] font-bold ' +
  'focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand';
const textButton =
  'cursor-pointer self-start rounded-[4px] font-sans text-[14px] font-semibold text-brand underline underline-offset-[3px] ' +
  'hover:text-brand-hover focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand';
const note = 'font-sans text-[13px] leading-[1.5] text-muted';
const stepLabel = 'font-sans text-[14px] font-semibold text-ink';
const hint = 'font-sans text-[12px] leading-[1.45] text-muted';
const notice = 'rounded-[10px] border border-brand/30 bg-[rgba(132,29,38,0.04)] px-[14px] py-[12px] font-sans text-[14px] leading-[1.5] text-ink';

/**
 * Question 08 before the server's settings say which parish question to ask, or when they couldn't
 * be loaded: the step can't be completed yet, and says why (never a question that doesn't count).
 */
export function ParishQuestionPending({ id, number, status, error, onRetry }: { id: string; number: string; status: 'loading' | 'failed'; error?: string; onRetry: () => void }) {
  const errorId = `${id}-error`;
  // Focus stays on the message while trying again (the button goes away until it fails again).
  const statusRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex w-full flex-col gap-[13px]">
      <div className="flex w-full items-start gap-[11px]">
        <QuestionNumber n={number} />
        <p className="flex-1 pt-[4px] font-sans text-[15px] leading-[1.4] text-ink">
          Your RCCG parish
          <RequiredMark required />
        </p>
      </div>
      <div
        ref={statusRef}
        tabIndex={-1}
        data-focus-invalid={error && status === 'loading' ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-[4px] outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand"
      >
        <p role="status" className={note}>
          {status === 'loading' ? 'Loading the parish question…' : 'We couldn’t load the parish question. Check your connection, then try again.'}
        </p>
      </div>
      {status === 'failed' && (
        <button
          type="button"
          onClick={() => {
            statusRef.current?.focus();
            onRetry();
          }}
          data-focus-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          className={textButton}
        >
          Try again
        </button>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** The name with the start of each word that matches a typed word in bold. */
function highlighted(name: string, typed: string): ReactNode {
  return highlightParts(name, typed).map((part, index) =>
    part.match ? (
      <b key={index} className="font-bold">
        {part.text}
      </b>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

type Paged = { results: unknown[]; total: number; more: 'idle' | 'loading' | 'failed'; showMore: () => Promise<{ shown: number; total: number } | null> };

/**
 * Question 08 while the parish directory is on (docs/03, Personal step; D-59), in two steps: the
 * province (or the region or continent a parish is in when it isn't in a province), then a parish
 * in it, searched or browsed a page at a time. "I don't know my province" searches every province
 * instead. A card confirms the chosen parish with its province, region and continent (read-only),
 * and "I can't find my parish" takes a name that isn't listed, with the province chosen.
 */
export function ParishPicker({ id, number, state, province, onProvince, value, onChange, check, error, initialQuery = '' }: Props) {
  const [placeQuery, setPlaceQuery] = useState('');
  const [query, setQuery] = useState(initialQuery.trim());
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<'search' | 'confirm' | 'manual' | 'card' | null>(null);

  const place = province?.kind === 'place' ? province : null;
  const mode =
    value?.kind === 'listed'
      ? 'chosen'
      : value?.kind === 'not_listed'
        ? 'manual'
        : place
          ? 'parish'
          : province?.kind === 'anywhere'
            ? 'anywhere'
            : 'place';
  const rankState = (NIGERIAN_STATES as readonly string[]).includes(state) ? state : null;
  const placeText = placeQuery.trim().slice(0, PARISH_SEARCH.maxLength);
  const text = query.trim().slice(0, PARISH_SEARCH.maxLength);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Step 1: places by name or number, the applicant's state first.
  const places = usePagedSearch<UnitSuggestion, UnitSearchResponse>(
    mode === 'place' && placeText.length >= UNIT_SEARCH.minLength ? `place\n${rankState ?? ''}\n${placeText}` : null,
    (offset, signal) => searchUnits(placeText, rankState, offset, signal),
  );
  // Step 2: the place's parishes, those matching what's typed or all of them, a page at a time.
  const inPlace = usePagedSearch<ParishSuggestion, ParishSearchResponse>(mode === 'parish' && place ? `parish\n${place.id}\n${text}` : null, (offset, signal) =>
    searchPlaceParishes(place!.id, text, offset, signal),
  );
  // "I don't know my province": the best few across every province, as before the province step.
  const anywhere = useDirectorySearch<ParishSearchResponse>(
    mode === 'anywhere' && text.length >= PARISH_SEARCH.minLength ? `anywhere\n${rankState ?? ''}\n${text}` : null,
    (signal) => searchParishes(text, rankState, signal),
  );

  // Results in words, as they arrive.
  useEffect(() => {
    if (places.search.status === 'done') setAnnouncement(placesAnnouncement(places.search.response));
  }, [places.search]);
  const placeName = place?.name ?? '';
  useEffect(() => {
    const found = inPlace.search;
    if (found.status === 'done') setAnnouncement(placeParishesAnnouncement(found.response, found.response.results.length, placeName, found.key.split('\n')[2] !== ''));
  }, [inPlace.search, placeName]);
  useEffect(() => {
    if (anywhere.search.status === 'done') setAnnouncement(resultsAnnouncement(anywhere.search.response));
  }, [anywhere.search]);

  // A choice withdrawn by the re-check (merged or no longer listed): search for it again.
  const withdrawnName = value?.kind === 'withdrawn' ? value.name : null;
  useEffect(() => {
    if (withdrawnName) setQuery((current) => current || withdrawnName);
  }, [withdrawnName]);

  // Focus follows the step the applicant is on, after the render that shows it.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'search') inputRef.current?.focus();
    else if (target === 'confirm') confirmRef.current?.focus();
    else if (target === 'manual') manualRef.current?.focus();
    else if (target === 'card') cardRef.current?.focus();
  });

  function choosePlace(suggestion: UnitSuggestion) {
    focusNext.current = 'search';
    setPlaceQuery('');
    setAnnouncement(`${placeLabel(suggestion)} chosen. Now choose your parish: type to filter its list, or browse it.`);
    onProvince({ kind: 'place', id: suggestion.id, level: suggestion.level as PlaceLevel, name: suggestion.name, chain: suggestion.chain }, { fresh: true });
  }

  function changeProvince() {
    focusNext.current = 'search';
    setAnnouncement(value?.kind === 'listed' || value?.kind === 'not_listed' ? 'Your province and parish were cleared. Choose your province.' : 'Choose your province.');
    onProvince(null);
  }

  function searchAnywhere() {
    focusNext.current = 'search';
    setAnnouncement('Searching every province. Type your parish’s name.');
    onProvince({ kind: 'anywhere' });
  }

  function choose(suggestion: ParishSuggestion) {
    focusNext.current = 'confirm';
    const lookalikes = lookalikeNote(suggestion.lookalikes);
    setAnnouncement(`${suggestion.name} chosen${lookalikes ? `, one of ${lookalikes}` : ''}. Check the details, then confirm.`);
    onChange(
      {
        kind: 'listed',
        id: suggestion.id,
        name: suggestion.name,
        chain: suggestion.chain,
        confirmed: false,
        detailsWrong: false,
        changed: false,
        ...(suggestion.lookalikes && suggestion.lookalikes > 1 ? { lookalikes: suggestion.lookalikes } : {}),
      },
      { fresh: true },
    );
  }

  function reportNotListed() {
    focusNext.current = 'manual';
    onChange({ kind: 'not_listed', name: text });
  }

  /** "Show 20 more parishes": the last option while a list has more, announcing what it adds. */
  function moreOption(paged: Paged, noun: string, pageSize: number, maxOffset: number, announce: (shown: number, total: number) => string) {
    const left = paged.total - paged.results.length;
    // The server pages up to `maxOffset`: past that, typing narrows the list instead.
    if (left <= 0 || paged.results.length >= maxOffset) return null;
    const label =
      paged.more === 'loading' ? 'Loading more…' : paged.more === 'failed' ? `We couldn’t load more ${noun}. Try again` : `Show ${Math.min(pageSize, left)} more ${noun}`;
    return {
      label,
      onShow: () => {
        if (paged.more === 'loading') return;
        void paged.showMore().then((counts) => counts && setAnnouncement(announce(counts.shown, counts.total)));
      },
    };
  }

  return (
    <fieldset className="flex w-full min-w-0 flex-col gap-[13px]">
      <legend className="float-left mb-[13px] flex w-full items-start gap-[11px]">
        <QuestionNumber n={number} />
        <span className="flex-1 pt-[4px] font-sans text-[15px] leading-[1.4] text-ink">
          Your RCCG parish
          <RequiredMark required />
        </span>
      </legend>
      <div className="clear-both flex w-full min-w-0 flex-col gap-[13px]">
        {place && placeSummary(place)}
        {mode === 'chosen' ? listedCard() : mode === 'manual' ? notListed() : mode === 'parish' && place ? parishStep(place) : mode === 'anywhere' ? anywhereStep() : placeStep()}
      </div>
      {/* Outside the steps, so it stays mounted and what it says is announced. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </fieldset>
  );

  function placeSummary(chosen: ChosenPlace) {
    const context = placeContext(chosen);
    return (
      <div className="flex w-full flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px] rounded-[10px] border border-line bg-paper px-[14px] py-[10px]">
        <div className="flex min-w-0 flex-col gap-[2px]">
          <p className="font-sans text-[12px] font-bold uppercase tracking-[0.08em] text-muted">Your province</p>
          <p className="font-sans text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{placeLabel(chosen)}</p>
          {context && <p className="font-sans text-[13px] leading-[1.4] text-muted">{context}</p>}
        </div>
        <button type="button" onClick={changeProvince} className={textButton}>
          Change province
        </button>
      </div>
    );
  }

  /** The search notes every step shares: the list's freshness, "Searching…", and why a search failed. */
  function searchNotes(search: SearchState<{ directory?: DirectoryFreshness }>, slow: boolean, retry: () => void, step: 'province' | 'parish') {
    return (
      <>
        {search.status === 'done' && search.response.directory?.stale && (
          // Honest about freshness: the RCCG directory couldn't be checked for updates lately.
          <p className={note}>
            The RCCG parish list may be out of date: we couldn’t check it for updates recently.{' '}
            {step === 'province' ? 'If your province isn’t there, choose “I don’t know my province”.' : 'If your parish isn’t there, choose “I can’t find my parish”.'}
          </p>
        )}
        {search.status === 'loading' && slow && <p className={note}>Searching…</p>}
        {search.status === 'error' && (
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
            <p className="font-sans text-[13px] leading-[1.5] text-ink">
              {search.reason === 'offline'
                ? `You’re offline. Finish the other questions and choose your ${step} when you’re back online.`
                : search.reason === 'busy'
                  ? 'Too many searches from your network just now. Wait a moment, then try again.'
                  : 'We couldn’t search just now.'}
            </p>
            {search.reason !== 'offline' && (
              <button type="button" onClick={retry} className={textButton}>
                Try again
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  /** A parish chosen earlier that the re-check found merged or no longer listed. */
  function withdrawnNotice(canSearch: boolean) {
    if (value?.kind !== 'withdrawn') return null;
    return (
      <div className={notice}>
        <p>
          <span className="font-semibold">{value.name}</span>, which you chose earlier,{' '}
          {value.reason === 'merged' && value.mergedInto ? `is now part of ${value.mergedInto.name}.` : 'is no longer on our list. Find it again, or tell us it isn’t listed.'}
        </p>
        {canSearch && value.reason === 'merged' && value.mergedInto && (
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
    );
  }

  function placeStep() {
    const { search, results, total } = places;
    const typed = search.status === 'done' ? placeText : '';
    return (
      <>
        <div className="flex flex-col gap-[4px]">
          <label htmlFor={id} className={stepLabel}>
            Your province
          </label>
          <p id={hintId} className={hint}>
            Type its name or number, for example “Lagos Province 12” or “LP 12”. If your parish isn’t in a province, type its region or continent.
          </p>
        </div>
        {province?.kind === 'withdrawn' && (
          <div className={notice}>
            <p>
              <span className="font-semibold">{province.name}</span>, which you chose earlier, is no longer on our list. Choose your province again.
            </p>
          </div>
        )}
        {withdrawnNotice(false)}
        {state === OUTSIDE_NIGERIA && (
          <p className={note}>Our parish list covers Nigeria only for now. If your parish is outside Nigeria, choose “I don’t know my province”, then “I can’t find my parish”.</p>
        )}
        <DirectoryCombobox
          id={id}
          inputRef={inputRef}
          query={placeQuery}
          onQuery={setPlaceQuery}
          items={results}
          itemKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <span className="font-sans text-[15px] text-ink">{highlighted(placeLabel(item), typed)}</span>
              {placeContext(item) && <span className="font-sans text-[13px] leading-[1.4] text-muted">{placeContext(item)}</span>}
            </>
          )}
          onChoose={choosePlace}
          resultsKey={search.status === 'done' ? search.key : null}
          more={moreOption(places, 'provinces', UNIT_SEARCH.pageSize, UNIT_SEARCH.maxOffset, (shown, all) => `Showing ${shown} of ${all}.`)}
          footer={
            total > results.length && (
              <p className={note}>
                Showing {results.length} of {total}
                {rankState ? `, ${rankState} first` : ''}. Add your province number to narrow the list.
              </p>
            )
          }
          listLabel="Provinces"
          describedBy={describedBy(hintId, error && errorId)}
          invalid={!!error}
          placeholder="Start typing your province"
          maxLength={PARISH_SEARCH.maxLength}
        />
        {searchNotes(search, places.slow, places.retry, 'province')}
        {search.status === 'done' && !results.length && (
          <p className={note}>No provinces match “{placeText}”. Check the spelling, or type just its number, for example “12”.</p>
        )}
        <FieldError id={errorId} message={error} />
        <button type="button" onClick={searchAnywhere} className={textButton}>
          I don’t know my province
        </button>
      </>
    );
  }

  function parishStep(chosen: ChosenPlace) {
    const { search, results, total } = inPlace;
    const typed = search.status === 'done' ? text : '';
    const fuzzy = search.status === 'done' && search.response.fuzzy;
    return (
      <>
        <div className="flex flex-col gap-[4px]">
          <label htmlFor={id} className={stepLabel}>
            Your parish in {chosen.name}
          </label>
          <p id={hintId} className={hint}>
            Type part of its name to filter the list, or choose it from the list.
          </p>
        </div>
        {withdrawnNotice(true)}
        <DirectoryCombobox
          id={id}
          inputRef={inputRef}
          query={query}
          onQuery={setQuery}
          items={results}
          itemKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <span className="font-sans text-[15px] text-ink">{highlighted(item.name, typed)}</span>
              {belowPlace(item.chain, chosen.level) && <span className="font-sans text-[13px] leading-[1.4] text-muted">{belowPlace(item.chain, chosen.level)}</span>}
              {lookalikeNote(item.lookalikes) && <span className="font-sans text-[13px] font-semibold leading-[1.4] text-brand">{lookalikeNote(item.lookalikes)}</span>}
            </>
          )}
          onChoose={choose}
          resultsKey={search.status === 'done' ? search.key : null}
          more={moreOption(inPlace, 'parishes', PARISH_SEARCH.pageSize, PARISH_SEARCH.maxOffset, (shown, all) =>
            placeParishesAnnouncement({ total: all, fuzzy: false }, shown, chosen.name, text !== ''),
          )}
          notice={fuzzy && <p className="font-sans text-[13px] font-semibold text-ink">No exact match in {chosen.name}. Did you mean one of these?</p>}
          footer={
            total > results.length && (
              <p className={note}>
                Showing {results.length} of {total} parishes in {chosen.name}.
              </p>
            )
          }
          listLabel={`Parishes in ${chosen.name}`}
          describedBy={describedBy(hintId, error && errorId)}
          invalid={!!error}
          placeholder="Type to filter the list"
          maxLength={PARISH_SEARCH.maxLength}
        />
        {searchNotes(search, inPlace.slow, inPlace.retry, 'parish')}
        {search.status === 'done' && !results.length && (
          <p className={note}>
            {text
              ? `No parishes in ${chosen.name} match “${text}”. Check the spelling, or leave out “RCCG” or “Parish”.`
              : `Our list has no parishes in ${chosen.name}.`}
          </p>
        )}
        <FieldError id={errorId} message={error} />
        <button type="button" onClick={reportNotListed} className={textButton}>
          I can’t find my parish
        </button>
      </>
    );
  }

  function anywhereStep() {
    const { search } = anywhere;
    const results = search.status === 'done' ? search.response.results : [];
    const typed = search.status === 'done' ? text : '';
    const fuzzy = search.status === 'done' && search.response.fuzzy;
    const total = search.status === 'done' ? search.response.total : 0;
    return (
      <>
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
          <p className={note}>Searching every province.</p>
          <button type="button" onClick={changeProvince} className={textButton}>
            Choose your province instead
          </button>
        </div>
        <div className="flex flex-col gap-[4px]">
          <label htmlFor={id} className={stepLabel}>
            Your parish
          </label>
          <p id={hintId} className={hint}>
            Type your parish’s name and choose it from the list. Many parishes share a name, so you can add your province number, for example “Jesus House
            12”.
          </p>
        </div>
        {withdrawnNotice(true)}
        {state === OUTSIDE_NIGERIA && (
          <p className={note}>Our parish list covers Nigeria only for now. If your parish is outside Nigeria, choose “I can’t find my parish”.</p>
        )}
        <DirectoryCombobox
          id={id}
          inputRef={inputRef}
          query={query}
          onQuery={setQuery}
          items={results}
          itemKey={(item) => item.id}
          renderItem={(item) => (
            <>
              <span className="font-sans text-[15px] text-ink">{highlighted(item.name, typed)}</span>
              <span className="font-sans text-[13px] leading-[1.4] text-muted">{chainLine(item.chain)}</span>
              {lookalikeNote(item.lookalikes) && <span className="font-sans text-[13px] font-semibold leading-[1.4] text-brand">{lookalikeNote(item.lookalikes)}</span>}
            </>
          )}
          onChoose={choose}
          resultsKey={search.status === 'done' ? search.key : null}
          notice={fuzzy && <p className="font-sans text-[13px] font-semibold text-ink">No exact match. Did you mean one of these?</p>}
          footer={
            total > results.length && (
              <p className={note}>
                Showing {results.length} of {total}
                {rankState ? `, parishes in ${rankState} first` : ''}. Add your province number to narrow the list, or choose your province instead.
              </p>
            )
          }
          listLabel="Parishes"
          describedBy={describedBy(hintId, error && errorId)}
          invalid={!!error}
          placeholder="Start typing your parish’s name"
          maxLength={PARISH_SEARCH.maxLength}
        />
        {searchNotes(search, anywhere.slow, anywhere.retry, 'parish')}
        {search.status === 'done' && !results.length && (
          <p className={note}>No parishes match “{text}”. Check the spelling, leave out “RCCG” or “Parish”, or add your province number.</p>
        )}
        <FieldError id={errorId} message={error} />
        <button type="button" onClick={reportNotListed} className={textButton}>
          I can’t find my parish
        </button>
      </>
    );
  }

  function listedCard() {
    if (value?.kind !== 'listed') return null;
    const { confirmed } = value;
    // A gap in the list (no continent): shown as it is, and confirming it reports it to staff.
    const incomplete = !isChainComplete(value.chain);
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
            <p className="font-sans text-[12px] font-bold uppercase tracking-[0.08em] text-muted">{confirmed ? 'Your parish' : 'Check your parish'}</p>
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
          {value.lookalikes && value.lookalikes > 1 && (
            // D-55: the list has several parishes of this name here and nothing to tell them apart.
            <p className={note}>
              The RCCG list has {value.lookalikes} parishes called {value.name} here, with nothing to tell them apart. If yours is one of them, choose it: our team
              will match your application to the right one.
            </p>
          )}
          {value.changed && !confirmed && (
            <p className="font-sans text-[13px] font-semibold leading-[1.5] text-brand">These details have changed since you chose this parish. Check them, then confirm again.</p>
          )}
          {incomplete && (
            <p className="font-sans text-[13px] font-semibold leading-[1.5] text-brand">
              {confirmed
                ? 'Our list doesn’t show this parish’s continent yet. We’ve asked the Programme team to complete its details.'
                : 'Our list doesn’t show this parish’s continent yet. If it’s your parish, confirm it and we’ll ask the Programme team to complete its details.'}
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
                  onChange({ ...value, confirmed: true, changed: false, detailsWrong: value.detailsWrong || incomplete });
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
          {!incomplete && (
            <button type="button" aria-pressed={value.detailsWrong} onClick={() => onChange({ ...value, detailsWrong: !value.detailsWrong })} className={textButton}>
              Details look wrong? Tell us
            </button>
          )}
          {value.detailsWrong && !incomplete && (
            <p className={note}>
              {confirmed
                ? 'Thanks: the Programme team will check this parish’s details. You can continue.'
                : 'Thanks: the Programme team will check this parish’s details. Confirm it’s your parish to continue.'}
            </p>
          )}
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
        <label htmlFor={manualId} className={stepLabel}>
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
          {place
            ? `It isn’t on our list yet, so the Programme team will look for it in ${placeLabel(place)}. You can still continue.`
            : province?.kind === 'withdrawn'
              ? `It isn’t on our list yet, so the Programme team will check it. ${province.name}, which you chose, is no longer on our list, so we’ll send the name on its own. You can still continue.`
              : 'It isn’t on our list yet, so the Programme team will check it. You can still continue.'}
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
          {place ? `Find it in ${place.name}’s list instead` : 'Search the list instead'}
        </button>
      </div>
    );
  }
}
