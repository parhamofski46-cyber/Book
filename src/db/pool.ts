import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

/**
 * Postgres stores BIGINT as a string by default because it can exceed
 * Number.MAX_SAFE_INTEGER. Our ids never will, and string ids leak awkwardly
 * into JSON, so parse them as numbers. (OID 20 = int8.)
 */
pg.types.setTypeParser(20, (v: string) => Number.parseInt(v, 10));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Managed Postgres (Supabase, Neon) terminates plaintext connections; a local
  // docker instance has no certificate at all. `rejectUnauthorized: false`
  // accepts the provider's own chain without shipping their CA bundle.
  ssl: env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : false,
  application_name: 'alt-text-autopilot',
});

pool.on('error', (err) => {
  // An idle client failing is not fatal — pg will open a fresh one.
  logger.error('postgres idle client error', { err });
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<pg.QueryResult<T>> {
  const started = process.hrtime.bigint();
  try {
    return await client.query<T>(text, params as unknown[]);
  } finally {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms > 500) {
      logger.warn('slow query', { ms: Math.round(ms), sql: text.slice(0, 160) });
    }
  }
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('rollback failed', { err: rollbackErr });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
