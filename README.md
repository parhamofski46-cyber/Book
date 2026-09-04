# Pulse — performance telemetry for FiveM servers

`resmon` only ever shows you *now*. When a server hitched at 21:04 with 180
players on, or got slower after last Tuesday's update, there is nothing to look
at. Pulse records main-thread health continuously, and then answers the question
that actually matters: **what changed?**

It is two halves.

| | | Licence |
|---|---|---|
| **`collector/`** | A FiveM resource. Measures the server and ships it. | MIT |
| **`backend/`** | Stores it, finds regressions, draws the dashboard, alerts Discord. | Elastic License 2.0 |

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

```sh
git clone https://github.com/YOUR-GITHUB pulse && cd pulse
sh install.sh
```

`install.sh` starts the backend, asks what your server is called, and prints
the block to paste into `server.cfg`. It uses Docker where it finds it and Node
otherwise. Nothing is installed on your game server by it.

Doing it by hand is three commands:

```sh
docker compose up -d                              # or: cd backend && node src/main.js
node backend/scripts/add-server.js "My RP Server"
```

The second prints a **download link for a collector that is already configured**
— the endpoint and token are inside it. Unzip that into your resources folder,
add one line to `server.cfg`:

```cfg
ensure pulse_collector
```

Restart, then run `pulse test` in the server console:

```
[pulse] endpoint : http://your-backend:8787/v1/ingest
[pulse] token    : pls_a1b2...
[pulse] sending a test batch...
[pulse] PASS (HTTP 200, 41ms)
[pulse] OK. The backend accepted this server's token.
```

If it fails, that second line names the thing to change &mdash; a rejected
token, a wrong path, or a backend nothing can reach are three different
messages, not one generic error.

An admin token is generated on first run and kept beside the database, so
there is no chicken-and-egg between "the admin API needs a token" and "the
token comes from the admin API". Set `PULSE_ADMIN_TOKEN` to choose your own, or
`PULSE_NO_ADMIN=1` to keep the endpoint shut.

## Plans

Retention is the product. A week is genuinely useful for "what happened last
night" and useless for "we got slower after last month's update".

| | Raw windows | Hourly | Alerts | Fleet |
|---|---|---|---|---|
| free | 7d | 30d | — | — |
| pro | 30d | 400d | yes | yes |
| team | 90d | 400d | yes | yes |

A plan attaches to a server, not to an account, so there is nothing to count
servers against and no per-account limit is claimed.

Self-hosters default to `team`. Raw windows are folded into hourly buckets
before they are pruned, so the long view survives cheaply.

**Fleet comparison** — where a server sits among comparable servers — is the one
feature a competitor cannot obtain by copying the code, because it comes from
many servers reporting rather than from the implementation. Every free install
makes it sharper.

## Development

```sh
make test      # 149 tests: 39 collector (Lua), 110 backend (Node)
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
backend/              the service (Elastic License 2.0)
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

## Licence

| | | |
|---|---|---|
| `collector/` | MIT | It runs on other people's servers, so it has to be readable and freely usable. |
| `backend/` | [Elastic License 2.0](https://www.elastic.co/licensing/elastic-license) | Run it for your own servers; do not offer it to third parties as a hosted service. |
| everything else | MIT | Simulator, tests, tooling, release assets. |

`backend/LICENSE` is the official Elastic License 2.0 text, reproduced verbatim.
See `NOTICE` for the short version.
