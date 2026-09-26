import { buildApp, createServices } from './app';
import { ConfigError, loadConfig, loadDotEnv } from './config';
import { createDb } from './db';
import { Worker } from './jobs/worker';
import { migrate } from './migrate';

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const db = await createDb(config);
  const services = createServices(config, db);
  const app = await buildApp({ config, db, services });

  if (config.database.driver === 'pglite') {
    app.log.warn(
      `Using the embedded development database in ${config.database.dataDir}. Set DATABASE_URL to use PostgreSQL.`,
    );
  }
  if (config.runMigrations) await migrate(db, (message) => app.log.info(message));
  if (!services.email.canSend) app.log.warn('Email is not configured: applicant sign-in and emailed staff invitations are off.');
  if (!services.push) app.log.warn('VAPID keys are not configured: push notifications are off.');

  await app.listen({ host: config.host, port: config.port });

  // WORKER_MODE=inline (default) runs background jobs in this process; "off" leaves them to
  // a separate worker process (server/worker-cli.ts).
  const worker =
    config.worker.mode === 'inline'
      ? new Worker(services, { pollMs: config.worker.pollMs, log: { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m), error: (m) => app.log.error(m) } })
      : null;
  await worker?.start();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received; finishing in-flight requests and jobs`);
    const forceExit = setTimeout(() => process.exit(1), 15_000);
    forceExit.unref();
    await app.close();
    await worker?.stop(10_000);
    await db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? `Configuration error: ${error.message}` : error);
  process.exit(1);
});
