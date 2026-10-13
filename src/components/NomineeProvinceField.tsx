import { useEffect, useRef, useState } from 'react';
import type { UnitSuggestion } from '../shared/directory';
import { getUnit, searchUnits } from '../lib/api';
import { usePagedSearch } from '../lib/useDirectorySearch';
import { DirectoryCombobox } from './DirectoryCombobox';
import { FieldError, QuestionNumber, describedBy } from './Fields';

type Props = {
  id: string;
  number: string;
  state: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
};

export function NomineeProvinceField({ id, number, state, value, onChange, error }: Props) {
  const [query, setQuery] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const searchText = query.trim();
  const searchKey = value || !state || !searchText ? null : `${state}\n${searchText}`;
  const search = usePagedSearch<UnitSuggestion, Awaited<ReturnType<typeof searchUnits>>>(
    searchKey,
    (offset, signal) => searchUnits(searchText, state, offset, signal, 'province'),
  );
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const statusId = `${id}-status`;
  const currentSearchDone = search.search.status === 'done' && search.search.key === searchKey;
  const searchErrorReason =
    search.search.status === 'error' && search.search.key === searchKey ? search.search.reason : null;
  const currentSearchError = searchErrorReason !== null;
  const currentResults = currentSearchDone ? search.results : [];
  const currentTotal = currentSearchDone ? search.total : 0;
  const resultsKey = search.search.status === 'done' && search.search.key === searchKey ? search.search.key : null;

  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    setRestoring(true);
    setRestoreError('');
    void getUnit(value, controller.signal)
      .then((unit) => {
        if (!controller.signal.aborted && unit.level === 'province') setQuery(unit.name);
        else if (!controller.signal.aborted) {
          setRestoreError('The selected province could not be confirmed. Search and select it again.');
          onChangeRef.current('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRestoreError('The selected province could not be loaded. Search and select it again.');
          onChangeRef.current('');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, [value]);

  const searchStatusText =
    search.search.status === 'loading' && search.search.key === searchKey
      ? search.slow
        ? 'Searching provinces…'
        : ''
      : searchErrorReason
        ? searchErrorReason === 'offline'
          ? 'You appear to be offline. The province search will retry when you reconnect.'
          : searchErrorReason === 'busy'
            ? 'The province search is busy. Please try again shortly.'
            : 'The province list could not be loaded. Please try again.'
        : currentSearchDone
            ? currentResults.length
              ? `Showing ${currentResults.length} of ${currentTotal} provinces.`
            : 'No provinces matched. Try another search.'
          : '';
  const statusText = restoreError || searchStatusText;

  return (
    <fieldset className="flex w-full min-w-0 flex-col gap-[13px]" aria-describedby={describedBy(hintId, error && errorId, statusId)}>
      <legend className="flex w-full items-start gap-[11px]">
        <QuestionNumber n={number} />
        <span className="flex flex-1 flex-col gap-[4px] pt-[4px]">
          <span className="font-sans text-[15px] leading-[1.4] text-ink">
            Nominee’s RCCG province <span className="text-brand" aria-hidden="true"> *</span>
          </span>
          <span id={hintId} className="font-sans text-[12px] leading-[1.45] text-muted">
            {state
              ? `Type the province name or number, such as “Lagos Province 12” or “LP 12”. Provinces in ${state} appear first.`
              : 'Select the nominee’s state of residence first; provinces in that state will appear first.'}
          </span>
        </span>
      </legend>
      <DirectoryCombobox
        id={id}
        query={query}
        onQuery={(next) => {
          setRestoreError('');
          setQuery(next);
          if (value) onChange('');
        }}
        items={restoreError ? [] : currentResults}
        itemKey={(unit) => unit.id}
        renderItem={(unit) => (
          <>
            <span className="font-sans text-[14px] font-semibold text-ink">{unit.name}</span>
            {unit.chain.region && <span className="font-sans text-[12px] text-muted">{unit.chain.region.name}</span>}
          </>
        )}
        onChoose={(unit) => {
          setRestoreError('');
          setQuery(unit.name);
          onChange(unit.id);
        }}
        resultsKey={resultsKey}
        more={
          currentResults.length < currentTotal
            ? {
                label: `Show ${Math.min(12, currentTotal - currentResults.length)} more provinces`,
                onShow: () => void search.showMore(),
              }
            : null
        }
        notice={
          currentSearchError ? (
            <p className="font-sans text-[12px] text-muted">{statusText}</p>
          ) : undefined
        }
        footer={
          currentSearchDone ? (
            <p className="font-sans text-[12px] text-muted">{statusText}</p>
          ) : undefined
        }
        listLabel="RCCG province suggestions"
        describedBy={describedBy(hintId, error && errorId, statusId)}
        invalid={!!error}
        placeholder="Type a province name"
        maxLength={60}
      />
      {restoreError && <p className="font-sans text-[12px] text-brand">{restoreError}</p>}
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {restoring ? 'Loading the selected province.' : statusText}
      </p>
      {currentSearchError && search.search.status === 'error' && search.search.reason !== 'offline' && (
        <button type="button" onClick={search.retry} className="w-fit font-sans text-[13px] font-semibold text-brand underline underline-offset-2">
          Try province search again
        </button>
      )}
      {currentSearchDone && search.more === 'failed' && (
        <button type="button" onClick={() => void search.showMore()} className="w-fit font-sans text-[13px] font-semibold text-brand underline underline-offset-2">
          Try loading more provinces again
        </button>
      )}
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}
