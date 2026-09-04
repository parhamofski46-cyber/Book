# Changelog

## v0.1.0 — unreleased

First release. Collector, backend, dashboard and alerting.

**Collector** (FiveM resource, Lua, MIT, no dependencies)
- Main-thread stall detection by measuring its own lateness
- Resource inventory and restart tracking, from both the lifecycle event and
  a reconciling poll
- Self-instrumentation: measures its own CPU, reports it in every payload, and
  halves its sampling rate if it exceeds its budget
- Fixed-size send queue with exponential backoff; an unreachable backend costs
  samples, never server memory
- Every setting exposed as a convar

**Backend** (Node 22.5+, standard library only, SQLite via `node:sqlite`)
- Token-authenticated ingest that clamps and bounds everything it is sent, and
  keeps the good rows of a partly malformed batch
- Regression attribution: day-over-day baseline, population-matched
  comparison, and a required local step at the change
- Health scoring that decomposes into the numbers behind it
- Fleet comparison within a population cohort, which declines to answer when
  the cohort is too small
- Per-plan retention with an additive hourly rollup
- Server-rendered dashboard, no build step, CSP pinning its one script by hash
- Discord alerting with per-condition cooldowns
- Dashboard and API require the admin token or that server's own token; a
  forbidden server answers identically to a missing one

**Testing**
- 99 tests: 24 collector (Lua), 75 backend (Node)
- A virtual-time FiveM simulator the collector runs inside **unmodified**
- End-to-end suite replays the bytes the collector really shipped, against the
  ground truth of every injected fault

**Known limits**
- Validated against the simulator, not yet against a live server
- No per-resource CPU attribution: no server native provides it
- Stall timing is accurate to one probe interval, so reported stall time is a
  lower bound
- SQLite only; ample for the scale this serves, but not a cluster
