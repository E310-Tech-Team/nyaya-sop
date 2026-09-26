import { useCallback, useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> = { data: T | undefined; error: unknown; loading: boolean; reload: () => void };

/**
 * Loads data for a screen and cancels the request when the inputs change or the screen goes
 * away. Keeps the previous data while reloading, so lists don't flash empty.
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    load(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ data, error: null, loading: false }),
      (error: unknown) => !controller.signal.aborted && setState((previous) => ({ data: previous.data, error, loading: false })),
    );
    return () => controller.abort();
  }, [...deps, version]); // the caller lists what `load` depends on
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
