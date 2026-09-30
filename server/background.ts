/**
 * Work a request starts but doesn't wait for, so its response time can't reveal what the work
 * was (for example whether an address belongs to a staff account). Tasks are tracked: the app
 * waits for them when it closes, and tests can wait with `backgroundIdle()`.
 */
const pending = new Set<Promise<void>>();

export function runInBackground(task: () => Promise<unknown>, onError: (error: unknown) => void): void {
  const running: Promise<void> = Promise.resolve()
    .then(task)
    .then(
      () => undefined,
      (error: unknown) => onError(error),
    )
    .finally(() => pending.delete(running));
  pending.add(running);
}

/** Resolves once every background task (including ones started meanwhile) has finished. */
export async function backgroundIdle(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
