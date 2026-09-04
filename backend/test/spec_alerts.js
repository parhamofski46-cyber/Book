import { suite, test, eq, ok, gt, contains } from './harness.js';
import { openStore } from '../src/db/store.js';
import { evaluateAlerts, RULES } from '../src/alerts/rules.js';
import { formatAlert, dispatchAlerts, deliverAlert } from '../src/alerts/discord.js';

const NOW = 1788220800;

function serverWith(store, { stallMs = 0, seenAgo = 10, count = 120 } = {}) {
  const s = store.createServer({ name: 'rp', plan: 'pro', webhook: 'https://discord.test/hook', createdS: NOW });
  const rows = Array.from({ length: count }, (_, i) => ({
    wall_s: NOW - count * 15 + i * 15, uptime_ms: i * 15000, players: 90, resources: 200,
    probes: 300, mean_drift: 2, p50_drift: 1, p95_drift: stallMs > 0 ? 90 : 4,
    p99_drift: 30, max_drift: stallMs, stall_ms: stallMs, hitches: stallMs > 0 ? 6 : 0,
  }));
  store.writeBatch(s.id, { samples: rows, receivedS: NOW });
  store.touchServer(s.id, NOW - seenAgo, '0.1.0');
  return store.getServer(s.id);
}

const fakeFetch = (calls) => async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 204 };
};

export default async function run() {
  await suite('alerts: what is worth saying', async () => {
    await test('a healthy server produces nothing', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store);
      eq(evaluateAlerts(store, server, { now: NOW }).length, 0, 'silence is the default');
    });

    await test('a sustained slowdown is reported once', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store, { stallMs: 4000 });
      const first = evaluateAlerts(store, server, { now: NOW });
      eq(first.length, 1, 'one alert');
      eq(first[0].kind, 'unhealthy');
      contains(first[0].detail, 'blocked', 'says what is wrong');

      store.recordAlert(server.id, first[0].kind, first[0].key, NOW, true, null);
      eq(evaluateAlerts(store, server, { now: NOW + 60 }).length, 0, 'not repeated a minute later');
      gt(evaluateAlerts(store, server, { now: NOW + RULES.unhealthy.cooldownS + 1 }).length, 0,
        'says it again once the cooldown has passed');
    });

    await test('a collector that has gone quiet is escalated on its own', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store, { stallMs: 4000, seenAgo: 3600 });
      const alerts = evaluateAlerts(store, server, { now: NOW });
      eq(alerts.length, 1, 'only the silence is reported');
      eq(alerts[0].kind, 'silent', 'nothing else can be judged without data');
    });

    await test('a low-confidence regression is not worth a ping', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store);
      const base = { serverId: server.id, changedS: NOW - 7200, detectedS: NOW,
        beforeHitchRate: 1, afterHitchRate: 9, beforeP95: 4, afterP95: 90,
        beforeStallRatio: 10, afterStallRatio: 120, score: 3.2, method: 'adjacent' };
      store.saveRegression({ ...base, resource: 'weak-signal', confidence: 'low' });
      eq(evaluateAlerts(store, server, { now: NOW }).length, 0, 'stays quiet');

      store.saveRegression({ ...base, resource: 'qb-inventory', confidence: 'high' });
      const alerts = evaluateAlerts(store, server, { now: NOW });
      eq(alerts.length, 1);
      contains(alerts[0].title, 'qb-inventory', 'names the resource');
      eq(alerts[0].severity, 'critical', 'a high-confidence regression is escalated');
    });

    await test('the collector reporting its own trouble is surfaced', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store);
      store.writeBatch(server.id, {
        health: { version: '0.1.0', cpu_ratio: 0.002, degraded: true, buffered: 40, dropped: 0 },
        receivedS: NOW,
      });
      const alerts = evaluateAlerts(store, server, { now: NOW });
      eq(alerts.filter((a) => a.kind === 'agentTrouble').length, 1, 'reported');
    });
  });

  await suite('alerts: delivery', async () => {
    await test('an alert becomes a Discord embed with its numbers', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store, { stallMs: 4000 });
      const alert = evaluateAlerts(store, server, { now: NOW })[0];
      const body = formatAlert(server, alert, {});
      eq(body.embeds.length, 1);
      contains(body.embeds[0].title, 'health', 'titled');
      ok(body.embeds[0].fields.length >= 3, 'carries the supporting numbers');
      eq(body.embeds[0].footer.text, server.name, 'says which server');
    });

    await test('delivery is recorded and the cooldown starts even when it fails', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store, { stallMs: 4000 });
      const alerts = evaluateAlerts(store, server, { now: NOW });
      const failing = async () => { throw new Error('discord is down'); };
      const results = await dispatchAlerts(store, server, alerts, { now: NOW, fetchImpl: failing });
      eq(results[0].delivered, false, 'reported as undelivered');
      ok(store.lastAlert(server.id, 'unhealthy', alerts[0].key), 'still recorded');
      eq(evaluateAlerts(store, server, { now: NOW + 60 }).length, 0, 'and not retried in a loop');
    });

    await test('a server with no webhook does not error', async () => {
      const res = await deliverAlert(null, { embeds: [] });
      eq(res.delivered, false);
      contains(res.reason, 'webhook');
    });

    await test('a delivered regression alert is not sent twice', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store);
      store.saveRegression({ serverId: server.id, resource: 'qb-inventory', changedS: NOW - 7200,
        detectedS: NOW, beforeHitchRate: 1, afterHitchRate: 9, beforeP95: 4, afterP95: 90,
        beforeStallRatio: 10, afterStallRatio: 120, score: 3.2, confidence: 'high', method: 'day-over-day' });
      const calls = [];
      const alerts = evaluateAlerts(store, server, { now: NOW });
      await dispatchAlerts(store, server, alerts, { now: NOW, fetchImpl: fakeFetch(calls) });
      eq(calls.length, 1, 'sent once');
      const again = evaluateAlerts(store, server, { now: NOW + 1 });
      eq(again.filter((a) => a.kind === 'regression').length, 0, 'marked notified');
    });
  });
}

