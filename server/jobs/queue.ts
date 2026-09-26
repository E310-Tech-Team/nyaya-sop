/**
 * A small PostgreSQL job queue (no extra infrastructure).
 * - Claiming is atomic: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED), so two workers
 *   never take the same job.
 * - A claimed job holds a lease (locked_until). If its worker dies or restarts, the lease runs
 *   out and the job is claimed again: delivery is at-least-once, never exactly-once, so job
 *   handlers must be idempotent (they are: see notifications/dispatch.ts).
 * - Enqueueing with a dedupe_key is idempotent.
 * - Failures retry with exponential backoff and jitter up to max_attempts.
 */
import type { Queryable } from '../db';

export type JobRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_at: Date;
};

export async function enqueue(
  db: Queryable,
  job: { kind: string; payload?: Record<string, unknown>; runAt?: Date; dedupeKey?: string; maxAttempts?: number },
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `insert into jobs (kind, payload, run_at, dedupe_key, max_attempts)
     values ($1, $2, coalesce($3, now()), $4, coalesce($5, 6))
     on conflict (dedupe_key) do nothing
     returning id::text as id`, // bigint: pg returns a string, PGlite a BigInt; text keeps both the same
    [job.kind, JSON.stringify(job.payload ?? {}), job.runAt ?? null, job.dedupeKey ?? null, job.maxAttempts ?? null],
  );
  return rows[0]?.id ?? null;
}

/** Claims up to `limit` due jobs, including running jobs whose lease has expired. */
export async function claimJobs(db: Queryable, workerId: string, limit: number, leaseMs: number): Promise<JobRow[]> {
  const { rows } = await db.query<JobRow>(
    `update jobs
        set status = 'running', locked_by = $1, locked_until = now() + make_interval(secs => $3::double precision / 1000),
            attempts = attempts + 1, updated_at = now()
      where id in (
        select id from jobs
         where (status = 'pending' and run_at <= now())
            or (status = 'running' and locked_until < now())
         order by run_at, id
         limit $2
         for update skip locked)
      returning id::text as id, kind, payload, attempts, max_attempts, run_at`,
    [workerId, limit, leaseMs],
  );
  return rows;
}

/** Keeps a long-running job's lease alive. Returns false if the job was taken away (e.g. cancelled). */
export async function extendLease(db: Queryable, id: string, workerId: string, leaseMs: number): Promise<boolean> {
  const { rows } = await db.query(
    `update jobs set locked_until = now() + make_interval(secs => $3::double precision / 1000), updated_at = now()
      where id = $1 and status = 'running' and locked_by = $2 returning id`,
    [id, workerId, leaseMs],
  );
  return rows.length === 1;
}

export async function completeJob(db: Queryable, id: string, workerId: string): Promise<void> {
  await db.query(
    `update jobs set status = 'succeeded', finished_at = now(), locked_by = null, locked_until = null, updated_at = now()
      where id = $1 and locked_by = $2 and status = 'running'`,
    [id, workerId],
  );
}

/** Exponential backoff: ~30 s, 1 min, 2 min, 4 min … capped at 1 h, ±20 % jitter. */
export function backoffMs(attempt: number, retryAfterSeconds?: number | null): number {
  const base = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  const jittered = base * (0.8 + Math.random() * 0.4);
  return Math.max(jittered, (retryAfterSeconds ?? 0) * 1000);
}

/**
 * Records a failure. Retryable failures go back to pending with backoff until max_attempts;
 * then (or for permanent failures) the job ends as failed.
 */
export async function failJob(
  db: Queryable,
  job: Pick<JobRow, 'id' | 'attempts' | 'max_attempts'>,
  workerId: string,
  error: string,
  options: { retryable: boolean; retryAfterSeconds?: number | null } = { retryable: true },
): Promise<'retrying' | 'failed'> {
  const retry = options.retryable && job.attempts < job.max_attempts;
  await db.query(
    `update jobs set status = $3::job_status, last_error = left($4, 300), locked_by = null, locked_until = null, updated_at = now(),
            run_at = case when $3::job_status = 'pending' then now() + make_interval(secs => $5::double precision / 1000) else run_at end,
            finished_at = case when $3::job_status = 'failed' then now() else null end
      where id = $1 and locked_by = $2 and status = 'running'`,
    [job.id, workerId, retry ? 'pending' : 'failed', error, backoffMs(job.attempts, options.retryAfterSeconds)],
  );
  return retry ? 'retrying' : 'failed';
}

/** Puts a claimed job back without counting the attempt (graceful shutdown). */
export async function releaseJob(db: Queryable, id: string, workerId: string): Promise<void> {
  await db.query(
    `update jobs set status = 'pending', attempts = greatest(attempts - 1, 0), locked_by = null, locked_until = null, updated_at = now()
      where id = $1 and locked_by = $2 and status = 'running'`,
    [id, workerId],
  );
}

/** Cancels pending jobs matching a payload field (e.g. every job of a cancelled campaign). */
export async function cancelPendingJobs(db: Queryable, kind: string, key: string, value: string): Promise<number> {
  const { rows } = await db.query(
    `update jobs set status = 'cancelled', finished_at = now(), updated_at = now()
      where kind = $1 and status = 'pending' and payload->>$2 = $3 returning id`,
    [kind, key, value],
  );
  return rows.length;
}

export async function queueStats(db: Queryable) {
  const { rows } = await db.query<{ status: string; n: number; oldest: Date | null }>(
    `select status::text as status, count(*)::int as n, min(case when status = 'pending' then run_at end) as oldest
       from jobs where status in ('pending', 'running') or (status = 'failed' and updated_at > now() - interval '7 days')
      group by status`,
  );
  const get = (status: string) => rows.find((row) => row.status === status);
  return {
    pending: get('pending')?.n ?? 0,
    running: get('running')?.n ?? 0,
    failedLast7Days: get('failed')?.n ?? 0,
    oldestPendingAt: get('pending')?.oldest ?? null,
  };
}
