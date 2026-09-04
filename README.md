# Pulse — performance telemetry for FiveM servers

`resmon` only ever shows you *now*. When a server hitched at 21:04 with 180
players on, or got slower after last Tuesday's update, there is nothing to look
at. Pulse records main-thread health continuously, and then answers the question
that actually matters: **what changed?**

It is two halves.

| | | Licence |
|---|---|---|
| **`collector/`** | A FiveM resource. Measures the server and ships it. | MIT |
| **`backend/`** | Stores it, finds regressions, draws the dashboard, alerts Discord. | Source-available |

The collector is MIT because it runs on other people's machines: an operator who
cannot read it should not install it. Everything in it is plain Lua with no
dependencies. The backend is standard-library Node — no framework, no ORM, no
build step, no `node_modules` at all.

## What it measures, and what it cannot

FiveM runs every resource's threads cooperatively on one main thread. Pulse
sleeps for a known interval and reports how much longer it actually took; that
excess is time no resource could use. A thread that asks for 50ms and wakes at
900ms proves the main thread was blocked for 850ms.

Two honest limits, stated up front:

- **There is no server native that gives per-resource CPU time.** Any tool
  claiming a server-side CPU breakdown by resource is inferring it. Pulse
  measures total stall time exactly and attributes it by correlating stalls
  against resource restarts over time — which is why history *is* the product.
- **Stall timing is accurate to one probe interval** (50ms by default), so
  reported stall time is a lower bound.

## Finding the resource that caused a slowdown

This is the part with real difficulty in it, and the part nothing else does.

The naive approach — compare the hour before a restart with the hour after —
fails immediately, because **population is a confounder**. A roleplay server is
genuinely worse at 21:00 than at 09:00 because five times as many players are on
it. Any restart during the evening climb looks guilty.

So Pulse never compares aggregates:

1. **Same hours, previous days.** The baseline for "the three hours after this
   restart" is the same three clock hours on the days before it. Population
   follows the clock, so like is compared with like.
2. **Matched population within that.** Samples are bucketed by player count and
   only buckets present on both sides are compared, each weighted by the smaller
   side's evidence.
3. **A local step is also required.** An unfixed regression poisons tomorrow's
   baseline, so every restart on the following nights looks guilty against
   yesterday. Requiring a step *at the change itself* is what keeps the nightly
   restart cycle out of the results.
4. **Confidence reflects evidence, not effect size.** A huge jump seen in one
   population bucket is weaker than a moderate one seen across five, and the
   dashboard says which.

The result reads: *`qb-inventory` restarted at 12:00; stall time per window went
10ms to 98ms at comparable player counts (high confidence, day-over-day).*

## Measured, not asserted

The test suite does not check that the pieces agree with each other. It runs the
real collector inside a simulated FiveM server, injects faults whose cause and
timing are known, replays the bytes the collector actually shipped through the
real ingest path, and asserts the product recovers the truth.

Over three simulated days of a 200-resource server with a seeded bad update:

| | |
|---|---|
| Stall time recovered by the collector | **100%** of injected |
| Collector CPU cost | **0.0084%** of one core (budget: 0.05%) |
| Regression signal | 14.2 hitches/h → **99.2/h** after the seeded update |
| Resources the backend named | **`qb-inventory`, and only that** — high confidence |
| False positives on the nightly restart cycle | **0** |
| Verdict on one day of history instead of three | still found, **confidence lowered** |

Reproduce with `make test` and `make report`.

## The collector polices its own cost

A performance monitor that costs performance is worse than none: the operator
cannot separate your overhead from the fault they installed you to find. So the
collector measures its own CPU with `os.clock()`, ships that number in every
payload, shows it on the dashboard, and halves its own sampling rate if it ever
exceeds its budget. Its send queue is a fixed-size ring — an unreachable backend
costs samples, never server memory.

## Run it

**Backend** (one command; SQLite, one file on disk, no database server):

```sh
echo "PULSE_ADMIN_TOKEN=$(openssl rand -hex 16)" > .env
docker compose up -d
```

