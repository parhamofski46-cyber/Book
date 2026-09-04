// The ingest endpoint.
//
// This is the only route an untrusted party reaches, and it is reached by
// software running on someone else's machine. Everything arriving here is
// treated as hostile: sizes are bounded, numbers are clamped, and a payload
// that is partly malformed contributes its good rows rather than failing whole
// -- a collector that cannot deliver is a collector that eventually drops.

import { readJson, bearer, sendJson } from './router.js';
import { nowS } from '../db/store.js';

const MAX_SAMPLES_PER_BATCH = 500;
const MAX_CHANGES_PER_SAMPLE = 200;

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, fallback = 0) => Math.round(clamp(num(v, fallback), lo, hi));

/** Reject a sample outright only when its time is unusable. */
function normaliseSample(raw, receivedS, maxSkew) {
  if (!raw || raw.kind !== 'tick') return null;
  const wall = Math.round(num(raw.wall, 0));
  if (!wall || Math.abs(wall - receivedS) > maxSkew) return null;

  return {
    wall_s: wall,
    uptime_ms: int(raw.at, 0, 2 ** 42),
    players: int(raw.players, 0, 10000),
    resources: int(raw.resources, 0, 10000),
    probes: int(raw.samples, 0, 10 ** 7),
    mean_drift: clamp(num(raw.meanDriftMs), 0, 10 ** 6),
    p50_drift: clamp(num(raw.p50DriftMs), 0, 10 ** 6),
    p95_drift: clamp(num(raw.p95DriftMs), 0, 10 ** 6),
    p99_drift: clamp(num(raw.p99DriftMs), 0, 10 ** 6),
    max_drift: clamp(num(raw.maxDriftMs), 0, 10 ** 6),
    stall_ms: int(raw.stallMs, 0, 10 ** 9),
    hitches: int(raw.hitches, 0, 10 ** 7),
  };
}

function normaliseChanges(raw, fallbackWall, receivedS, maxSkew) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const c of raw.slice(0, MAX_CHANGES_PER_SAMPLE)) {
    if (!c || typeof c.resource !== 'string' || typeof c.change !== 'string') continue;
    const wall = Math.round(num(c.wall, fallbackWall));
    if (!wall || Math.abs(wall - receivedS) > maxSkew) continue;
    out.push({
      wall_s: wall,
      uptime_ms: int(c.at, 0, 2 ** 42),
      resource: c.resource.slice(0, 128),
      change: c.change.slice(0, 32),
      source: (typeof c.source === 'string' ? c.source : 'unknown').slice(0, 16),
    });
  }
  return out;
}

function normaliseHealth(agent) {
  if (!agent || typeof agent !== 'object') return null;
  return {
    version: typeof agent.version === 'string' ? agent.version.slice(0, 32) : null,
    uptime_ms: int(agent.uptimeMs, 0, 2 ** 42),
    cpu_ratio: clamp(num(agent.cpuRatio), 0, 1),
    degraded: Boolean(agent.degraded),
    buffered: int(agent.buffered, 0, 10 ** 7),
    dropped: int(agent.droppedSamples, 0, 10 ** 9),
  };
}

export function createIngestHandler({ store, config, onServerData, clock = nowS }) {
  // Fixed-window rate limit, held in memory. A restart forgets it, which is
  // fine: this exists to blunt a runaway agent, not to meter billing.
  const windows = new Map();

  const rateLimited = (serverId, now) => {
    const minute = Math.floor(now / 60);
    const entry = windows.get(serverId);
    if (!entry || entry.minute !== minute) {
      windows.set(serverId, { minute, count: 1 });
      if (windows.size > 10000) {
        for (const [k, v] of windows) if (v.minute < minute) windows.delete(k);
      }
      return false;
    }
    entry.count += 1;
    return entry.count > config.ingestPerMinute;
  };

  return async function handleIngest(req, res) {
    const token = bearer(req);
    const server = store.findServerByToken(token);
    // Same response for a missing and a wrong token: a prober learns nothing.
    if (!server) return sendJson(res, 401, { error: 'unauthorised' });

    const receivedS = clock();
    if (rateLimited(server.id, receivedS)) {
      res.setHeader('retry-after', '60');
      return sendJson(res, 429, { error: 'rate limited' });
    }

    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.message });
    }

    const rawSamples = Array.isArray(body.samples) ? body.samples.slice(0, MAX_SAMPLES_PER_BATCH) : [];
    const samples = [];
    const changes = [];
    let skipped = 0;

    for (const raw of rawSamples) {
      const sample = normaliseSample(raw, receivedS, config.maxClockSkewSeconds);
      if (!sample) { skipped++; continue; }
      samples.push(sample);
      changes.push(...normaliseChanges(raw.resourceChanges, sample.wall_s, receivedS, config.maxClockSkewSeconds));
    }

    const health = normaliseHealth(body.agent);
    const stored = store.writeBatch(server.id, { samples, changes, health, receivedS });
    store.touchServer(server.id, receivedS, health?.version);

    // Analysis and alerting run off the write path so a slow rule never
    // becomes backpressure on the agent.
    if (stored > 0 && onServerData) {
      queueMicrotask(() => {
        try { onServerData(server, receivedS); }
        catch (err) { console.error('[pulse] post-ingest hook failed:', err.message); }
      });
    }

    return sendJson(res, 200, { ok: true, stored, duplicates: samples.length - stored, skipped });
  };
}
