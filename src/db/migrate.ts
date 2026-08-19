import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, query } from './pool.js';
import { logger } from '../lib/logger.js';

/** Guards against two instances migrating at once during a rolling deploy. */
const ADVISORY_LOCK_ID = 8_531_774_201;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      logger.info('applying migration', { file });
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('migration failed', { file, err });
        throw err;
      }
    }

    logger.info('migrations up to date', { applied: ran, total: files.length });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

/** Housekeeping the app runs on boot: nothing here is load-bearing. */
export async function pruneEphemera(): Promise<void> {
  await query("DELETE FROM oauth_states WHERE created_at < now() - INTERVAL '1 hour'");
  await query("DELETE FROM webhook_events WHERE received_at < now() - INTERVAL '30 days'");
}

// `npm run migrate` executes this file directly; importing it must not.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('migration run failed', { err });
      process.exit(1);
    });
}