Or without Docker: `cd backend && PULSE_ADMIN_TOKEN=... node src/main.js`.

The dashboard is **not public**. Server ids are small integers, so an open
dashboard would let anyone read every server's telemetry by counting upwards.
Open it with the admin token to see every server, or with a server's own
collector token to see just that one:

```
http://localhost:8787/?token=<admin or collector token>
```

The token is moved into an HttpOnly cookie and the address is cleaned, so it
stops appearing in history and referrers — but only once it has been checked,
so a link cannot pin a stranger's chosen identity into your browser. An empty
`?token=` signs out. The cookie is marked `Secure` automatically when
`PULSE_PUBLIC_URL` is https (or set `PULSE_COOKIE_SECURE=1`). Self-hosting behind a private network
or an authenticating proxy? `PULSE_OPEN_DASHBOARD=1` drops the check — reading
only; ingest always requires a real token.

Issue a token for a server:

```sh
curl -X POST localhost:8787/v1/admin/servers \
  -H "authorization: Bearer $PULSE_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"my-rp","plan":"team","discordWebhook":"https://discord.com/api/webhooks/..."}'
```

**Collector** — drop `collector/` into your resources as `pulse_collector`:

```cfg
ensure pulse_collector

set pulse_endpoint    "http://your-backend:8787/v1/ingest"
set pulse_token       "pls_...."
set pulse_server_name "my-rp"
```

Every setting in `collector/config.lua` has a convar, so tuning survives an
update. `/pulse` in the server console prints agent status.

## Plans

Retention is the product. A week is genuinely useful for "what happened last
night" and useless for "we got slower after last month's update".

| | Raw windows | Hourly | Servers | Alerts | Fleet |
|---|---|---|---|---|---|
| free | 7d | 30d | 1 | — | — |
| pro | 30d | 400d | 3 | yes | yes |
| team | 90d | 400d | 25 | yes | yes |

Self-hosters default to `team`. Raw windows are folded into hourly buckets
before they are pruned, so the long view survives cheaply.

**Fleet comparison** — where a server sits among comparable servers — is the one
feature a competitor cannot obtain by copying the code, because it comes from
many servers reporting rather than from the implementation. Every free install
makes it sharper.

## Development

```sh
make test      # 99 tests: 24 collector (Lua), 75 backend (Node)
make report    # headline numbers from a simulated day
make check     # syntax-check everything that ships
make run       # start the backend locally
```

Requires `lua5.4` and Node 22.5+. Nothing else — no package manager step in
either half.

`sim/` is a virtual-time FiveM: cooperative threading, main-thread stalls, and a
200-resource workload with a daily population curve, scheduled restarts, and a
seeded regression. The collector runs there **completely unmodified**, loaded in
the order `fxmanifest.lua` declares — a test asserts those two lists stay in
step. Test fixtures are generated from it rather than committed, because a
deterministic simulator is a better source of truth than a file someone typed.

## Layout

```
collector/            the FiveM resource (MIT)
  config.lua            convar-backed settings
  server/
    budget.lua          self-instrumentation and automatic degradation
    buffer.lua          bounded ring buffer
    hitch.lua           main-thread stall detection
    inventory.lua       resource inventory and restart tracking
    shipper.lua         batching, backoff, delivery
    main.lua            wiring and sampling loops
backend/              the service (source-available)
  src/
    db/                 schema, migrations, data access
    http/               router, ingest, dashboard pages
    analysis/           stratified comparison, regressions, health, fleet
    alerts/             rules and Discord delivery
    ui/                 design tokens and server-rendered SVG charts
sim/                  simulated FiveM server (test-time only, never shipped)
test/                 collector suite
backend/test/         backend suite, including the end-to-end replay
```

## Status

v0.1. Everything described here runs and is covered by tests — but it has been
validated against the simulator, not yet against a live server. The simulator was
built conservatively, and the collector is designed to fail quietly rather than
badly, but that remains the one assumption still to be proved in the field.
