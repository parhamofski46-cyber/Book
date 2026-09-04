// The install path.
//
// Everything here is about the first ten minutes. A monitoring tool that is
// fiddly to connect never gets connected, and nobody ever sees the part that
// works.

import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test, eq, ok, contains, gt } from './harness.js';
import { openStore } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';
import { resolveAdminToken, adminTokenPath } from '../src/admin-token.js';
import { serverDetailPage } from '../src/http/pages.js';
import { createIngestHandler } from '../src/http/ingest.js';
import { mockRequest, mockResponse } from './helpers.js';

const NOW = 1788220800;

export default async function run() {
  await suite('onboarding: a server that has never reported', async () => {
    const store = openStore(':memory:');
    const server = store.createServer({ name: 'fresh-rp', plan: 'team', createdS: NOW });

    await test('the empty state is the setup instructions, not "no data"', async () => {
      const html = serverDetailPage(store, store.getServer(server.id),
        { now: NOW, publicUrl: 'https://pulse.example' });
      contains(html, 'Waiting for fresh-rp', 'says what it is waiting for');
      contains(html, 'https://pulse.example/v1/ingest', 'endpoint already filled in');
      contains(html, 'pulse_collector', 'names the resource folder');
      contains(html, 'pulse test', 'points at the one command that diagnoses it');
    });

    await test('the config block carries the server name it was registered under', async () => {
      const html = serverDetailPage(store, store.getServer(server.id), { now: NOW });
      contains(html, 'set pulse_server_name "fresh-rp"', 'no placeholder to guess at');
    });

    await test('once telemetry arrives the setup card gives way to the numbers', async () => {
      const rows = Array.from({ length: 30 }, (_, i) => ({
        wall_s: NOW - 450 + i * 15, uptime_ms: i * 15000, players: 40, resources: 200,
        probes: 300, mean_drift: 2, p50_drift: 1, p95_drift: 5, p99_drift: 20,
        max_drift: 80, stall_ms: 0, hitches: 0,
      }));
      store.writeBatch(server.id, { samples: rows, receivedS: NOW });
      store.touchServer(server.id, NOW, '0.1.0');

      const html = serverDetailPage(store, store.getServer(server.id), { now: NOW });
      ok(!html.includes('Waiting for fresh-rp'), 'setup card gone');
      contains(html, 'Health (last hour)', 'replaced by the real page');
    });
  });

  await suite('onboarding: the token a server is given actually works', async () => {
    await test('a freshly registered token is accepted by ingest', async () => {
      // The same path add-server.js takes, checked end to end: a token that
      // does not work would be discovered by the operator, not by us.
      const store = openStore(':memory:');
      const created = store.createServer({ name: 'new-rp', plan: 'team', createdS: NOW });

      const handler = createIngestHandler({ store, config: loadConfig({}), clock: () => NOW });
      const res = mockResponse();
      await handler(mockRequest({
        token: created.token,
        body: { samples: [{ kind: 'tick', wall: NOW, at: 15000, players: 10, resources: 200,
          samples: 300, meanDriftMs: 1, p50DriftMs: 1, p95DriftMs: 4, p99DriftMs: 9,
          maxDriftMs: 40, stallMs: 0, hitches: 0 }] },
      }), res);

      eq(res.statusCode, 200, 'accepted');
      eq(res.json().stored, 1, 'and stored');
    });

    await test('an empty batch is a valid connectivity probe', async () => {
      // What "pulse test" sends. It has to be accepted, or the diagnostic
      // would report a working setup as broken.
      const store = openStore(':memory:');
      const created = store.createServer({ name: 'probe-rp', createdS: NOW });
      const handler = createIngestHandler({ store, config: loadConfig({}), clock: () => NOW });
      const res = mockResponse();
      await handler(mockRequest({ token: created.token, body: { samples: [], agent: { probe: true } } }), res);
      eq(res.statusCode, 200, 'a probe with no samples is still a 200');
      eq(res.json().stored, 0, 'and stores nothing');
    });
  });

  await suite('onboarding: the admin token bootstraps itself', async () => {
    let dir;
    const setup = () => {
      dir = mkdtempSync(join(tmpdir(), 'pulse-'));
      return { ...loadConfig({}), dbPath: join(dir, 'pulse.db'), adminToken: '' };
    };
    const cleanup = () => rmSync(dir, { recursive: true, force: true });

    await test('first run generates one and keeps it beside the database', async () => {
      const config = setup();
      const token = resolveAdminToken(config, { quiet: true });
      ok(token.startsWith('adm_'), 'a token was made');
      const path = adminTokenPath(config.dbPath);
      ok(existsSync(path), 'saved to disk');
      eq(readFileSync(path, 'utf8').trim(), token, 'and it is the one that was returned');
      cleanup();
    });

    await test('it is not readable by anyone else on the machine', async () => {
      const config = setup();
      resolveAdminToken(config, { quiet: true });
      const mode = statSync(adminTokenPath(config.dbPath)).mode & 0o777;
      eq(mode, 0o600, 'owner read/write only');
      cleanup();
    });

    await test('a second run reuses it rather than locking the operator out', async () => {
      const config = setup();
      const first = resolveAdminToken(config, { quiet: true });
      const second = resolveAdminToken(config, { quiet: true });
      eq(first, second, 'stable across restarts');
      cleanup();
    });

    await test('an explicitly configured token always wins', async () => {
      const config = { ...setup(), adminToken: 'chosen-by-the-operator' };
      eq(resolveAdminToken(config, { quiet: true }), 'chosen-by-the-operator');
      ok(!existsSync(adminTokenPath(config.dbPath)), 'and nothing is written');
      cleanup();
    });

    await test('the admin API can still be shut off deliberately', async () => {
      const config = setup();
      process.env.PULSE_NO_ADMIN = '1';
      try {
        eq(resolveAdminToken(config, { quiet: true }), '', 'no token, so the API stays closed');
        ok(!existsSync(adminTokenPath(config.dbPath)), 'and none is written');
      } finally {
        delete process.env.PULSE_NO_ADMIN;
      }
      cleanup();
    });
  });
}
