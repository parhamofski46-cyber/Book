// End to end: the Lua collector's own output, through the real ingest path,
// into the real analysis, out of the real dashboard.
//
// The fixture is not hand-written. It is the bytes the collector shipped while
// running unmodified inside the FiveM simulator, alongside the ground truth of
// every fault that was injected. So this suite asserts that the product finds
// what actually broke -- not that its pieces agree with each other.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { suite, test, eq, ok, gt, gte, lte, contains } from './harness.js';
import { openStore } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createIngestHandler } from '../src/http/ingest.js';
import { detectRegressions, runRegressionAnalysis } from '../src/analysis/regression.js';
import { healthScore } from '../src/analysis/health.js';
import { serverDetailPage, serverListPage } from '../src/http/pages.js';
import { evaluateAlerts } from '../src/alerts/rules.js';
import { dispatchAlerts } from '../src/alerts/discord.js';
import { loadFixture, replayFixture, mockRequest, mockResponse } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures/threeday.jsonl');
const TRUTH = join(HERE, 'fixtures/threeday.truth.json');

function loadWorld() {
  if (!existsSync(FIXTURE)) {
    throw new Error(`fixture missing: run "make fixtures" to generate ${FIXTURE}`);
  }
  return { payloads: loadFixture(FIXTURE), truth: JSON.parse(readFileSync(TRUTH, 'utf8')) };
}

