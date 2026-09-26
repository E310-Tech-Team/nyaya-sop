import { readdir, readFile } from 'node:fs/promises';
import type { Db } from './db';

// Copied next to the bundle by scripts/build-server.mjs, so this resolves in dev and in production.
const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.sql$/;
// Arbitrary constant so concurrent app instances don't migrate at the same time.
const ADVISORY_LOCK_KEY = 72_150_931;

export type MigrationLog = (message: string) => void;

/** Applies pending migrations in filename order, each in its own transaction. Returns the versions applied. */
export async function migrate(db: Db, log: MigrationLog = () => {}): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => MIGRATION_FILE.test(file)).sort();
  const applied: string[] = [];

  await db.withConnection(async (connection) => {
    await connection.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      await connection.exec(`create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )`);
      const done = new Set(
        (await connection.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version),
      );

      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (done.has(version)) continue;
        const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
        await connection.exec('begin');
        try {
          await connection.exec(sql);
          await connection.query('insert into schema_migrations (version) values ($1)', [version]);
          await connection.exec('commit');
        } catch (error) {
          await connection.exec('rollback');
          throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
        }
        applied.push(version);
        log(`Applied migration ${version}`);
      }
    } finally {
      await connection.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  });

  if (applied.length === 0) log('Database schema is up to date');
  return applied;
}
