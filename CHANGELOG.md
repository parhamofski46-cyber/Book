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

**Getting it running**
- The backend packages a **pre-configured collector**: a download whose
  `settings.json` already holds that server's endpoint and token, so installing
  is one line in `server.cfg` rather than three convars copied by hand. The
  token is only baked in when the server's own token authenticated the
  download — only a hash is stored, so an admin token cannot produce one.
- `install.sh` brings the backend up and prints that download link
- `add-server.js` registers a server from the command line, replacing a curl
  incantation with a bearer header
- An admin token is generated and kept beside the database on first run, so
  there is no chicken-and-egg between "the admin API needs a token" and "the
  token comes from the admin API". `PULSE_NO_ADMIN=1` still shuts it.
- `pulse test` in the server console reports in one line whether the endpoint
  and token are right — a rejected token, a wrong path and an unreachable
  backend are three different messages
- A server that has never reported shows the setup block on its dashboard page
  instead of an empty chart

**Testing**
- 149 tests: 39 collector (Lua), 110 backend (Node)
- A virtual-time FiveM simulator the collector runs inside **unmodified**
- End-to-end suite replays the bytes the collector really shipped, against the
  ground truth of every injected fault
- `make verify` runs the real collector against a real backend over real HTTP,
  which is the only check that exercises Lua, the network and Node together

**Licence**
- Collector and tooling: MIT
- Backend: Elastic License 2.0, the official text verbatim

**Fixed before release** (found by a full review of the diff)
- The "collector has gone quiet" alert could never fire: alerting ran only from
  the ingest hook, which stamps last_seen immediately before it. A periodic
  sweep now checks every server, reporting or not.
- 7-day and 30-day views silently showed only the raw retention window, because
  the resolution was chosen by row count rather than by how far the data
  reached. They now fall back to hourly, folding in the recent hours that are
  not rolled up yet so the series still reaches the present.
- Hourly buckets carried the hour's total stall time but were plotted under a
  legend reading "peak per window" — around 240x too large. The rollup now
  keeps the worst window in each hour.
- A 429 was treated as permanent: the batch was discarded, the failure streak
  reset, and the console reported the last send as fine. It is retried with
  backoff, and a batch that really is dropped now increments the dropped count.
- The hover dot was positioned against the data's own maximum while the line
  was drawn against a rounded ceiling, so it never sat on the line; it also
  mapped x by index against a time axis.
- Any batch without an agent block blanked the stored agent version.
- A regression was marked notified even when there was no webhook to notify,
  so a server registered without one silently consumed every finding it made.
- `make release` referenced absolute paths from one machine, and the
  server-list screenshot was actually the detail page.
- `maxServers` was a plan limit nothing could enforce, and a webhook could only
  be set at registration time (`scripts/set-webhook.js` now changes it).

**Known limits**
- Validated against the simulator, not yet against a live server
- No per-resource CPU attribution: no server native provides it
- Stall timing is accurate to one probe interval, so reported stall time is a
  lower bound
- SQLite only; ample for the scale this serves, but not a cluster
