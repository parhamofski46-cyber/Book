import { hostname } from 'node:os';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError, isRetryable, toMessage, UnauthorizedError } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import * as shopsRepo from '../db/repos/shops.js';
import { HANDLERS } from '../jobs/index.js';
import { claim, complete, fail, pruneCompleted, reapStalled, type Job } from './queue.js';

const IDLE_POLL_MS = 2_000;
const MAINTENANCE_EVERY_MS = 5 * 60_000;

export class Worker {
  private readonly id = `${hostname()}:${process.pid}:${randomToken(4)}`;
  private readonly log = logger.child({ component: 'worker' });
  private running = false;
  private draining: Promise<void> | null = null;
  private lastMaintenance = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info('worker started', { workerId: this.id, concurrency: env.WORKER_CONCURRENCY });
    this.draining = this.loop();
  }

  /** Stops claiming and waits for in-flight jobs so a deploy loses no work. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.log.info('worker draining');
    await this.draining;
    this.log.info('worker stopped');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.maintenance();
        const jobs = await claim(this.id, env.WORKER_CONCURRENCY);

        if (jobs.length === 0) {
          await sleep(IDLE_POLL_MS + Math.random() * 500);
          continue;
        }

        await Promise.all(jobs.map((job) => this.run(job)));
      } catch (err) {
        // The loop itself must never die — a database blip should cost a beat,
        // not the worker.
        this.log.error('worker loop error', { err });
        await sleep(5_000);
      }
    }
  }

  private async run(job: Job): Promise<void> {
    const log = this.log.child({ jobId: job.id, type: job.type, attempt: job.attempts });
    const started = Date.now();

    try {
      const handler = HANDLERS[job.type];
      if (!handler) {
        await fail(job, `No handler registered for "${job.type}"`, { retryable: false });
        return;
      }

      // Every handler needs an installed shop; resolving it here keeps that
      // check in one place instead of at the top of four files.
      if (job.shop_id === null) {
        await fail(job, 'Job has no shop', { retryable: false });
        return;
      }

      const shop = await shopsRepo.findById(job.shop_id);
      if (!shop || shop.uninstalled_at || !shop.accessToken) {
        log.info('shop is no longer installed; discarding job');
        await complete(job.id);
        return;
      }

      await handler({ job, shop });
      await complete(job.id);
      log.info('job done', { ms: Date.now() - started });
    } catch (err) {
      await this.handleFailure(job, err, log);
    }
  }

  private async handleFailure(job: Job, err: unknown, log: typeof this.log): Promise<void> {
    const message = toMessage(err);

    // The merchant revoked us mid-flight. Retrying cannot help, and the
    // uninstall webhook will clean up the rest.
    if (err instanceof UnauthorizedError) {
      log.warn('access token rejected; marking shop uninstalled');
      if (job.shop_id !== null) {
        const shop = await shopsRepo.findById(job.shop_id);
        if (shop) await shopsRepo.markUninstalled(shop.domain);
      }
      await fail(job, message, { retryable: false });
      return;
    }

    if (isRetryable(err)) {
      await fail(job, message, { retryable: true, retryAfterMs: err.retryAfterMs });
      return;
    }

    // 4xx from Shopify or our own validation: retrying will fail identically.
    const permanent = err instanceof AppError && err.status >= 400 && err.status < 500;
    log.error('job threw', { err, permanent });
    await fail(job, message, { retryable: !permanent });
  }

  private async maintenance(): Promise<void> {
    if (Date.now() - this.lastMaintenance < MAINTENANCE_EVERY_MS) return;
    this.lastMaintenance = Date.now();
    await reapStalled();
    await pruneCompleted();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
