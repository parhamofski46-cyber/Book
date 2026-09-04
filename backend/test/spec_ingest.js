import { suite, test, eq, ok, gt, lte } from './harness.js';
import { openStore } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';
import { createIngestHandler } from '../src/http/ingest.js';
import { mockRequest, mockResponse } from './helpers.js';

const NOW = 1788220800;

function setup(overrides = {}) {
  const store = openStore(':memory:');
  const config = { ...loadConfig({}), ...overrides };
  const server = store.createServer({ name: 'rp', plan: 'team', createdS: NOW });
  let clockValue = NOW;
  const handler = createIngestHandler({ store, config, clock: () => clockValue });
  return { store, config, server, handler, setClock: (v) => { clockValue = v; } };
}

const sample = (over = {}) => ({
  kind: 'tick', wall: NOW, at: 15000, players: 80, resources: 200, samples: 300,
  meanDriftMs: 2, p50DriftMs: 1, p95DriftMs: 5, p99DriftMs: 20, maxDriftMs: 300,
  stallMs: 300, hitches: 1, ...over,
});

async function post(handler, token, body) {
  const res = mockResponse();
  await handler(mockRequest({ token, body }), res);
  return res;
}

export default async function run() {
  await suite('ingest: authentication', async () => {
    await test('a missing token is refused', async () => {
      const { handler } = setup();
      eq((await post(handler, undefined, {})).statusCode, 401);
    });

    await test('a wrong token is refused identically', async () => {
      const { handler } = setup();
      const res = await post(handler, 'pls_not_a_real_token', {});
      eq(res.statusCode, 401);
      // Same body as the missing-token case: a prober learns nothing about
      // whether a token exists.
      eq(res.json().error, 'unauthorised');
    });

    await test('a valid token is accepted', async () => {
      const { handler, server } = setup();
      const res = await post(handler, server.token, { samples: [sample()] });
      eq(res.statusCode, 200);
      eq(res.json().stored, 1);
    });
  });

  await suite('ingest: hostile input', async () => {
    await test('malformed JSON is rejected without throwing', async () => {
      const { handler, server } = setup();
      const res = mockResponse();
      await handler(mockRequest({ token: server.token, body: '{not json' }), res);
      eq(res.statusCode, 400);
    });

    await test('a partly bad batch keeps its good rows', async () => {
      const { handler, server } = setup();
      const res = await post(handler, server.token, {
        samples: [sample(), { kind: 'nonsense' }, null, sample({ at: 30000 })],
      });
      eq(res.statusCode, 200);
      eq(res.json().stored, 2, 'both valid samples stored');
      eq(res.json().skipped, 2, 'the rest reported as skipped');
    });

    await test('absurd numbers are clamped rather than trusted', async () => {
      const { handler, server, store } = setup();
      await post(handler, server.token, {
        samples: [sample({ players: 1e12, stallMs: -5, p95DriftMs: 'abc', hitches: Infinity })],
      });
      const row = store.samplesBetween(1, 0, 2e10)[0];
      lte(row.players, 10000, 'player count clamped');
      eq(row.stall_ms, 0, 'negative stall clamped to zero');
      eq(row.p95_drift, 0, 'non-numeric drift falls back to zero');
      ok(Number.isFinite(row.hitches), 'infinity did not reach the database');
    });

    await test('a wildly wrong clock is refused, not stored', async () => {
      const { handler, server } = setup();
      const res = await post(handler, server.token, {
        samples: [sample({ wall: NOW + 40 * 86400 }), sample({ wall: 0 })],
      });
      eq(res.json().stored, 0, 'nothing stored');
      eq(res.json().skipped, 2, 'both rejected for clock skew');
    });

    await test('an oversized batch is truncated, not buffered', async () => {
      const { handler, server } = setup();
      const samples = Array.from({ length: 900 }, (_, i) => sample({ at: i * 15000, wall: NOW + i }));
      const res = await post(handler, server.token, { samples });
      lte(res.json().stored, 500, 'batch cap enforced');
    });
  });

  await suite('ingest: behaviour under repetition', async () => {
    await test('a resent batch is not counted twice', async () => {
      const { handler, server } = setup();
      const body = { samples: [sample(), sample({ at: 30000, wall: NOW + 15 })] };
      eq((await post(handler, server.token, body)).json().stored, 2);
      const again = await post(handler, server.token, body);
      eq(again.json().stored, 0, 'nothing new stored');
      eq(again.json().duplicates, 2, 'duplicates reported honestly');
    });

    await test('a runaway agent is rate limited', async () => {
      const { handler, server } = setup({ ingestPerMinute: 5 });
      let limited = 0;
      for (let i = 0; i < 12; i++) {
        const res = await post(handler, server.token, { samples: [sample({ at: i * 15000, wall: NOW + i })] });
        if (res.statusCode === 429) limited++;
      }
      gt(limited, 0, 'some requests refused');
      eq(limited, 7, 'exactly the requests past the limit');
    });

    await test('the agent health report is recorded', async () => {
      const { handler, server, store } = setup();
      await post(handler, server.token, {
        samples: [sample()],
        agent: { version: '0.1.0', cpuRatio: 0.00008, degraded: false, buffered: 3, droppedSamples: 0 },
      });
      const health = store.latestHealth(server.id);
      eq(health.version, '0.1.0');
      ok(health.cpu_ratio > 0, 'cost recorded');
      eq(store.getServer(server.id).agent_version, '0.1.0', 'server row updated');
    });
  });
}
