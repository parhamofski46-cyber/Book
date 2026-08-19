import { serve } from '@hono/node-server';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closePool } from './db/pool.js';
import { pruneEphemera, runMigrations } from './db/migrate.js';
import { loadAssets } from './ui/dashboard.js';
import { createServer } from './server.js';
import { Worker } from './queue/worker.js';

const log = logger.child({ component: 'boot' });

async function main(): Promise<void> {
  await runMigrations();
  await pruneEphemera();
  await loadAssets();

  const server = serve({ fetch: createServer().fetch, port: env.PORT }, (info) => {
    log.info('http server listening', {
      port: info.port,
      appUrl: env.APP_URL,
      env: env.NODE_ENV,
    });
  });

  // On a single free-tier box the worker rides along with the web process. Set
  // RUN_WORKER_IN_WEB=false once traffic justifies separate dynos.
  const worker = env.RUN_WORKER_IN_WEB ? new Worker() : null;
  worker?.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });

    server.close();
    await worker?.stop();
    await closePool();
    log.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejected promise nobody awaited is a bug; crash loudly rather than limp on
  // in an unknown state and let the platform restart us.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { err: reason });
    process.exit(1);
  });
}

main().catch((err) => {
  log.error('failed to start', { err });
  process.exit(1);
});
