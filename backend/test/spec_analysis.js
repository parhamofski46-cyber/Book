import { suite, test, eq, ok, gt, gte, lte, within } from './harness.js';
import { openStore } from '../src/db/store.js';
import { stratifiedCompare, windowSeconds } from '../src/analysis/compare.js';
import { healthScore, gradeFor } from '../src/analysis/health.js';
import { fleetComparison } from '../src/analysis/fleet.js';

const NOW = 1788220800;
const win = (over = {}) => ({
  wall_s: NOW, players: 60, stall_ms: 0, hitches: 0, p95_drift: 4, max_drift: 20, probes: 300, ...over,
});

export default async function run() {
  await suite('compare: population is controlled for', async () => {
    await test('a busier "after" is not mistaken for a regression', async () => {
      // Same relationship between load and stall on both sides; only the mix
      // of player counts differs. A naive mean would report a large increase.
      const stallFor = (players) => players * 2;
      const before = [];
      const after = [];
      for (let i = 0; i < 60; i++) {
        const p = 20 + (i % 20);
        before.push(win({ players: p, stall_ms: stallFor(p) }));
      }
      for (let i = 0; i < 60; i++) {
        const p = 30 + (i % 60);
        after.push(win({ players: p, stall_ms: stallFor(p) }));
      }
      const naiveBefore = before.reduce((a, s) => a + s.stall_ms, 0) / before.length;
      const naiveAfter = after.reduce((a, s) => a + s.stall_ms, 0) / after.length;
      gt(naiveAfter, naiveBefore * 1.3, 'the naive comparison really would be fooled');

      const c = stratifiedCompare(before, after);
      ok(c.comparable, 'buckets overlapped');
      within(c.afterStallPerWindow / c.beforeStallPerWindow, 0.9, 1.1,
        'matched-population comparison sees no change');
    });

    await test('a real regression still shows through', async () => {
      const before = Array.from({ length: 60 }, (_, i) => win({ players: 40 + (i % 40), stall_ms: 10 }));
      const after = Array.from({ length: 60 }, (_, i) => win({ players: 40 + (i % 40), stall_ms: 110 }));
      const c = stratifiedCompare(before, after);
      gt(c.afterStallPerWindow - c.beforeStallPerWindow, 90, 'the step is reported');
    });

    await test('no overlapping population means no verdict', async () => {
      const before = Array.from({ length: 40 }, () => win({ players: 10 }));
      const after = Array.from({ length: 40 }, () => win({ players: 180 }));
      const c = stratifiedCompare(before, after);
      eq(c.comparable, false, 'refuses rather than guesses');
    });

    await test('window length is inferred from the data', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => win({ wall_s: NOW + i * 30 }));
      eq(windowSeconds(rows), 30);
      eq(windowSeconds([]), 15, 'falls back when there is nothing to infer from');
    });
  });

  await suite('health: score and its components', async () => {
    await test('a clean server scores near the top', async () => {
      const rows = Array.from({ length: 240 }, (_, i) => win({ wall_s: NOW + i * 15, stall_ms: 0, p95_drift: 2 }));
      const h = healthScore(rows);
      gte(h.score, 95, 'clean server rated highly');
      eq(h.grade, 'A');
      lte(h.blockedPct, 0.01);
    });

    await test('a badly blocked server is graded down', async () => {
      // 3s of every 15s window lost: a fifth of wall time.
      const rows = Array.from({ length: 240 }, (_, i) => win({ wall_s: NOW + i * 15, stall_ms: 3000, p95_drift: 120 }));
      const h = healthScore(rows);
      lte(h.score, 25, 'severely degraded');
      eq(h.grade, 'F');
      within(h.blockedPct, 19, 21, 'blocked share reported honestly');
    });

    await test('the score decomposes into stated parts', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => win({ wall_s: NOW + i * 15, stall_ms: 400 }));
      const h = healthScore(rows);
      ok(h.components.blockedScore !== undefined && h.components.p95Score !== undefined,
        'components exposed so the number can be argued with');
      eq(gradeFor(h.score), h.grade, 'grade matches score');
    });

    await test('no data is reported as no data, not as health', async () => {
      const h = healthScore([]);
      eq(h.score, null);
      ok(h.reason, 'says why');
    });
  });

  await suite('fleet: comparison within a cohort', async () => {
    const build = (n) => {
      const store = openStore(':memory:');
      const ids = [];
      for (let i = 0; i < n; i++) {
        const s = store.createServer({ name: `rp${i}`, plan: 'team', createdS: NOW });
        ids.push(s.id);
        const rows = Array.from({ length: 200 }, (_, k) => ({
          wall_s: NOW - 3600 + k * 15, uptime_ms: k * 15000, players: 80, resources: 200, probes: 300,
          mean_drift: 2, p50_drift: 1, p95_drift: 5, p99_drift: 20, max_drift: 100,
          // Server 0 is the worst in the cohort by a wide margin.
          stall_ms: i === 0 ? 900 : 40 + i * 5, hitches: 1,
        }));
        store.writeBatch(s.id, { samples: rows, receivedS: NOW });
      }
      return { store, ids };
    };

    await test('a small cohort refuses to draw conclusions', async () => {
      const { store, ids } = build(3);
      const r = fleetComparison(store, ids[0], { now: NOW + 1 });
      eq(r.available, false, 'declines');
      ok(r.reason.includes('cohort'), 'says why');
    });

    await test('the worst server in a cohort is told so', async () => {
      const { store, ids } = build(9);
      const r = fleetComparison(store, ids[0], { now: NOW + 1 });
      ok(r.available, 'comparison made');
      lte(r.betterThanPct, 15, 'placed at the bottom of its cohort');
      gt(r.ratioToMedian, 3, 'and told how far off the median it is');
    });

    await test('a healthy server is placed near the top', async () => {
      const { store, ids } = build(9);
      const r = fleetComparison(store, ids[1], { now: NOW + 1 });
      gte(r.betterThanPct, 70, 'ranked well');
      eq(r.cohortSize, 9);
    });
  });
}
