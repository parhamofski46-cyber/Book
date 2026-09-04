# Installing Pulse

Two pieces: the **backend**, which stores and analyses, and the **collector**,
a resource on your FiveM server. Ten minutes, and the backend tells you exactly
what to paste.

## The short version

```sh
git clone https://github.com/YOUR-GITHUB pulse && cd pulse
sh install.sh
```

That starts the backend, asks what your server is called, and prints a
**download link for a collector that already has your endpoint and token in
it**. Unzip it into your resources folder, add `ensure pulse_collector` to
`server.cfg`, restart, and run `pulse test` in the console.

Everything below is the same thing, done by hand.

---

## 1. Backend

Anywhere your game server can reach over HTTP. A €5/month VPS is plenty — the
storage is a single SQLite file and there is no database server to run.

```sh
docker compose up -d
```

Or with Node 22.5+ and nothing to install:

```sh
cd backend && node --no-warnings src/main.js
```

Check it:

```sh
curl localhost:8787/healthz
```

An admin token is generated on first run and saved next to the database as
`admin-token`, readable only by its owner. Set `PULSE_ADMIN_TOKEN` if you would
rather choose it, or `PULSE_NO_ADMIN=1` to keep the admin endpoint shut.

### Settings

| Variable | Default | What it does |
|---|---|---|
| `PULSE_PORT` | `8787` | Listen port |
| `PULSE_DB` | `backend/data/pulse.db` | Database file |
| `PULSE_ADMIN_TOKEN` | *generated* | Issues collector tokens |
| `PULSE_NO_ADMIN` | — | `1` shuts the admin API |
| `PULSE_DEFAULT_PLAN` | `team` | Retention for new servers |
| `PULSE_PUBLIC_URL` | — | Used in Discord links and printed config; https here also marks cookies `Secure` |
| `PULSE_OPEN_DASHBOARD` | — | `1` removes dashboard authentication. Only behind a private network or an authenticating proxy. |

## 2. Register your server

```sh
node backend/scripts/add-server.js "My RP Server"
```

Options: `--plan free|pro|team`, `--webhook <discord url>`, `--endpoint <url>`
if the backend is reachable at something other than localhost.

It prints the block to paste, the dashboard link, and the admin link. **The
token is shown once** — only its hash is stored, so it cannot be read back.
Lose it and you register the server again.

## 3. Collector

Open the download link step 2 printed. It gives you a `pulse_collector` folder
with a `settings.json` already holding this server's endpoint and token — there
is nothing to copy by hand.

1. Unzip it into your resources folder
2. Add one line to `server.cfg`: `ensure pulse_collector`
3. Restart

`settings.json` contains the server's token, so keep it as private as the rest
of your config. Any convar you set overrides the bundled value, so
`set pulse_endpoint "..."` still wins and survives a re-download.

## 4. Check it

In the server console:

```
pulse test
```

```
[pulse] endpoint : http://your-backend:8787/v1/ingest
[pulse] token    : pls_a1b2...
[pulse] sending a test batch...
[pulse] PASS (HTTP 200, 41ms)
[pulse] OK. The backend accepted this server's token.
```

If it fails, the last line names the thing to change:

| What you see | What it means |
|---|---|
| `rejected the token` | `pulse_token` does not match the one you were given |
| `not the ingest endpoint` | `pulse_endpoint` must end with `/v1/ingest` |
| `Could not reach the backend` | Wrong host or port, backend not running, or a firewall |
| `returned an error` | Backend is up but unhappy — check its logs |

`pulse` on its own prints running status: windows recorded, sent, queued,
dropped, and the collector's own CPU cost.

## 5. Open the dashboard

The link is printed by step 2. Or:

```
http://your-backend:8787/?token=<admin token or that server's collector token>
```

The token moves into a cookie and drops out of the address. The admin token
shows every server; a collector token shows only its own. An empty `?token=`
signs out.

Until data arrives, the server's page shows the setup block instead of an empty
chart, so a half-finished install tells you it is half-finished.

## What to expect, and when

| | |
|---|---|
| 15 minutes | the timeline starts to say something |
| 1 day | health scores mean something |
| 3 days | regression attribution reaches high confidence — it needs previous days to compare against |

## Tuning the collector

Every value in `collector/config.lua` has a convar, so changes survive an
update.

| Convar | Default | Effect |
|---|---|---|
| `pulse_tick_interval` | `50` | Probe interval, ms. Lower catches shorter hitches and costs more. |
| `pulse_hitch_threshold` | `100` | Drift above this counts as a hitch |
| `pulse_window` | `15000` | One sample per this many ms |
| `pulse_flush_interval` | `30000` | How often batches are sent |
| `pulse_cpu_budget` | `0.0005` | Ceiling on the collector's own CPU, as a fraction of one core |

## If something is wrong

**`dropped` climbing in `pulse`** — the backend is unreachable or the token is
wrong. Run `pulse test`. The collector keeps working and keeps the newest
samples; it never grows into your server's memory.

**`DEGRADED` in the `pulse` output** — the collector exceeded its CPU budget
and halved its own sampling rate. Report it; that should not happen.

**A regression was blamed on the wrong resource** — this is the most valuable
bug report you can file. Include the resource, the timestamp, and what you
believe actually changed.
