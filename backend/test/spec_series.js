// Choosing a resolution, and keeping its units honest.
//
// Both faults here were invisible: a long range quietly showed a short one,
// and the hourly series plotted an hour's total under a legend that said
// "peak per window". Neither breaks anything loudly -- the chart just lies.

import { suite, test, eq, ok, gt, gte, lte, within } from './harness.js';
import { openStore } from '../src/db/store.js';
import { seriesForRange } from '../src/http/pages.js';

const DAY = 86400;
const NOW = 1788220800;

/** `days` of 15-second windows ending at NOW, with a known worst window per hour. */
function seed(store, serverId, days, { peakStall = 500, ordinaryStall = 20 } = {}) {
  const rows = [];
  const start = NOW - days * DAY;
  for (let t = start; t < NOW; t += 15) {
    // One bad window each hour, so the hourly peak is known exactly.
    const worst = Math.floor(t / 3600) * 3600 + 15;
    rows.push({
      wall_s: t, uptime_ms: (t - start) * 1000, players: 60, resources: 200, probes: 300,
      mean_drift: 2, p50_drift: 1, p95_drift: 5, p99_drift: 20, max_drift: 100,
      stall_ms: t === worst ? peakStall : ordinaryStall, hitches: t === worst ? 1 : 0,
    });
  }
  store.writeBatch(serverId, { samples: rows, receivedS: NOW });
  return rows.length;
}

export default async function run() {
  await suite('series: a long range shows the long range', async () => {
    const store = openStore(':memory:');
    // Free plan: 7 days raw, 30 days hourly.
    const s = store.createServer({ name: 'rp', plan: 'free', createdS: NOW - 40 * DAY });
    seed(store, s.id, 30);
    store.maintain(NOW);

    await test('30 days of history is served as 30 days, not as the raw window', async () => {
      const { rows, resolution } = seriesForRange(store, s.id, NOW - 30 * DAY, NOW + 1);
      eq(resolution, 'hourly', 'falls back rather than pretending raw covers it');
      const spanDays = (rows[rows.length - 1].wall_s - rows[0].wall_s) / DAY;
      gte(spanDays, 25, `the series spans ${spanDays.toFixed(1)} days`);
    });

    await test('it reaches the present, not just where the rollup stopped', async () => {
      const { rows } = seriesForRange(store, s.id, NOW - 30 * DAY, NOW + 1);
      // The last few days are still raw and not yet rolled up; they have to be
      // folded on the fly or the chart ends days ago with no explanation.
      lte(NOW - rows[rows.length - 1].wall_s, 2 * 3600, 'the last point is recent');
    });

    await test('a day still comes back at full resolution', async () => {
      const { rows, resolution } = seriesForRange(store, s.id, NOW - DAY, NOW + 1);
      eq(resolution, 'raw', 'raw covers a day comfortably');
      gt(rows.length, 5000, 'every window is there');
    });
  });

  await suite('series: the hourly figures mean what the raw ones mean', async () => {
    const store = openStore(':memory:');
    const s = store.createServer({ name: 'rp', plan: 'free', createdS: NOW - 40 * DAY });
    seed(store, s.id, 20, { peakStall: 500, ordinaryStall: 20 });
    store.maintain(NOW);

    await test('stall is the worst window in the hour, not the hour total', async () => {
      const { rows, resolution } = seriesForRange(store, s.id, NOW - 20 * DAY, NOW + 1);
      eq(resolution, 'hourly');
      const peak = Math.max(...rows.map((r) => r.stall_ms));
      // The hour's total is 500 + 239*20 = 5,280ms. Reporting that under a
      // legend reading "peak stall per window" overstates it by about ten
      // times here, and by far more on a busy server.
      within(peak, 480, 520, `peak per window is ${peak}ms, not the hour's sum`);
    });

    await test('a chart drawn from it stays on the same scale as the raw one', async () => {
      const long = seriesForRange(store, s.id, NOW - 20 * DAY, NOW + 1);
      const short = seriesForRange(store, s.id, NOW - DAY, NOW + 1);
      const peakOf = (r) => Math.max(...r.rows.map((x) => x.stall_ms));
      within(peakOf(long) / peakOf(short), 0.8, 1.25,
        'switching resolution does not move the y-axis by an order of magnitude');
    });

    await test('players is the hour peak, so the population panel stays readable', async () => {
      const { rows } = seriesForRange(store, s.id, NOW - 20 * DAY, NOW + 1);
      ok(rows.every((r) => r.players > 0 && r.players <= 10000), 'plausible player counts');
    });
  });

  await suite('series: payload size is bounded', async () => {
    const store = openStore(':memory:');
    const s = store.createServer({ name: 'rp', plan: 'team', createdS: NOW - 40 * DAY });
    seed(store, s.id, 10);

    await test('a range too large to serve raw is served hourly instead', async () => {
      const { rows, resolution } = seriesForRange(store, s.id, NOW - 10 * DAY, NOW + 1);
      // 10 days of raw is ~57,600 rows; nothing should hand that to a browser.
      eq(resolution, 'hourly', 'switched rather than serialising everything');
      lte(rows.length, 300, `${rows.length} points is a sane payload`);
    });

    await test('an empty range does not throw', async () => {
      const empty = store.createServer({ name: 'quiet', plan: 'team', createdS: NOW });
      const { rows } = seriesForRange(store, empty.id, NOW - DAY, NOW + 1);
      eq(rows.length, 0, 'no rows, no error');
    });
  });
}
