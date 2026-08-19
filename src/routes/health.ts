import { Hono } from 'hono';
import { query } from '../db/pool.js';
import { depth } from '../queue/queue.js';

export const healthRoutes = new Hono();

/** Liveness: the process is up. Deliberately touches nothing else. */
healthRoutes.get('/healthz', (c) => c.json({ ok: true }));

/** Readiness: the app can actually serve traffic. */
healthRoutes.get('/readyz', async (c) => {
  try {
    await query('SELECT 1');
  } catch (err) {
    return c.json({ ok: false, database: 'unreachable', error: (err as Error).message }, 503);
  }
  return c.json({ ok: true, database: 'ok', queue: await depth() });
});
