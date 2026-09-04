<!--
The Cfx forum post. Paste into forum.cfx.re → Releases → Server Resources.

Attach the screenshots from release/screenshots/ where the markers say so;
the forum accepts drag-and-drop and rewrites them to its own CDN links.

Replace YOUR-GITHUB with the repository you publish to before posting.
-->

# [Free] Pulse — find out *which* resource made your server slow

`resmon` only ever shows you **now**. When someone reports the server was
unplayable at 21:00 last night, or it has felt worse since Tuesday, there is
nothing to look at. You restart things until it stops.

Pulse records main-thread health continuously and answers the question you
actually have: **what changed?**

> `qb-inventory` restarted at 12:04. Since then, stall time per window went
> **10ms → 98ms at comparable player counts.** High confidence.

<!-- SCREENSHOT: dashboard-detail.png -->

## How it measures

FiveM runs every resource's threads cooperatively on one main thread. Pulse
sleeps for a known interval and reports how much longer it actually took. A
thread that asks for 50ms and wakes at 900ms proves the main thread was
blocked for 850ms — that is time no resource could use, and it is what your
players feel as rubber-banding and frozen peds.

**Two things it will not claim**, because you should know before installing:

- **There is no server native that gives per-resource CPU time.** Any tool
  showing you a server-side CPU breakdown by resource is inferring it. Pulse
  measures total stall time exactly, and works out the cause by correlating
  stalls against resource restarts over time.
- **Stall timing is accurate to one probe interval** (50ms by default), so the
  reported stall time is a lower bound, not an exact figure.

## Working out which resource did it

This is the part that took the actual work. Comparing the hour before a
restart with the hour after does not work, because **player count is a
confounder**: your server is genuinely worse at 21:00 than at 09:00 because
five times as many people are on it. Do it naively and every resource that
restarts during the evening climb looks guilty.

So Pulse never compares raw averages:

1. The baseline for "the hours after this restart" is **the same clock hours on
   previous days**. Population follows the clock, so like is compared with like.
2. Within that, samples are **matched by player count** — only overlapping
   population ranges are compared.
3. **A step at the change itself is also required.** A regression you have not
   fixed poisons tomorrow's baseline, so every restart on the following nights
   would look guilty. This is what keeps your nightly restart cycle out of the
   results.
4. **Confidence reflects evidence, not effect size** — and the dashboard tells
   you which, so you can disagree with it.

On three days of a simulated 200-resource server with a deliberately broken
update, it names one resource, the right one, with **zero false positives on
the nightly restart cycle**. Given only one day of history it still finds it,
but says the confidence is low instead of pretending otherwise.

## It does not cost you performance

A performance monitor that costs performance is worse than none — you cannot
tell its overhead from the fault you installed it to find. So the collector:

- measures **its own CPU** with `os.clock()` and ships that number in every
  payload, shown on the dashboard
- **halves its own sampling rate** automatically if it ever exceeds its budget
- uses a **fixed-size** send queue, so a backend that is down or unreachable
  costs samples, never your server's memory

Measured over a simulated day: **0.0084% of one core**, against a 0.05% budget.

<!-- SCREENSHOT: collector-cost.png -->

## Also in there

- Stall timeline with restart markers, and player count on its own panel —
  never a second y-axis, so you can discount a busy evening by eye
- Health score with the numbers it came from
- Discord alerts: sustained slowdowns, new regressions, and the collector
  going quiet — with cooldowns, so you are not pinged into muting the channel
- Where your server sits against comparable servers, once enough are reporting

## Install

```sh
git clone https://github.com/YOUR-GITHUB pulse && cd pulse
sh install.sh
```

That starts the backend and prints a download link for a collector that already
has your endpoint and token inside it. Unzip into your resources, add one line
to `server.cfg`:

```cfg
ensure pulse_collector
```

Restart, then in the console:

```
pulse test
```

```
[pulse] PASS (HTTP 200, 41ms)
[pulse] OK. The backend accepted this server's token.
```

If it fails, that second line names the thing to change. A rejected token, a
wrong path and a backend nothing can reach are three different messages, not
one generic error.

Backend is one container and one SQLite file — no database server. Every
collector setting has a convar, so tuning survives an update.

## Honest status

**v0.1.** Everything above runs and is covered by 149 tests, but it has been
validated against a FiveM simulator, not yet against a live server. The
simulator reproduces cooperative threading and main-thread stalls, and the
collector runs inside it completely unmodified — but that is still a
simulator. **If you run it on a real server, I want to hear what breaks.**

The collector is **MIT** and dependency-free Lua: read every line before you
put it on your server. Please do. The backend is Elastic License 2.0 — yours to
self-host and modify, just not to resell as a hosted service.

**GitHub:** https://github.com/YOUR-GITHUB

Bug reports, and especially "this blamed the wrong resource" reports with the
data, are the most useful thing you can send me.
