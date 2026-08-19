import { logger } from './lib/logger.js';
import { closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { Worker } from './queue/worker.js';

/**
 * Standalone worker process.
 *
 * Used when RUN_WORKER_IN_WEB is false and the queue deserves its own machine —
 * the same code, just without an HTTP listener.
 */
const log = logger.child({ component: 'worker-entry' });

async function main(): Promise<void> {
  await runMigrations();

  const worker = new Worker();
  worker.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    await worker.stop();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('worker failed to start', { err });
  process.exit(1);
});