export default async function run() {
  const { payloads, truth } = loadWorld();
  const store = openStore(':memory:');
  const config = loadConfig({});
  const server = store.createServer({ name: 'sim-rp', plan: 'team', webhook: 'https://discord.test/hook' });

  let clockValue = 0;
  const handler = createIngestHandler({ store, config, clock: () => clockValue });
  handler.setClock = (v) => { clockValue = v; };
  const replay = await replayFixture(handler, payloads, server.token);

  const all = store.samplesBetween(server.id, 0, 2e10);
  const now = all[all.length - 1].wall_s + 1;
  const findings = detectRegressions(store, server.id, { now, lookbackS: 7 * 86400 });
  const culprit = truth.restarts.find((r) => r.reason === 'update');

  await suite('end to end: a recorded day of a simulated server', async () => {
    await test('every payload the collector produced was accepted', async () => {
      eq(replay.rejected, 0, 'nothing the collector sends is refused by its own backend');
      gt(replay.stored, 15000, 'a full three days of windows landed');
      eq(all.length, replay.stored, 'and all of it is readable back');
    });

    await test('the recorded resource restarts survived the round trip', async () => {
      const changes = store.changesBetween(server.id, 0, 2e10);
      gt(changes.length, 0, 'restarts stored');
      ok(changes.some((c) => c.resource === 'qb-inventory'), 'including the one that matters');
    });

    await test('it names the resource that was actually broken', async () => {
      ok(culprit, 'the simulator did seed an update');
      eq(findings.length, 1, 'exactly one finding');
      eq(findings[0].resource, 'qb-inventory', 'and it is the right one');
    });

    await test('it places the change at the moment it happened', async () => {
      const changes = store.changesBetween(server.id, 0, 2e10)
        .filter((c) => c.resource === 'qb-inventory' && c.change === 'started');
      ok(changes.length > 0, 'the restart is on record');
      const nearest = changes.reduce((best, c) =>
        Math.abs(c.wall_s - findings[0].changedS) < Math.abs(best.wall_s - findings[0].changedS) ? c : best);
      lte(Math.abs(nearest.wall_s - findings[0].changedS), 300, 'attributed to that restart, within one cluster');
    });

    await test('it does not blame the nightly restart cycle', async () => {
      // qb-garages and qb-houses restart every night and are innocent. They
      // are the trap: an unfixed regression makes every later restart look
      // guilty against yesterday.
      const scheduled = findings.filter((f) => ['qb-garages', 'qb-houses'].includes(f.resource));
      eq(scheduled.length, 0, 'no false positives on the scheduled restarts');
    });

    await test('the size of the slowdown is reported, not just its existence', async () => {
      const f = findings[0];
      gt(f.afterStallRatio, f.beforeStallRatio * 3, 'a large step');
      gt(f.score, 1, 'scored as such');
      eq(f.confidence, 'high', 'and stated with confidence, given three days of evidence');
      contains(f.method, 'day-over-day', 'using the seasonal baseline');
    });

    await test('a single day of history yields a weaker, honest verdict', async () => {
      // The same fault seen with only the hours around it available: still
      // found, but the tool says how thin the evidence is rather than
      // borrowing certainty it has not earned.
      const oneDay = openStore(':memory:');
      const s2 = oneDay.createServer({ name: 'short', plan: 'team' });
      let c2 = 0;
      const h2 = createIngestHandler({ store: oneDay, config, clock: () => c2 });
      h2.setClock = (v) => { c2 = v; };
      // Trim both ends: a server that has only been reporting since this
      // morning has no previous day to compare against, which is exactly the
      // case where the tool must not sound certain.
      const from = findings[0].changedS - 12 * 3600;
      const to = findings[0].changedS + 6 * 3600;
      const trimmed = payloads.filter((p) =>
        (p.samples ?? []).length > 0 && p.samples.every((s) => s.wall >= from && s.wall <= to));
      await replayFixture(h2, trimmed, s2.token);
      const rows = oneDay.samplesBetween(s2.id, 0, 2e10);
      const short = detectRegressions(oneDay, s2.id, { now: rows[rows.length - 1].wall_s + 1 });
      eq(short.length, 1, 'still found');
      eq(short[0].resource, 'qb-inventory');
      eq(short[0].method, 'adjacent', 'no previous day to compare against');
      ok(short[0].confidence !== 'high', 'so it does not claim certainty it has not earned');
    });
  });

  await suite('end to end: what the operator is shown', async () => {
    runRegressionAnalysis(store, server.id, { now });

    await test('the dashboard renders the finding', async () => {
      const html = serverDetailPage(store, store.getServer(server.id), { now, rangeKey: '7d' });
      contains(html, 'qb-inventory', 'the culprit is named on the page');
      contains(html, 'What changed', 'under a heading that answers the question');
      contains(html, '<svg', 'with the timeline drawn');
      ok(!html.includes('undefined'), 'and nothing rendered as undefined');
    });

    await test('the server list summarises health without crashing on real data', async () => {
      const html = serverListPage(store, { now });
      contains(html, 'sim-rp');
      ok(!html.includes('NaN'), 'no NaN leaked into the page');
    });

    await test('health is scored from the same data', async () => {
      const recent = store.samplesBetween(server.id, now - 3600, now + 1);
      const h = healthScore(recent);
      ok(h.score !== null, 'scored');
      gt(h.hitchesPerHour, 0, 'the degraded tail of the run is visible');
    });

    await test('the regression is escalated to Discord exactly once', async () => {
      const calls = [];
      const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 204 }; };
      const alerts = evaluateAlerts(store, store.getServer(server.id), { now });
      await dispatchAlerts(store, store.getServer(server.id), alerts, { now, fetchImpl });
      const regressionAlerts = calls.filter((c) => c.embeds[0].title.includes('qb-inventory'));
      eq(regressionAlerts.length, 1, 'one message');
      contains(regressionAlerts[0].embeds[0].description, 'stall time per window', 'explaining the evidence');

      const second = evaluateAlerts(store, store.getServer(server.id), { now: now + 60 });
      eq(second.filter((a) => a.kind === 'regression').length, 0, 'and not repeated');
    });
  });

  await suite('end to end: over real HTTP', async () => {
    const httpStore = openStore(':memory:');
    const httpConfig = { ...loadConfig({}), adminToken: 'test-admin', port: 0 };
    const app = createApp({ store: httpStore, config: httpConfig, fetchImpl: async () => ({ ok: true, status: 204 }) });
    const listening = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${listening.address().port}`;

    await test('a server can be provisioned and then reports into it', async () => {
      const created = await fetch(`${base}/v1/admin/servers`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'live-rp', plan: 'pro' }),
      });
      eq(created.status, 201);
      const { id, token } = await created.json();
      ok(token.startsWith('pls_'), 'a collector token is issued');

      const batch = payloads[0];
      const sent = await fetch(`${base}/v1/ingest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...batch,
          // Restamp onto the current clock so the skew guard behaves as in life.
          samples: batch.samples.map((s, i) => ({ ...s, wall: Math.floor(Date.now() / 1000) - (batch.samples.length - i) * 15 })),
        }),
      });
      eq(sent.status, 200);
      gt((await sent.json()).stored, 0, 'stored over the wire');

      const page = await fetch(`${base}/s/${id}`, { headers: { authorization: `Bearer ${token}` } });
      eq(page.status, 200);
      contains(page.headers.get('content-security-policy'), "default-src 'none'", 'served with a strict policy');
      contains(await page.text(), 'live-rp', 'and shows the server');
    });

    await test('the JSON API refuses a reader without a token', async () => {
      const res = await fetch(`${base}/v1/servers/1/summary`);
      eq(res.status, 401, 'summary is not public');
      const page = await fetch(`${base}/s/1`, { redirect: 'manual' });
      eq(page.status, 401, 'and neither is the dashboard');
    });

    await test('health check answers', async () => {
      const res = await fetch(`${base}/healthz`);
      eq(res.status, 200);
      ok((await res.json()).ok);
    });

    listening.close();
    httpStore.close();
  });
}
