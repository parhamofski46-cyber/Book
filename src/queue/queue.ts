import { query, transaction } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export type JobType =
  | 'shop.install'
  | 'catalogue.scan'
  | 'product.process'
  | 'subscription.sync';

export interface Job<P = Record<string, unknown>> {
  id: number;
  shop_id: number | null;
  type: JobType;
  payload: P;
  status: 'queued' | 'running' | 'done' | 'failed';
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  last_error: string | null;
  dedupe_key: string | null;
}

export interface EnqueueOptions {
  shopId?: number | null;
  /** Lower runs first. 10 = merchant is waiting, 100 = normal, 200 = bulk backfill. */
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Collapses duplicates while a matching job is queued or running. A product
   * saved five times in a minute should be described once, not five times.
   */
  dedupeKey?: string;
}

const log = logger.child({ component: 'queue' });

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<number | null> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO jobs (shop_id, type, payload, priority, run_at, max_attempts, dedupe_key)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running')
       DO NOTHING
     RETURNING id`,
    [
      opts.shopId ?? null,
      type,
      JSON.stringify(payload),
      opts.priority ?? 100,
      opts.runAt ?? new Date(),
      opts.maxAttempts ?? 5,
      opts.dedupeKey ?? null,
    ],
  );

  const id = rows[0]?.id ?? null;
  if (id === null) {
    log.debug('job deduplicated', { type, dedupeKey: opts.dedupeKey });
  }
  return id;
}

/**
 * Claims up to `limit` due jobs for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several workers share one table with no
 * broker: each transaction takes rows nobody else has locked and skips the rest
 * instead of blocking behind them.
 */
export async function claim(workerId: string, limit: number): Promise<Job[]> {
  return transaction(async (client) => {
    const { rows } = await client.query<Job>(
      `WITH due AS (
         SELECT id FROM jobs
          WHERE status = 'queued' AND run_at <= now()
          ORDER BY priority ASC, run_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j
          SET status = 'running',
              attempts = j.attempts + 1,
              locked_at = now(),
              locked_by = $1
         FROM due
        WHERE j.id = due.id
       RETURNING j.id, j.shop_id, j.type, j.payload, j.status, j.priority,
                 j.attempts, j.max_attempts, j.run_at, j.last_error, j.dedupe_key`,
      [workerId, limit],
    );
    return rows;
  });
}

export async function complete(id: number): Promise<void> {
  await query(
    `UPDATE jobs SET status = 'done', locked_at = NULL, locked_by = NULL, last_error = NULL
      WHERE id = $1`,
    [id],
  );
}

/**
 * Records a failure. A retryable job goes back to the queue with exponential
 * backoff until `max_attempts`; after that it is parked as failed so a poison
 * job cannot spin forever.
 */
export async function fail(
  job: Job,
  message: string,
  opts: { retryable: boolean; retryAfterMs?: number } = { retryable: true },
): Promise<void> {
  const exhausted = job.attempts >= job.max_attempts;

  if (!opts.retryable || exhausted) {
    await query(
      `UPDATE jobs SET status = 'failed', locked_at = NULL, locked_by = NULL, last_error = $2
        WHERE id = $1`,
      [job.id, message.slice(0, 1000)],
    );
    log.warn('job failed permanently', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      reason: exhausted ? 'attempts_exhausted' : 'non_retryable',
      message: message.slice(0, 200),
    });
    return;
  }

  const delayMs = opts.retryAfterMs ?? backoffMs(job.attempts);
  await query(
    `UPDATE jobs
        SET status = 'queued', locked_at = NULL, locked_by = NULL,
            last_error = $2, run_at = now() + ($3::bigint * INTERVAL '1 millisecond')
      WHERE id = $1`,
    [job.id, message.slice(0, 1000), Math.round(delayMs)],
  );
  log.debug('job scheduled for retry', { jobId: job.id, attempts: job.attempts, delayMs });
}

/** 30s, 1m, 2m, 4m, 8m … capped at 30 minutes, with jitter. */
function backoffMs(attempts: number): number {
  const base = Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return base + Math.floor(Math.random() * 5_000);
}

/**
 * Returns jobs abandoned by a worker that died mid-flight.
 *
 * Without this, a container restart during a backfill would leave rows stuck in
 * `running` forever and the merchant's catalogue would silently stop.
 */
export async function reapStalled(olderThanMinutes = 15): Promise<number> {
  const { rowCount } = await query(
    `UPDATE jobs
        SET status = 'queued', locked_at = NULL, locked_by = NULL,
            last_error = COALESCE(last_error, 'worker vanished; requeued'),
            run_at = now()
      WHERE status = 'running'
        AND locked_at < now() - ($1 || ' minutes')::INTERVAL`,
    [String(olderThanMinutes)],
  );
  const n = rowCount ?? 0;
  if (n > 0) log.warn('reaped stalled jobs', { count: n });
  return n;
}

export interface QueueDepth {
  queued: number;
  running: number;
  failed: number;
}

export async function depth(shopId?: number): Promise<QueueDepth> {
  const { rows } = await query<{ status: string; n: string }>(
    shopId
      ? `SELECT status, COUNT(*)::text AS n FROM jobs WHERE shop_id = $1 GROUP BY status`
      : `SELECT status, COUNT(*)::text AS n FROM jobs GROUP BY status`,
    shopId ? [shopId] : [],
  );
  const out: QueueDepth = { queued: 0, running: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === 'queued' || r.status === 'running' || r.status === 'failed') {
      out[r.status] = Number.parseInt(r.n, 10);
    }
  }
  return out;
}

/** Housekeeping so the table does not grow without bound on a free-tier database. */
export async function pruneCompleted(olderThanDays = 7): Promise<void> {
  await query(
    `DELETE FROM jobs
      WHERE status = 'done' AND updated_at < now() - ($1 || ' days')::INTERVAL`,
    [String(olderThanDays)],
  );
}

/**
 * Releases a job's dedupe key while it is still running.
 *
 * A self-continuing job (the catalogue sweep re-queues itself for the next
 * page) would otherwise collide with its own key, because the partial unique
 * index covers running rows too. Clearing the key first lets the successor in.
 */
export async function clearDedupeKey(id: number): Promise<void> {
  await query(`UPDATE jobs SET dedupe_key = NULL WHERE id = $1`, [id]);
}