// Appended: three faults that every unit test passed straight over, because
// each lived in the wiring between components rather than inside one.
export async function wiringSuite() {
  const { loadConfig } = await import('../src/config.js');
  const { createApp } = await import('../src/app.js');
  const { createIngestHandler } = await import('../src/http/ingest.js');
  const { mockRequest, mockResponse } = await import('./helpers.js');

  await suite('wiring: a collector that stops reporting is noticed', async () => {
    await test('the silent rule can actually fire', async () => {
      // It used to be reachable only from the ingest hook, which stamps
      // last_seen_s immediately before calling it -- so "this server has gone
      // quiet" was, structurally, never true at the moment it was evaluated.
      const store = openStore(':memory:');
      const calls = [];
      const app = createApp({
        store,
        config: { ...loadConfig({}), publicUrl: '' },
        clock: () => NOW,
        fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 204 }; },
      });

      const server = serverWith(store, { seenAgo: 2 * 3600 });
      const fired = await app.sweepAlerts(NOW);
      eq(fired.length, 1, 'the sweep found it without any request arriving');
      eq(fired[0].kind, 'silent');
      eq(calls.length, 1, 'and it was delivered');
      ok(store.lastAlert(server.id, 'silent', fired[0].key), 'recorded, so it will not repeat');
    });

    await test('a server still reporting is left alone', async () => {
      const store = openStore(':memory:');
      const app = createApp({ store, config: loadConfig({}), clock: () => NOW,
        fetchImpl: async () => ({ ok: true, status: 204 }) });
      serverWith(store, { seenAgo: 20 });
      eq((await app.sweepAlerts(NOW)).length, 0, 'nothing to say');
    });

    await test('a plan without alerts is not swept', async () => {
      const store = openStore(':memory:');
      const app = createApp({ store, config: loadConfig({}), clock: () => NOW,
        fetchImpl: async () => ({ ok: true, status: 204 }) });
      const s = serverWith(store, { seenAgo: 2 * 3600 });
      store.setPlan(s.id, 'free');
      eq((await app.sweepAlerts(NOW)).length, 0, 'alerting is a paid feature and stays one');
    });
  });

  await suite('wiring: a finding is not consumed until it is delivered', async () => {
    await test('a server with no webhook keeps its findings for later', async () => {
      const store = openStore(':memory:');
      const s = store.createServer({ name: 'no-hook', plan: 'pro', createdS: NOW });
      store.touchServer(s.id, NOW, '0.1.0');
      store.saveRegression({ serverId: s.id, resource: 'qb-inventory', changedS: NOW - 7200,
        detectedS: NOW, beforeHitchRate: 1, afterHitchRate: 9, beforeP95: 4, afterP95: 90,
        beforeStallRatio: 10, afterStallRatio: 120, score: 3.2, confidence: 'high',
        method: 'day-over-day' });

      const server = store.getServer(s.id);
      const first = evaluateAlerts(store, server, { now: NOW });
      eq(first.length, 1, 'the finding is worth an alert');
      await dispatchAlerts(store, server, first, { now: NOW, fetchImpl: async () => ({ ok: true }) });

      // Nowhere to send it, so it must not be marked as handled -- otherwise
      // adding a webhook tomorrow surfaces nothing that happened today.
      store.setWebhook(s.id, 'https://discord.test/hook');
      // Keep the server reporting: a collector that has gone quiet reports only
      // its silence, on purpose, since nothing else can be judged from stale
      // data -- and that would mask what this test is actually checking.
      const later_s = NOW + 7 * 3600;
      store.touchServer(s.id, later_s, '0.1.0');
      const later = evaluateAlerts(store, store.getServer(s.id), { now: later_s });
      eq(later.filter((a) => a.kind === 'regression').length, 1,
        'it comes back once there is somewhere to send it');
    });

    await test('a delivered finding is consumed exactly once', async () => {
      const store = openStore(':memory:');
      const server = serverWith(store);
      store.saveRegression({ serverId: server.id, resource: 'qb-fuel', changedS: NOW - 7200,
        detectedS: NOW, beforeHitchRate: 1, afterHitchRate: 9, beforeP95: 4, afterP95: 90,
        beforeStallRatio: 10, afterStallRatio: 120, score: 3.2, confidence: 'high',
        method: 'day-over-day' });
      await dispatchAlerts(store, server, evaluateAlerts(store, server, { now: NOW }),
        { now: NOW, fetchImpl: async () => ({ ok: true, status: 204 }) });
      const later = evaluateAlerts(store, server, { now: NOW + 7 * 3600 });
      eq(later.filter((a) => a.kind === 'regression').length, 0, 'not repeated');
    });
  });

  await suite('wiring: an ordinary batch does not erase what we know', async () => {
    await test('the agent version survives a payload that carries no agent block', async () => {
      const store = openStore(':memory:');
      const s = store.createServer({ name: 'rp', plan: 'team', createdS: NOW });
      const handler = createIngestHandler({ store, config: loadConfig({}), clock: () => NOW });
      const sample = (at) => ({ kind: 'tick', wall: NOW, at, players: 10, resources: 200,
        samples: 300, meanDriftMs: 1, p50DriftMs: 1, p95DriftMs: 4, p99DriftMs: 9,
        maxDriftMs: 40, stallMs: 0, hitches: 0 });

      await handler(mockRequest({ token: s.token,
        body: { samples: [sample(15000)], agent: { version: '0.1.0' } } }), mockResponse());
      eq(store.getServer(s.id).agent_version, '0.1.0', 'learned from the first batch');

      await handler(mockRequest({ token: s.token, body: { samples: [sample(30000)] } }), mockResponse());
      eq(store.getServer(s.id).agent_version, '0.1.0',
        'and not blanked by the next one, which reported perfectly well');
    });
  });
}
