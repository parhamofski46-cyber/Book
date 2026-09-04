<!--
Body for the GitHub release. Paste everything below the line into the
"Describe this release" box.

Release title:  Pulse v0.1.0
Tag:            v0.1.0  (choose "Create new tag: v0.1.0 on publish")
Target:         main
Attach:         pulse_collector-v0.1.0.zip
-->

---

`resmon` only ever shows you **now**. When someone reports the server was
unplayable at 21:00 last night, or that it has felt worse since Tuesday, there
is nothing to look at. You restart things until it stops.

Pulse records main-thread health continuously, so the question has an answer:

> **`qb-inventory`** restarted at 14:06. Since then, stall time per window went
> **10ms → 98ms at comparable player counts.** High confidence.

![Stall time across three days, stepping up at a resource restart while player count carries on unchanged](https://raw.githubusercontent.com/parhamofski46-cyber/Pulse-fivem/main/release/screenshots/timeline.png)

## Install

```sh
git clone https://github.com/parhamofski46-cyber/Pulse-fivem pulse && cd pulse
sh install.sh
```

That brings the backend up and prints a download link for a collector with your
endpoint and token already inside it. Unzip into your resources folder, add one
line to `server.cfg`:

```cfg
ensure pulse_collector
```

Restart, then run `pulse test` in the server console:

```
[pulse] PASS (HTTP 200, 41ms)
[pulse] OK. The backend accepted this server's token.
```

If it fails, that last line names the thing to change. A rejected token, a
wrong path and a backend nothing can reach are three different messages, not
one generic error.

## Working out which resource did it

Comparing the hour before a restart with the hour after does not work: your
server is genuinely worse at 21:00 than at 09:00 because five times as many
people are on it, so every resource restarting during the evening climb looks
guilty. So Pulse never compares raw averages.

- The baseline for the hours after a restart is **the same clock hours on
  previous days** — population follows the clock.
- Within that, samples are **matched by player count**; only overlapping
  ranges are compared.
- **A step at the change itself is also required.** An unfixed regression
  poisons tomorrow's baseline, which would otherwise make every restart on the
  following nights look guilty. This is what keeps your nightly restart cycle
  out of the results.
- **Confidence reflects evidence, not effect size**, and the dashboard says
  which comparison it used, so you can disagree with it.

## It does not cost you performance

A monitor that costs performance is worse than none — you cannot tell its
overhead from the fault you installed it to find. So the collector measures its
own CPU, ships that number in every payload, shows it on the dashboard, and
halves its own sampling rate if it goes over budget. Its send queue is a fixed
ring: an unreachable backend costs samples, never your server's memory.

Measured over a simulated day: **0.0084% of one core**, against a 0.05% budget.

## Also in here

- Stall timeline with restart markers; player count on its own panel, never a
  second y-axis
- Health score with the numbers it came from
- Discord alerts for sustained slowdowns, new regressions, and the collector
  going quiet, with cooldowns
- Fleet comparison against similar servers, once enough are reporting
- Self-hosted backend: one container, one SQLite file, no database server

## Honest status

**Everything here runs and is covered by 149 tests** (39 collector, 110
backend), including an end-to-end suite that replays the bytes the collector
really shipped inside a FiveM simulator and checks the analysis recovers the
faults that were injected.

**But it has not yet run on a live server.** The simulator reproduces
cooperative threading and main-thread stalls, and the collector runs inside it
completely unmodified — and it is still a simulator. If you try this, I want to
hear what breaks.

Two things it will not claim:

- **There is no server native that gives per-resource CPU time.** Any tool
  showing a server-side CPU breakdown by resource is inferring it.
- **Stall timing is accurate to one probe interval** (50ms by default), so the
  reported figure is a lower bound.

## Downloads

- **`pulse_collector-v0.1.0.zip`** — the FiveM resource on its own. Needs a
  backend to report to; the `settings.json` inside is blank, so set
  `pulse_endpoint` and `pulse_token` as convars, or use the pre-configured
  download your backend generates.
- **Source code** — everything: collector, backend, simulator and tests.

## Licence

Collector and tooling: **MIT** — seven files of dependency-free Lua. Read them
before putting anything on your server; that is what the licence is for.
Backend: **Elastic License 2.0**.

Bug reports welcome, and **a regression blamed on the wrong resource is the
most useful one you can file** — that is real-world data the simulator cannot
produce. Include the resource, the timestamp, and what you believe actually
changed.
