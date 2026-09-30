/**
 * `node server-dist/worker.js`: runs background jobs (campaign dispatch, push delivery,
 * clean-up) as its own process. Use with WORKER_MODE=off on the web process. Several workers
 * can run at once: jobs are claimed with FOR UPDATE SKIP LOCKED.
 * SIGTERM/SIGINT: stop claiming, let running jobs finish (up to 20 s), hand the rest back.
 */
import { createServices, errorForLog } from './app';
import { ConfigError, loadConfig, loadDotEnv } from './config';
import { createDb } from './db';
import { Worker } from './jobs/worker';
import { migrate } from './migrate';

loadDotEnv();
try {
  const config = loadConfig();
  const db = await createDb(config);
  if (config.runMigrations) await migrate(db, (message) => console.log(message));
  const services = createServices(config, db);
  const log = { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) };
  const worker = new Worker(services, { pollMs: config.worker.pollMs, log });
  await worker.start();
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received; stopping the worker`);
    await worker.stop(20_000);
    await db.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
} catch (error) {
  console.error(error instanceof ConfigError ? `Configuration error: ${error.message}` : error instanceof Error ? errorForLog(error) : error);
  process.exit(1);
}
