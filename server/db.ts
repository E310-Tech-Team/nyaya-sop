import { mkdir } from 'node:fs/promises';
import pg from 'pg';
import type { AppConfig } from './config';

export type Row = Record<string, unknown>;

export interface Queryable {
  /** One statement, `$1`-style parameters. */
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Several statements, no parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly driver: 'postgres' | 'pglite';
  /** Runs `fn` on a single connection (needed for session-level locks and transactions). */
  withConnection<T>(fn: (connection: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function createPostgresDb(options: Extract<AppConfig['database'], { driver: 'postgres' }>): Db {
  // With no connectionString, node-postgres reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT.
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
    max: options.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'school-of-purpose',
  });

  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T extends Row>(text: string, params?: unknown[]) {
      const result = await client.query(text, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await client.query(sql); // no params → simple protocol → multiple statements allowed
    },
  });

  return {
    driver: 'postgres',
    ...wrap(pool),
    async withConnection(fn) {
      const client = await pool.connect();
      try {
        return await fn(wrap(client));
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded Postgres (WASM) for local development and tests. Never used in production. */
export async function createPgliteDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  // Parish search uses trigram matching (migration 0007); production Postgres has it built in.
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  if (!dataDir.startsWith('memory://')) await mkdir(dataDir, { recursive: true });
  const lite = new PGlite(dataDir, { extensions: { pg_trgm } });
  await lite.waitReady;

  const queryable: Queryable = {
    async query<T extends Row>(text: string, params?: unknown[]) {
      const result = await lite.query<T>(text, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await lite.exec(sql);
    },
  };

  return {
    driver: 'pglite',
    ...queryable,
    withConnection: (fn) => fn(queryable), // PGlite is a single connection already
    close: () => lite.close(),
  };
}

export async function createDb(config: AppConfig): Promise<Db> {
  return config.database.driver === 'postgres'
    ? createPostgresDb(config.database)
    : createPgliteDb(config.database.dataDir);
}
