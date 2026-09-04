import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './schema.js';
import { planFor } from '../config.js';

const HOUR = 3600;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function newToken() {
  // Long enough that guessing is hopeless, URL-safe so it survives a config file.
  return 'pls_' + randomBytes(24).toString('base64url');
}

export function openStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);

  const q = (sql) => db.prepare(sql);

  const stmt = {
    insertServer: q(`INSERT INTO servers (name, token_hash, plan, discord_webhook, created_s)
                     VALUES (?, ?, ?, ?, ?)`),
    byTokenHash: q('SELECT * FROM servers WHERE token_hash = ?'),
    byId: q('SELECT * FROM servers WHERE id = ?'),
    allServers: q('SELECT * FROM servers ORDER BY id'),
    touch: q('UPDATE servers SET last_seen_s = ?, agent_version = ? WHERE id = ?'),
    setPlan: q('UPDATE servers SET plan = ? WHERE id = ?'),
    setWebhook: q('UPDATE servers SET discord_webhook = ? WHERE id = ?'),

    insertSample: q(`INSERT OR IGNORE INTO samples
      (server_id, wall_s, uptime_ms, received_s, players, resources, probes,
       mean_drift, p50_drift, p95_drift, p99_drift, max_drift, stall_ms, hitches)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    insertChange: q(`INSERT OR IGNORE INTO resource_changes
      (server_id, wall_s, uptime_ms, resource, change, source) VALUES (?,?,?,?,?,?)`),
    insertHealth: q(`INSERT INTO agent_health
      (server_id, received_s, version, uptime_ms, cpu_ratio, degraded, buffered, dropped)
      VALUES (?,?,?,?,?,?,?,?)`),

    samplesBetween: q(`SELECT * FROM samples WHERE server_id = ? AND wall_s >= ? AND wall_s < ?
                       ORDER BY wall_s`),
    hourlyBetween: q(`SELECT * FROM samples_hourly WHERE server_id = ? AND hour_s >= ? AND hour_s < ?
                      ORDER BY hour_s`),
    changesBetween: q(`SELECT * FROM resource_changes WHERE server_id = ? AND wall_s >= ? AND wall_s < ?
                       ORDER BY wall_s`),
    latestSample: q('SELECT * FROM samples WHERE server_id = ? ORDER BY wall_s DESC LIMIT 1'),
    latestHealth: q('SELECT * FROM agent_health WHERE server_id = ? ORDER BY received_s DESC LIMIT 1'),
    countSince: q('SELECT COUNT(*) AS n FROM agent_health WHERE server_id = ? AND received_s >= ?'),

    saveRegression: q(`INSERT INTO regressions
      (server_id, resource, changed_s, detected_s, before_hitch_rate, after_hitch_rate,
       before_p95, after_p95, before_stall_ratio, after_stall_ratio, score, confidence, method)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(server_id, resource, changed_s) DO UPDATE SET
        detected_s = excluded.detected_s,
        after_hitch_rate = excluded.after_hitch_rate,
        after_p95 = excluded.after_p95,
        after_stall_ratio = excluded.after_stall_ratio,
        score = excluded.score,
        confidence = excluded.confidence,
        method = excluded.method`),
    listRegressions: q(`SELECT * FROM regressions WHERE server_id = ? AND changed_s >= ?
                        ORDER BY score DESC, changed_s DESC LIMIT ?`),
    unnotifiedRegressions: q(`SELECT * FROM regressions
                              WHERE server_id = ? AND notified_s IS NULL AND score >= ?
                              ORDER BY score DESC`),
    markNotified: q('UPDATE regressions SET notified_s = ? WHERE id = ?'),

    lastAlert: q(`SELECT * FROM alerts WHERE server_id = ? AND kind = ? AND dedupe_key = ?
                  ORDER BY fired_s DESC LIMIT 1`),
    insertAlert: q(`INSERT INTO alerts (server_id, kind, dedupe_key, fired_s, delivered, detail)
                    VALUES (?,?,?,?,?,?)`),
    recentAlerts: q(`SELECT * FROM alerts WHERE server_id = ? ORDER BY fired_s DESC LIMIT ?`),

    // Fold raw windows into hourly buckets. Additive so a bucket that already
    // exists keeps what it had -- the raw rows are deleted in the same
    // transaction, so folding twice cannot double-count.
    rollup: q(`
      INSERT INTO samples_hourly
        (server_id, hour_s, windows, probes, players_max, players_avg, mean_drift, p95_max, max_drift, stall_ms, hitches)
      SELECT server_id, (wall_s / ${HOUR}) * ${HOUR}, COUNT(*), COALESCE(SUM(probes),0),
             COALESCE(MAX(players),0), COALESCE(AVG(players),0),
             COALESCE(SUM(mean_drift * probes) / NULLIF(SUM(probes),0), 0),
             COALESCE(MAX(p95_drift),0), COALESCE(MAX(max_drift),0),
             COALESCE(SUM(stall_ms),0), COALESCE(SUM(hitches),0)
      FROM samples WHERE server_id = ? AND wall_s < ?
      GROUP BY server_id, (wall_s / ${HOUR}) * ${HOUR}
      ON CONFLICT(server_id, hour_s) DO UPDATE SET
        players_avg = (samples_hourly.players_avg * samples_hourly.windows
                       + excluded.players_avg * excluded.windows)
                      / NULLIF(samples_hourly.windows + excluded.windows, 0),
        mean_drift  = (samples_hourly.mean_drift * samples_hourly.probes
                       + excluded.mean_drift * excluded.probes)
                      / NULLIF(samples_hourly.probes + excluded.probes, 0),
        windows     = samples_hourly.windows + excluded.windows,
        probes      = samples_hourly.probes + excluded.probes,
        players_max = MAX(samples_hourly.players_max, excluded.players_max),
        p95_max     = MAX(samples_hourly.p95_max, excluded.p95_max),
        max_drift   = MAX(samples_hourly.max_drift, excluded.max_drift),
        stall_ms    = samples_hourly.stall_ms + excluded.stall_ms,
        hitches     = samples_hourly.hitches + excluded.hitches`),
    pruneRaw: q('DELETE FROM samples WHERE server_id = ? AND wall_s < ?'),
    pruneHourly: q('DELETE FROM samples_hourly WHERE server_id = ? AND hour_s < ?'),
    pruneChanges: q('DELETE FROM resource_changes WHERE server_id = ? AND wall_s < ?'),
    pruneHealth: q('DELETE FROM agent_health WHERE server_id = ? AND received_s < ?'),
    pruneAlerts: q('DELETE FROM alerts WHERE server_id = ? AND fired_s < ?'),

    // Fleet comparison. Buckets by typical population so a 30-player server is
    // not measured against a 200-player one.
    fleetRows: q(`
      SELECT s.server_id,
             SUM(s.stall_ms) AS stall_ms,
             SUM(s.hitches)  AS hitches,
             SUM(s.probes)   AS probes,
             COUNT(*)        AS windows,
             AVG(s.players)  AS players_avg
      FROM samples s
      WHERE s.wall_s >= ?
      GROUP BY s.server_id
      HAVING windows >= ?`),
  };

  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  };

  return {
    db,
    close: () => db.close(),

    createServer({ name, plan = 'free', webhook = null, token = newToken(), createdS = nowS() }) {
      const info = stmt.insertServer.run(name, hashToken(token), plan, webhook, createdS);
      return { id: Number(info.lastInsertRowid), name, plan, token };
    },
    // Lookup is by SHA-256 of the presented token, so what is stored is never
    // the secret, and the comparison the database performs is against a hash
    // the caller could only produce by already holding the token. A
    // constant-time compare afterwards would be comparing the row to the very
    // value it was found by, which proves nothing -- so there isn't one.
    findServerByToken(token) {
      if (typeof token !== 'string' || token.length < 8) return null;
      return stmt.byTokenHash.get(hashToken(token)) ?? null;
    },
    getServer: (id) => stmt.byId.get(id) ?? null,
    listServers: () => stmt.allServers.all(),
    touchServer: (id, seenS, version) => stmt.touch.run(seenS, version ?? null, id),
    setPlan: (id, plan) => stmt.setPlan.run(plan, id),
    setWebhook: (id, url) => stmt.setWebhook.run(url, id),

    writeBatch(serverId, { samples = [], changes = [], health = null, receivedS }) {
      return tx(() => {
        let stored = 0;
        for (const s of samples) {
          const info = stmt.insertSample.run(
            serverId, s.wall_s, s.uptime_ms, receivedS, s.players, s.resources, s.probes,
            s.mean_drift, s.p50_drift, s.p95_drift, s.p99_drift, s.max_drift, s.stall_ms, s.hitches);
          stored += info.changes;
        }
        for (const c of changes) {
          stmt.insertChange.run(serverId, c.wall_s, c.uptime_ms, c.resource, c.change, c.source);
        }
        if (health) {
          stmt.insertHealth.run(serverId, receivedS, health.version ?? null, health.uptime_ms ?? null,
            health.cpu_ratio ?? null, health.degraded ? 1 : 0, health.buffered ?? null, health.dropped ?? null);
        }
        return stored;
      });
    },

    samplesBetween: (id, from, to) => stmt.samplesBetween.all(id, from, to),
    hourlyBetween: (id, from, to) => stmt.hourlyBetween.all(id, from, to),
    changesBetween: (id, from, to) => stmt.changesBetween.all(id, from, to),
    latestSample: (id) => stmt.latestSample.get(id) ?? null,
    latestHealth: (id) => stmt.latestHealth.get(id) ?? null,
    ingestCountSince: (id, sinceS) => stmt.countSince.get(id, sinceS).n,

    saveRegression: (r) => stmt.saveRegression.run(
      r.serverId, r.resource, r.changedS, r.detectedS, r.beforeHitchRate, r.afterHitchRate,
      r.beforeP95, r.afterP95, r.beforeStallRatio, r.afterStallRatio, r.score, r.confidence,
      r.method ?? 'adjacent'),
    listRegressions: (id, sinceS, limit = 50) => stmt.listRegressions.all(id, sinceS, limit),
    unnotifiedRegressions: (id, minScore) => stmt.unnotifiedRegressions.all(id, minScore),
    markRegressionNotified: (rid, atS) => stmt.markNotified.run(atS, rid),

    lastAlert: (id, kind, key) => stmt.lastAlert.get(id, kind, key) ?? null,
    recordAlert: (id, kind, key, firedS, delivered, detail) =>
      stmt.insertAlert.run(id, kind, key, firedS, delivered ? 1 : 0, detail ?? null),
    recentAlerts: (id, limit = 20) => stmt.recentAlerts.all(id, limit),

    // Applies each server's plan: fold raw into hourly, then prune both.
    maintain(nowSeconds = nowS()) {
      const summary = { rolled: 0, prunedRaw: 0, prunedHourly: 0 };
      for (const server of stmt.allServers.all()) {
        const plan = planFor(server.plan);
        const rawCutoff = nowSeconds - plan.rawDays * 86400;
        const hourlyCutoff = nowSeconds - plan.hourlyDays * 86400;
        tx(() => {
          summary.rolled += stmt.rollup.run(server.id, rawCutoff).changes;
          summary.prunedRaw += stmt.pruneRaw.run(server.id, rawCutoff).changes;
          summary.prunedHourly += stmt.pruneHourly.run(server.id, hourlyCutoff).changes;
          stmt.pruneChanges.run(server.id, hourlyCutoff);
          stmt.pruneHealth.run(server.id, rawCutoff);
          stmt.pruneAlerts.run(server.id, hourlyCutoff);
        });
      }
      return summary;
    },

    fleetRows: (sinceS, minWindows) => stmt.fleetRows.all(sinceS, minWindows),
  };
}

export const nowS = () => Math.floor(Date.now() / 1000);
