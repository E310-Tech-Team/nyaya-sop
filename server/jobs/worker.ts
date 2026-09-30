/**
 * Background worker: claims due jobs and runs them. Runs inside the web process
 * (WORKER_MODE=inline, the default) or as its own process (server/worker-cli.ts, used by the
 * docker-compose "worker" service with WORKER_MODE=off on the web container).
 */
import { randomUUID } from 'node:crypto';
import { NOTIFICATION_CONSENT_VERSION } from '../../src/shared/platform';
import type { Queryable } from '../db';
import { deliverBatch, dispatchCampaign } from '../notifications/dispatch';
import type { Services } from '../services';
import { setHeartbeat } from '../settings';
import { claimJobs, completeJob, enqueue, extendLease, failJob, releaseJob, type JobRow } from './queue';

type Log = { info: (message: string) => void; warn: (message: string) => void; error: (message: string) => void };

const LEASE_MS = 120_000;

/** Retention (docs/05-Backend-Schema.md). */
export async function cleanup(db: Queryable): Promise<void> {
  // A subscription past the expiry its browser gave can't be delivered to: switch it off, as a
  // push service's "gone" would (with the same consent record).
  await db.query(
    `with expired as (
       update push_subscriptions set status = 'expired', deactivated_at = now(), deactivated_reason = 'expired', updated_at = now()
        where status = 'active' and expiration_time < now()
       returning id, account_id, topics
     )
     insert into notification_consent_events (subscription_id, account_id, action, topics, consent_version)
     select id, account_id, 'expired', topics, $1 from expired`,
    [NOTIFICATION_CONSENT_VERSION],
  );
  await db.exec(`
    delete from auth_tokens where expires_at < now() - interval '7 days';
    delete from staff_sessions where (revoked_at is not null or expires_at < now()) and created_at < now() - interval '30 days';
    delete from applicant_sessions where (revoked_at is not null or expires_at < now()) and created_at < now() - interval '30 days';
    delete from analytics_events where created_at < now() - interval '13 months';
    delete from jobs where status in ('succeeded', 'cancelled') and updated_at < now() - interval '30 days';
    delete from jobs where status = 'failed' and updated_at < now() - interval '90 days';
    delete from notification_deliveries where created_at < now() - interval '180 days';
    delete from notification_messages where origin <> 'campaign' and created_at < now() - interval '180 days';
    delete from push_subscriptions where status <> 'active' and deactivated_at < now() - interval '180 days';
  `);
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export async function scheduleMaintenance(db: Queryable, from = new Date()) {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 2, 0)); // 02:00 UTC = 03:00 Lagos
  await enqueue(db, { kind: 'maintenance.cleanup', runAt: next, dedupeKey: `maintenance.cleanup:${dayKey(next)}`, maxAttempts: 3 });
}

export class Worker {
  readonly id = `worker-${randomUUID().slice(0, 8)}`;
  #timer: NodeJS.Timeout | null = null;
  #stopping = false;
  #running = new Map<string, Promise<void>>();
  #lastHeartbeat = 0;

  constructor(
    private readonly services: Services,
    private readonly options: { pollMs: number; batch?: number; log: Log },
  ) {}

  readonly handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>> = {
    'campaign.dispatch': (payload) => dispatchCampaign(this.services, String(payload.campaignId)),
    'push.deliver': (payload) =>
      deliverBatch(this.services, {
        messageId: String(payload.messageId),
        deliveryIds: Array.isArray(payload.deliveryIds) ? (payload.deliveryIds as string[]) : [],
        attempt: Number(payload.attempt) || 1,
      }),
    'maintenance.cleanup': async () => {
      await cleanup(this.services.db);
      await scheduleMaintenance(this.services.db);
    },
  };

  async start(): Promise<void> {
    await scheduleMaintenance(this.services.db, new Date(Date.now() - 86_400_000)); // today's run, if not queued yet
    const tick = async () => {
      if (this.#stopping) return;
      try {
        await this.runOnce();
      } catch (error) {
        this.options.log.error(`Worker loop error: ${(error as Error).message}`);
      }
      if (!this.#stopping) this.#timer = setTimeout(tick, this.options.pollMs);
    };
    this.#timer = setTimeout(tick, 0);
    this.options.log.info(`Background worker ${this.id} started`);
  }

  /** Claims and runs one round of due jobs. Returns how many ran. */
  async runOnce(): Promise<number> {
    const { db } = this.services;
    if (Date.now() - this.#lastHeartbeat > 30_000) {
      this.#lastHeartbeat = Date.now();
      await setHeartbeat(db, 'worker');
    }
    const jobs = await claimJobs(db, this.id, this.options.batch ?? 4, LEASE_MS);
    await Promise.all(jobs.map((job) => this.#track(job)));
    return jobs.length;
  }

  #track(job: JobRow): Promise<void> {
    const promise = this.#run(job).finally(() => this.#running.delete(job.id));
    this.#running.set(job.id, promise);
    return promise;
  }

  async #run(job: JobRow): Promise<void> {
    const { db } = this.services;
    const handler = this.handlers[job.kind];
    if (!handler) {
      await failJob(db, job, this.id, `unknown job kind ${job.kind}`, { retryable: false });
      return;
    }
    const keepAlive = setInterval(() => void extendLease(db, job.id, this.id, LEASE_MS).catch(() => {}), LEASE_MS / 3);
    try {
      await handler(job.payload);
      await completeJob(db, job.id, this.id);
    } catch (error) {
      const outcome = await failJob(db, job, this.id, (error as Error).message ?? 'error', { retryable: true });
      this.options.log.warn(`Job ${job.kind} #${job.id} failed (${outcome}): ${(error as Error).message}`);
    } finally {
      clearInterval(keepAlive);
    }
  }

  /** Stops claiming; waits for running jobs up to `timeoutMs`, then hands unfinished ones back. */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    const running = [...this.#running.entries()];
    await Promise.race([Promise.allSettled(running.map(([, promise]) => promise)), new Promise((r) => setTimeout(r, timeoutMs))]);
    for (const [id] of this.#running) await releaseJob(this.services.db, id, this.id).catch(() => {});
  }
}
