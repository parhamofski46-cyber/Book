#!/usr/bin/env node
// Load a simulated server's telemetry into a real database, so there is
// something to look at without waiting three days for a live server to
// produce it.
//
//   make fixtures                       # generate the recording first
//   node backend/scripts/seed-demo.js   # then load it
//
// Times are shifted so the recording ends "now": a demo dated three days ago
// shows empty charts on every default range, which is worse than no demo.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openStore, nowS } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';
import { createIngestHandler } from '../src/http/ingest.js';
import { runRegressionAnalysis } from '../src/analysis/regression.js';
import { Readable } from 'node:stream';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(process.argv[2] ?? join(HERE, '../test/fixtures/threeday.jsonl'));
const dbPath = resolve(process.env.PULSE_DB ?? join(HERE, '../data/pulse.db'));

if (!existsSync(fixture)) {
  console.error(`No recording at ${fixture}. Run "make fixtures" first.`);
  process.exit(1);
}

const payloads = readFileSync(fixture, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const lastWall = payloads.at(-1).samples.at(-1).wall;
const shift = nowS() - lastWall;

const store = openStore(dbPath);
const config = loadConfig({});
const server = store.createServer({ name: 'demo-rp', plan: 'team' });

let clockValue = 0;
const handler = createIngestHandler({ store, config, clock: () => clockValue });

const mockRes = () => ({
  statusCode: 0, headers: {}, body: '',
  setHeader() {}, writeHead(s) { this.statusCode = s; return this; }, end(c) { if (c) this.body += c; },
});

let stored = 0;
for (const payload of payloads) {
  const shifted = {
    ...payload,
    samples: (payload.samples ?? []).map((s) => ({
      ...s,
      wall: s.wall + shift,
      resourceChanges: (s.resourceChanges ?? []).map((c) => ({ ...c, wall: (c.wall ?? s.wall) + shift })),
    })),
  };
  clockValue = shifted.samples.at(-1)?.wall ?? nowS();
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(shifted))]), {
    method: 'POST', url: '/v1/ingest',
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
  });
  const res = mockRes();
  await handler(req, res);
  if (res.statusCode === 200) stored += JSON.parse(res.body).stored;
}

const findings = runRegressionAnalysis(store, server.id, { now: nowS() });

console.log(`seeded ${stored} windows into ${dbPath}`);
console.log(`server id ${server.id}, token ${server.token}`);
console.log(`regressions found: ${findings.map((f) => `${f.resource} (${f.confidence})`).join(', ') || 'none'}`);
console.log(`\nstart the backend and open:  /s/${server.id}?token=${server.token}`);
