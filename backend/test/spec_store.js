import { suite, test, eq, ok, gt, gte, lte, within } from './harness.js';
import { openStore } from '../src/db/store.js';

const DAY = 86400;
const NOW = 1788220800;

function seed(store, serverId, fromS, days, perHour = 4) {
  const rows = [];
  for (let d = 0; d < days * 24; d++) {
    for (let i = 0; i < perHour; i++) {
      const t = fromS + d * 3600 + i * 900;
      rows.push({
        wall_s: t, uptime_ms: (t - fromS) * 1000, players: 50 + (d % 40), resources: 200,
        probes: 300, mean_drift: 2, p50_drift: 1, p95_drift: 5, p99_drift: 20,
        max_drift: 100, stall_ms: 120, hitches: 1,
      });
    }
  }
  store.writeBatch(serverId, { samples: rows, receivedS: NOW });
  return rows.length;
}

export default async function run() {
  await suite('store: retention applies each plan', async () => {
    await test('raw windows older than the plan are folded, not lost', async () => {
      const store = openStore(':memory:');
      const s = store.createServer({ name: 'free-rp', plan: 'free', createdS: NOW - 40 * DAY });
      const written = seed(store, s.id, NOW - 20 * DAY, 20);
      gt(written, 1000, 'seeded a meaningful amount');

      const before = store.samplesBetween(s.id, 0, 2e10).length;
      store.maintain(NOW);
      const rawAfter = store.samplesBetween(s.id, 0, 2e10);
      const hourly = store.hourlyBetween(s.id, 0, 2e10);

      lte(rawAfter.length, before, 'raw was pruned');
      ok(rawAfter.every((r) => r.wall_s >= NOW - 7 * DAY), 'nothing older than the free plan kept raw');
      gt(hourly.length, 100, 'the pruned span survives as hourly buckets');

      // The fold must conserve the totals it summarises.
      const rolledStall = hourly.reduce((a, h) => a + h.stall_ms, 0);
      const rawStall = rawAfter.reduce((a, r) => a + r.stall_ms, 0);
      eq(rolledStall + rawStall, written * 120, 'no stall time invented or lost in the rollup');
    });

    await test('folding twice does not double count', async () => {
      const store = openStore(':memory:');
      const s = store.createServer({ name: 'rp', plan: 'free', createdS: NOW - 40 * DAY });
      seed(store, s.id, NOW - 20 * DAY, 20);
      store.maintain(NOW);
      const first = store.hourlyBetween(s.id, 0, 2e10).reduce((a, h) => a + h.stall_ms, 0);
      store.maintain(NOW);
      store.maintain(NOW);
      const after = store.hourlyBetween(s.id, 0, 2e10).reduce((a, h) => a + h.stall_ms, 0);
      eq(after, first, 'repeated maintenance is idempotent');
    });

    await test('a longer plan keeps more raw detail from the same data', async () => {
      const build = (plan) => {
        const store = openStore(':memory:');
        const s = store.createServer({ name: plan, plan, createdS: NOW - 40 * DAY });
        seed(store, s.id, NOW - 20 * DAY, 20);
        store.maintain(NOW);
        return store.samplesBetween(s.id, 0, 2e10).length;
      };
      gt(build('pro'), build('free'), 'pro retains more raw windows than free');
    });

    await test('hourly buckets past the plan are dropped too', async () => {
      const store = openStore(':memory:');
      const s = store.createServer({ name: 'rp', plan: 'free', createdS: NOW - 400 * DAY });
      seed(store, s.id, NOW - 60 * DAY, 60, 2);
      store.maintain(NOW);
      const hourly = store.hourlyBetween(s.id, 0, 2e10);
      ok(hourly.every((h) => h.hour_s >= NOW - 30 * DAY - 3600), 'nothing beyond the hourly window kept');
    });
  });

  await suite('store: tokens', async () => {
    await test('the plaintext token is never stored', async () => {
      const store = openStore(':memory:');
      const s = store.createServer({ name: 'rp', createdS: NOW });
      const row = store.db.prepare('SELECT token_hash FROM servers WHERE id = ?').get(s.id);
      ok(!row.token_hash.includes(s.token), 'only a hash is persisted');
      eq(row.token_hash.length, 64, 'sha-256 hex');
    });

    await test('each server gets a distinct token', async () => {
      const store = openStore(':memory:');
      const a = store.createServer({ name: 'a', createdS: NOW });
      const b = store.createServer({ name: 'b', createdS: NOW });
      ok(a.token !== b.token, 'tokens differ');
      eq(store.findServerByToken(a.token).id, a.id);
      eq(store.findServerByToken(b.token).id, b.id);
    });
  });
}
