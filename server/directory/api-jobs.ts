/**
 * The worker's side of the RCCG directory API: a sync every DIRECTORY_SYNC_INTERVAL_MINUTES (one
 * job per interval slot, so restarts and several workers never double it), plus the extra run a
 * submission queues when it finds the local copy behind the provider. A failed sync is recorded
 * and simply tried again at the next slot: never in a tight loop.
 */
import type { AppConfig } from '../config';
import type { Queryable } from '../db';
import { enqueue } from '../jobs/queue';
import type { Services } from '../services';
import { syncDirectory } from './api-sync';

export const DIRECTORY_SYNC_JOB = 'directory.sync';

type Log = { info: (message: string) => void; warn: (message: string) => void };

/** Queues the sync for the slot after `from` (or the slot `from` is in, with `now`). */
export async function scheduleDirectorySync(db: Queryable, config: AppConfig, from = new Date(), options: { now?: boolean } = {}) {
  if (!config.directoryApi) return;
  const interval = config.directoryApi.syncIntervalMinutes * 60_000;
  const slot = Math.floor(from.getTime() / interval) + (options.now ? 0 : 1);
  const runAt = options.now ? from : new Date(slot * interval);
  await enqueue(db, { kind: DIRECTORY_SYNC_JOB, runAt, dedupeKey: `${DIRECTORY_SYNC_JOB}:${slot}`, maxAttempts: 1 });
}

/** One run: sync, log what happened (figures and codes only), and queue the next one. */
export async function runDirectorySync(services: Services, log: Log): Promise<void> {
  if (!services.directory) return;
  try {
    const result = await syncDirectory(services.db, services.directory, { via: 'sync' });
    if (result.status === 'applied') {
      const { units, parishes, issues, handover } = result.counts;
      log.info(
        `Directory synced to release ${result.release}: parishes +${parishes.created} ~${parishes.updated + parishes.moved} -${parishes.deactivated}, ` +
          `units +${units.created} ~${units.updated + units.moved} -${units.deactivated}, kept ${units.kept + parishes.kept}, ` +
          `${issues} issue(s)${handover ? ', old list handed over' : ''}`,
      );
    } else if (result.status === 'failed') {
      log.warn(`Directory sync failed (${result.error}); the last good state stays in use`);
    }
  } finally {
    await scheduleDirectorySync(services.db, services.config);
  }
}
