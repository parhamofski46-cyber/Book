// Schema and migrations.
//
// Migrations are an ordered list applied against PRAGMA user_version, so a
// self-hosted instance upgrades by restarting and never needs a migration tool.

const MIGRATIONS = [
  // 1 -- initial
  `
  CREATE TABLE servers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    token_hash      TEXT    NOT NULL UNIQUE,
    plan            TEXT    NOT NULL DEFAULT 'free',
    discord_webhook TEXT,
    created_s       INTEGER NOT NULL,
    last_seen_s     INTEGER,
    agent_version   TEXT
  );

  -- One row per collector window. wall_s is the axis everything is read on:
  -- the collector's own uptime clock resets with the server, and receive time
  -- is wrong for anything that sat in the agent's buffer during an outage.
  CREATE TABLE samples (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    wall_s      INTEGER NOT NULL,
    uptime_ms   INTEGER NOT NULL,
    received_s  INTEGER NOT NULL,
    players     INTEGER NOT NULL DEFAULT 0,
    resources   INTEGER NOT NULL DEFAULT 0,
    probes      INTEGER NOT NULL DEFAULT 0,
    mean_drift  REAL    NOT NULL DEFAULT 0,
    p50_drift   REAL    NOT NULL DEFAULT 0,
    p95_drift   REAL    NOT NULL DEFAULT 0,
    p99_drift   REAL    NOT NULL DEFAULT 0,
    max_drift   REAL    NOT NULL DEFAULT 0,
    stall_ms    INTEGER NOT NULL DEFAULT 0,
    hitches     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX samples_server_time ON samples(server_id, wall_s);
  -- The agent may resend a window after a failed batch; the pair is the
  -- natural key, and dropping duplicates is cheaper than deduplicating reads.
  CREATE UNIQUE INDEX samples_dedupe ON samples(server_id, wall_s, uptime_ms);

  CREATE TABLE resource_changes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    wall_s     INTEGER NOT NULL,
    uptime_ms  INTEGER NOT NULL,
    resource   TEXT    NOT NULL,
    change     TEXT    NOT NULL,
    source     TEXT    NOT NULL
  );
  CREATE INDEX changes_server_time ON resource_changes(server_id, wall_s);
  CREATE INDEX changes_resource ON resource_changes(server_id, resource, wall_s);
  CREATE UNIQUE INDEX changes_dedupe
    ON resource_changes(server_id, wall_s, resource, change, source);

  -- Hourly fold of samples. Cheap enough to keep long after the raw windows
  -- are pruned, which is what makes month-scale comparison possible at all.
  CREATE TABLE samples_hourly (
    server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    hour_s      INTEGER NOT NULL,
    windows     INTEGER NOT NULL,
    probes      INTEGER NOT NULL,
    players_max INTEGER NOT NULL,
    players_avg REAL    NOT NULL,
    mean_drift  REAL    NOT NULL,
    p95_max     REAL    NOT NULL,
    max_drift   REAL    NOT NULL,
    stall_ms    INTEGER NOT NULL,
    hitches     INTEGER NOT NULL,
    PRIMARY KEY (server_id, hour_s)
  );

  -- Agent self-reported health, so an operator can see the collector's own
  -- cost and whether it is dropping data.
  CREATE TABLE agent_health (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    received_s  INTEGER NOT NULL,
    version     TEXT,
    uptime_ms   INTEGER,
    cpu_ratio   REAL,
    degraded    INTEGER,
    buffered    INTEGER,
    dropped     INTEGER
  );
  CREATE INDEX agent_health_server_time ON agent_health(server_id, received_s);

  -- Findings, persisted rather than recomputed on every page load so alerts
  -- have something stable to deduplicate against.
  CREATE TABLE regressions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id     INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    resource      TEXT    NOT NULL,
    changed_s     INTEGER NOT NULL,
    detected_s    INTEGER NOT NULL,
    before_hitch_rate REAL NOT NULL,
    after_hitch_rate  REAL NOT NULL,
    before_p95    REAL NOT NULL,
    after_p95     REAL NOT NULL,
    before_stall_ratio REAL NOT NULL,
    after_stall_ratio  REAL NOT NULL,
    score         REAL    NOT NULL,
    confidence    TEXT    NOT NULL,
    notified_s    INTEGER
  );
  CREATE UNIQUE INDEX regressions_unique ON regressions(server_id, resource, changed_s);

  CREATE TABLE alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    dedupe_key TEXT    NOT NULL,
    fired_s    INTEGER NOT NULL,
    delivered  INTEGER NOT NULL DEFAULT 0,
    detail     TEXT
  );
  CREATE INDEX alerts_lookup ON alerts(server_id, kind, dedupe_key, fired_s);
  `,
  // 2 -- record how a finding was reached, so the dashboard can say whether it
  // came from a day-over-day baseline or an adjacent-window comparison.
  `ALTER TABLE regressions ADD COLUMN method TEXT NOT NULL DEFAULT 'adjacent';`,
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${v + 1} failed: ${err.message}`, { cause: err });
    }
  }
  return MIGRATIONS.length;
}

export const SCHEMA_VERSION = MIGRATIONS.length;
