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

// Appended: version consistency. Three files carry the version and a mismatch
// ships a resource whose manifest disagrees with what it reports.
export async function versionSuite() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

  await suite('release: the version agrees with itself', async () => {
    const manifest = readFileSync(join(root, 'collector/fxmanifest.lua'), 'utf8')
      .match(/^version '([^']+)'/m)?.[1];
    const lua = readFileSync(join(root, 'collector/server/main.lua'), 'utf8')
      .match(/Pulse\.VERSION = '([^']+)'/)?.[1];
    const pkg = JSON.parse(readFileSync(join(root, 'backend/package.json'), 'utf8')).version;

    await test('fxmanifest, the collector and the backend all say the same thing', async () => {
      ok(manifest, 'the manifest declares a version');
      eq(lua, manifest, 'the collector reports what its manifest declares');
      eq(pkg, manifest, 'the backend agrees');
    });

    await test('the changelog documents it', async () => {
      const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
      contains(changelog, `v${manifest}`, 'the released version has an entry');
    });
  });
}

// Appended: the one-click download.
export async function bundleSuite() {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { bundleCollector, makeZip } = await import('../src/collector-bundle.js');
  const { createApp } = await import('../src/app.js');

  await suite('one-click: the download is a real archive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-zip-'));
    const path = join(dir, 'c.zip');
    writeFileSync(path, bundleCollector({
      endpoint: 'https://box:8787/v1/ingest', token: 'pls_bundled', serverName: 'zip-rp',
    }));

    await test('a real unzip accepts it', async () => {
      // Hand-written zip headers are exactly the sort of thing that looks fine
      // in a unit test and fails on the operator's machine.
      const out = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
      contains(out, 'No errors detected', 'the archive is well formed');
    });

    await test('it extracts as the folder FiveM expects', async () => {
      const listing = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' });
      contains(listing, 'pulse_collector/fxmanifest.lua', 'the manifest is in place');
      contains(listing, 'pulse_collector/server/main.lua', 'and the server scripts');
      contains(listing, 'pulse_collector/LICENSE', 'with its licence');
      contains(listing, 'pulse_collector/INSTALL.txt', 'and instructions');
    });

    await test('the settings inside are this server’s', async () => {
      const settings = JSON.parse(
        execFileSync('unzip', ['-p', path, 'pulse_collector/settings.json'], { encoding: 'utf8' }));
      eq(settings.endpoint, 'https://box:8787/v1/ingest');
      eq(settings.token, 'pls_bundled');
      eq(settings.server_name, 'zip-rp');
    });

    await test('nothing beyond the three bundled settings is written into it', async () => {
      const settings = JSON.parse(
        execFileSync('unzip', ['-p', path, 'pulse_collector/settings.json'], { encoding: 'utf8' }));
      eq(Object.keys(settings).sort().join(','), 'endpoint,server_name,token',
        'tuning stays in convars, where a re-download will not overwrite it');
    });

    await test('an empty archive is still a valid archive', async () => {
      const empty = join(dir, 'empty.zip');
      writeFileSync(empty, makeZip([]));
      // unzip exits non-zero for an archive with no entries even though it
      // parsed the thing perfectly well, so the output is what to read here,
      // not the exit code.
      let out;
      try {
        out = execFileSync('unzip', ['-t', empty], { encoding: 'utf8' });
      } catch (err) {
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      contains(out, 'Archive:', 'unzip read the archive');
      ok(/empty/i.test(out), 'and found it well formed with no entries in it');
    });

    rmSync(dir, { recursive: true, force: true });
  });

  await suite('one-click: who may download it', async () => {
    const store = openStore(':memory:');
    const config = { ...loadConfig({}), adminToken: 'admin-secret', publicUrl: 'https://pulse.test' };
    const app = createApp({ store, config });
    const listening = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${listening.address().port}`;
    const a = store.createServer({ name: 'alpha', plan: 'team' });
    const b = store.createServer({ name: 'beta', plan: 'team' });

    const settingsFrom = async (res) => {
      const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
      const dir = mkdtempSync(join(tmpdir(), 'pulse-dl-'));
      const path = join(dir, 'd.zip');
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      const out = execFileSync('unzip', ['-p', path, 'pulse_collector/settings.json'], { encoding: 'utf8' });
      rmSync(dir, { recursive: true, force: true });
      return JSON.parse(out);
    };

    await test('a stranger gets nothing', async () => {
      eq((await fetch(`${base}/s/${a.id}/collector.zip`, { redirect: 'manual' })).status, 401);
    });

    await test("another server's token gets nothing", async () => {
      const res = await fetch(`${base}/s/${a.id}/collector.zip`,
        { headers: { authorization: `Bearer ${b.token}` }, redirect: 'manual' });
      eq(res.status, 401, 'a download is as protected as the dashboard');
    });

    await test("the server's own token gets it, configured", async () => {
      const res = await fetch(`${base}/s/${a.id}/collector.zip?token=${a.token}`);
      eq(res.status, 200);
      eq(res.headers.get('content-type'), 'application/zip');
      contains(res.headers.get('content-disposition'), 'attachment', 'downloads rather than renders');
      contains(res.headers.get('cache-control'), 'no-store', 'it carries a secret, so nothing caches it');

      const settings = await settingsFrom(res);
      eq(settings.token, a.token, 'the token is baked in');
      eq(settings.endpoint, 'https://pulse.test/v1/ingest', 'pointed at this backend');
      eq(settings.server_name, 'alpha');
    });

    await test('the admin token cannot bake in a secret it does not hold', async () => {
      // Only a hash is stored, so this is not a limitation to work around: a
      // stolen admin token must not yield every server's collector token.
      const res = await fetch(`${base}/s/${a.id}/collector.zip`,
        { headers: { authorization: 'Bearer admin-secret' } });
      eq(res.status, 200, 'still served');
      eq((await settingsFrom(res)).token, '', 'but with no token in it');
    });

    listening.close();
    store.close();
  });
}
