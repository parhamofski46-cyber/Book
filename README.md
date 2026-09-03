# Pulse — performance telemetry for FiveM servers

`resmon` only ever shows you *now*. When a server hitched at 21:04 with 180
players on, or got slower after last Tuesday's update, there is nothing to look
at. Pulse records main-thread health continuously so those questions have
answers.

**Status: v0.1 — collector and test harness.** The ingest service and dashboard
are not written yet. What is here runs, is measured, and is covered by tests.

## What it measures, and what it cannot

FiveM runs every resource's threads cooperatively on one main thread. Pulse
sleeps for a known interval and reports how much longer it actually took; that
excess is time no resource could use. A thread that asks for 50ms and wakes at
900ms proves the main thread was blocked for 850ms.

Two honest limits, stated up front:

- **There is no server native that gives per-resource CPU time.** Any tool that
  claims a server-side CPU breakdown by resource is inferring it. Pulse measures
  total stall time exactly and attributes it by correlating stalls against
  resource restarts over time — which is why history is the product.
- **Stall timing is accurate to one probe interval** (50ms by default). Reported
  stall time is a lower bound.

Alongside stalls it records player count, resource inventory, and every resource
start/stop — from both the lifecycle event (exact timing) and a reconciling poll
(so neither path is load-bearing alone).

## It polices its own cost

A performance monitor that costs performance is worse than none: the operator
cannot separate your overhead from the fault they installed you to find. Pulse
measures its own CPU with `os.clock()`, ships that number in every payload, and
halves its own sampling rate if it ever exceeds its budget.

The buffer is a fixed-size ring. When the backend is unreachable, old samples
are dropped and counted — the agent never grows into the server's memory.

## Measured over a simulated day

A 200-resource server, 24 hours, replayed in 13.5 seconds:

| | |
|---|---|
| Probe samples taken | 1,728,000 |
| Stall time recovered | **100%** of injected (332.8s of 333.3s) |
| Regression signal | 14.2 hitches/h → **99.2/h** after the seeded bad update |
| Collector CPU cost | **0.0084%** of one core (budget: 0.05%) |
| Samples lost to backpressure | 0 |

Reproduce with `make report`.

## The simulator

There is no FiveM server in this repository's test loop, so `sim/` provides one:
a virtual-time scheduler that reproduces cooperative threading and main-thread
stalls, plus a 200-resource workload with a daily population curve, scheduled
restarts, and a seeded regression at 12:00.

The collector runs there **completely unmodified** — `sim/natives.lua` installs
the same globals FiveM does, and files load in the order `fxmanifest.lua`
declares (a test asserts the two lists stay in step).

The point is that the workload knows ground truth. It records every fault it
injected, and the suite asserts the collector recovers them. Anything reported
that was not injected is a false positive, and that is a failing test.

## Install on a server

```cfg
ensure pulse_collector

set pulse_endpoint "https://your-backend/v1/ingest"
set pulse_token    "your-server-token"
set pulse_server_name "my-rp-server"
```

Every setting in `collector/config.lua` has a convar, so tuning survives updates.
`/pulse` in the server console prints agent status.

## Development

```sh
make test     # full suite, ~30s
make report   # headline numbers from a simulated day
```

Requires `lua5.4`. No other dependencies — deliberately, so the collector stays
something an operator can read end to end before trusting it on their server.

## Layout

```
collector/     the FiveM resource — this is the product
  config.lua       convar-backed settings
  server/
    budget.lua     self-instrumentation and automatic degradation
    buffer.lua     bounded ring buffer
    hitch.lua      main-thread stall detection
    inventory.lua  resource inventory and state changes
    shipper.lua    batching, backoff, delivery
    main.lua       wiring and sampling loops
sim/           simulated FiveM server (test-time only, never shipped)
test/          suite and reporting
```

## License

MIT — see LICENSE.
