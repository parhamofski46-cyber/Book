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
