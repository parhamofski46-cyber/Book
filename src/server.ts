import { Hono } from 'hono';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { isProduction } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { webhookRoutes } from './routes/webhooks.js';
import { apiRoutes } from './routes/api.js';
import { appRoutes } from './routes/app.js';

export function createServer(): Hono {
  const app = new Hono();
  const log = logger.child({ component: 'http' });

  // Request logging. Health checks are excluded so a container platform polling
  // every second does not drown the log.
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    const path = new URL(c.req.url).pathname;
    if (path === '/healthz' || path === '/readyz' || path.startsWith('/static/')) return;
    log.info('request', {
      method: c.req.method,
      path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.route('/', healthRoutes);
  app.route('/', authRoutes);
  app.route('/', webhookRoutes);
  app.route('/', apiRoutes);
  app.route('/', appRoutes);

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    const path = new URL(c.req.url).pathname;
    const isApi = path.startsWith('/api/');

    if (err instanceof AppError) {
      // Expected, classified failures: log at the level they deserve and answer
      // in the shape the caller can act on.
      const level = err.status >= 500 ? 'error' : 'warn';
      log[level]('handled error', { path, code: err.code, status: err.status, message: err.message });
      return isApi
        ? c.json({ error: err.message, code: err.code }, err.status as 400)
        : c.text(err.message, err.status as 400);
    }

    log.error('unhandled error', { path, err });
    const message = isProduction ? 'Something went wrong' : (err as Error).message;
    return isApi ? c.json({ error: message }, 500) : c.text(message, 500);
  });

  return app;
}
