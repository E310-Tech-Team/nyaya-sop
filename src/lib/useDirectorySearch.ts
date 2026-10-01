/**
 * Searching the parish directory as the applicant types (the parish question, src/components/ParishPicker.tsx):
 * debounced, an earlier request cancelled by a newer one, "Searching…" only when slow, given up
 * after 8 seconds, and tried again when the connection comes back. `usePagedSearch` adds "Show more".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

const DEBOUNCE_MS = 250;
// "Searching…" appears only when a search is slow, so fast results don't flicker.
const SLOW_MS = 300;
const TIMEOUT_MS = 8_000;

export type SearchFailure = 'offline' | 'busy' | 'failed';

export type SearchState<R> =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'done'; key: string; response: R }
  | { status: 'error'; key: string; reason: SearchFailure };

const failureOf = (caught: unknown): SearchFailure =>
  navigator.onLine === false ? 'offline' : caught instanceof ApiError && caught.code === 'RATE_LIMITED' ? 'busy' : 'failed';

/**
 * The latest answer for `key` (null: nothing to search). `key` names everything the search depends
 * on; `run` fetches it (the latest `run` is used, so it may be a new function each render).
 */
export function useDirectorySearch<R>(key: string | null, run: (signal: AbortSignal) => Promise<R>) {
  const [search, setSearch] = useState<SearchState<R>>({ status: 'idle' });
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (key === null) {
      setSearch({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    let timedOut = false;
    let slowTimer = 0;
    let timeoutTimer = 0;
    const debounce = window.setTimeout(() => {
      setSearch({ status: 'loading', key });
      slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);
      timeoutTimer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);
      runRef
        .current(controller.signal)
        .then((response) => {
          // Answers to an earlier search (typed over, or a choice made meanwhile) never replace newer state.
          if (controller.signal.aborted) return;
          setSearch({ status: 'done', key, response });
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted && !timedOut) return; // a newer search replaced it
          setSearch({ status: 'error', key, reason: failureOf(caught) });
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
  }, [key, attempt]);

  // Offline: search again as soon as the connection is back.
  const offline = search.status === 'error' && search.reason === 'offline';
  useEffect(() => {
    if (!offline) return;
    const retry = () => setAttempt((count) => count + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { search, slow, retry };
}

type Page<T> = { results: T[]; total: number };

/**
 * A search whose answer comes a page at a time ("Show 20 more"): `results` is every page fetched for
 * the current search, `total` how many there are in all. Pages are fetched by offset, in choices.
 */
export function usePagedSearch<T extends { id: string }, R extends Page<T>>(key: string | null, run: (offset: number, signal: AbortSignal) => Promise<R>) {
  const { search, slow, retry } = useDirectorySearch<R>(key, (signal) => run(0, signal));
  // Every result shown so far for `key`, once a later page has been added.
  const [extra, setExtra] = useState<{ key: string; results: T[]; total: number } | null>(null);
  const [more, setMore] = useState<{ key: string; status: 'loading' | 'failed' } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  // A new search: a page still loading for the old one is dropped.
  useEffect(() => () => controller.current?.abort(), [key]);

  const done = search.status === 'done' ? search : null;
  const pages = done && extra?.key === done.key ? extra : null;
  const results = pages ? pages.results : done ? withoutRepeats(done.response.results) : [];
  const total = Math.max(pages?.total ?? done?.response.total ?? 0, results.length);
  const moreStatus: 'idle' | 'loading' | 'failed' = done && more?.key === done.key ? more.status : 'idle';

  /** Fetches the next page; resolves to how many are shown and in all once it's there (null if not). */
  const showMore = (): Promise<{ shown: number; total: number } | null> => {
    if (!done || moreStatus === 'loading' || results.length >= total) return Promise.resolve(null);
    const forKey = done.key;
    const shownBefore = results;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      current.abort();
    }, TIMEOUT_MS);
    setMore({ key: forKey, status: 'loading' });
    return runRef
      .current(shownBefore.length, current.signal)
      .then((page) => {
        if (current.signal.aborted) return null;
        const merged = withoutRepeats([...shownBefore, ...page.results]);
        setExtra({ key: forKey, results: merged, total: page.total });
        setMore(null);
        return { shown: merged.length, total: Math.max(page.total, merged.length) };
      })
      .catch(() => {
        if (!current.signal.aborted || timedOut) setMore({ key: forKey, status: 'failed' });
        return null;
      })
      .finally(() => window.clearTimeout(timeout));
  };

  return { search, slow, retry, results, total, more: moreStatus, showMore };
}

/** Each entry once (a list that changed between pages can repeat one). */
function withoutRepeats<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
