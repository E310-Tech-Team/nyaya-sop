/** `pnpm db:migrate` (built) / `pnpm db:migrate:dev` (source): apply pending migrations and exit. */
import { loadConfig, loadDotEnv } from './config';
import { createDb } from './db';
import { migrate } from './migrate';

loadDotEnv();
const config = loadConfig();
const db = await createDb(config);
try {
  const applied = await migrate(db, (message) => console.log(message));
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Done: nothing to apply.');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
