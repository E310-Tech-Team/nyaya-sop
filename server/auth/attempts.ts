/**
 * A staff account's attempt budget, shared by passwords and every second-step method (app codes,
 * recovery codes, email codes, passkeys), in every session: five wrong answers lock the account.
 */
import type { Queryable } from '../db';

export const LOCK_AFTER_FAILURES = 5;

/** How long a lock lasts: 15 minutes at the limit, doubling with each further failure, at most 24 hours. */
const LOCK_LENGTH = (count: string) => `least(interval '24 hours', interval '15 minutes' * power(2, ${count} - $2::int))`;

export type Attempt = { count: number; relocked: boolean };

/**
 * Takes one attempt from the account's budget BEFORE a password or code is checked, in one
 * statement, so requests racing each other can't get past the lockout. Below the limit each
 * attempt counts. Once a lock has run out, one attempt at a time gets through: it re-locks the
 * account as it passes (for longer each time), and a correct answer lifts that again. Null while
 * the account is locked.
 */
export async function takeAttempt(db: Queryable, staffId: string): Promise<Attempt | null> {
  const { rows } = await db.query<{ count: number }>(
    `update staff_users
        set failed_login_count = failed_login_count + 1,
            locked_until = case when failed_login_count >= $2::int then now() + ${LOCK_LENGTH('(failed_login_count + 1)')} else locked_until end
      where id = $1 and (locked_until is null or locked_until <= now())
        and (failed_login_count < $2::int or locked_until is not null)
      returning failed_login_count as count`,
    [staffId, LOCK_AFTER_FAILURES],
  );
  const count = rows[0]?.count;
  return count === undefined ? null : { count, relocked: count > LOCK_AFTER_FAILURES };
}

/** A wrong answer: the attempt stays counted, and the one that reaches the limit locks the account. */
export async function attemptFailed(db: Queryable, staffId: string, attempt: Attempt): Promise<void> {
  if (attempt.relocked || attempt.count < LOCK_AFTER_FAILURES) return;
  await db.query(`update staff_users set locked_until = now() + ${LOCK_LENGTH('$3::int')} where id = $1`, [staffId, LOCK_AFTER_FAILURES, attempt.count]);
}

/** A right password that still needs the second factor: the attempt is handed back, and a lock it set is lifted. */
export async function attemptReturned(db: Queryable, staffId: string, attempt: Attempt): Promise<void> {
  await db.query(
    `update staff_users set failed_login_count = greatest(failed_login_count - 1, 0), locked_until = case when $2::boolean then now() else locked_until end where id = $1`,
    [staffId, attempt.relocked],
  );
}

/** Signed in (or reset) with every factor: the budget starts again. */
export const clearAttempts = (db: Queryable, staffId: string) =>
  db.query('update staff_users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = $1', [staffId]);

/** A right answer while already signed in (a check before a security change): the budget starts again. */
export const resetAttempts = (db: Queryable, staffId: string) =>
  db.query('update staff_users set failed_login_count = 0, locked_until = null where id = $1', [staffId]);
