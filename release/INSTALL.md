# Installing Pulse

Two pieces: the **backend** (stores and analyses) and the **collector** (a
resource on your FiveM server). Set up the backend first — the collector needs
a token from it.

## 1. Backend

Anywhere that can run Docker and that your game server can reach over HTTP. A
€5/month VPS is more than enough; the storage is a single SQLite file.

```sh
git clone https://github.com/YOUR-GITHUB pulse && cd pulse
echo "PULSE_ADMIN_TOKEN=$(openssl rand -hex 16)" > .env
docker compose up -d
```

Without Docker (Node 22.5 or newer, no dependencies to install):

```sh
cd backend
PULSE_ADMIN_TOKEN=your-secret PULSE_DB=./data/pulse.db node src/main.js
```

Check it is up:

```sh
curl localhost:8787/healthz
```

### Settings

| Variable | Default | What it does |
|---|---|---|
| `PULSE_PORT` | `8787` | Listen port |
| `PULSE_DB` | `./data/pulse.db` | Database file |
| `PULSE_ADMIN_TOKEN` | *(unset)* | Required to issue collector tokens. Unset means the admin API is **off**, not open. |
| `PULSE_DEFAULT_PLAN` | `team` | Retention for new servers |
| `PULSE_PUBLIC_URL` | *(unset)* | Used in Discord links; https here also marks cookies `Secure` |
| `PULSE_OPEN_DASHBOARD` | *(unset)* | `1` removes dashboard authentication. Only behind a private network or an authenticating proxy. |

## 2. Register your server

```sh
curl -X POST localhost:8787/v1/admin/servers \
  -H "authorization: Bearer $PULSE_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"my-rp","plan":"team","discordWebhook":"https://discord.com/api/webhooks/..."}'
```

You get back a token beginning `pls_`. **It is shown once** — only its hash is
stored, so it cannot be read back. Lose it and you issue a new one.

The `discordWebhook` is optional; without it alerts are recorded but not sent.

## 3. Collector

Copy the `collector/` directory into your resources folder as
`pulse_collector`, then in `server.cfg`:

```cfg
ensure pulse_collector

set pulse_endpoint    "http://your-backend:8787/v1/ingest"
set pulse_token       "pls_..."
set pulse_server_name "my-rp"
```

Restart, then run `pulse` in the server console:

```
[pulse] v0.1.0  windows=8  buffered=0  dropped=0  sent=16  cpu=0.0081%
```

`sent` climbing means telemetry is arriving. `dropped` climbing means the
backend is unreachable — check `pulse_endpoint` and the token.

## 4. Open the dashboard

```
http://your-backend:8787/?token=<admin token or that server's collector token>
```

The token moves into a cookie and drops out of the address. The admin token
shows every server; a collector token shows only its own. An empty `?token=`
signs out.

Give it about fifteen minutes before the timeline says much, a full day before
health means anything, and **three days before regression attribution reaches
high confidence** — it needs previous days to compare against.

## Tuning the collector

Every value in `collector/config.lua` has a convar, so your changes survive an
update. The ones worth knowing:

| Convar | Default | Effect |
|---|---|---|
| `pulse_tick_interval` | `50` | Probe interval, ms. Lower catches shorter hitches and costs more. |
| `pulse_hitch_threshold` | `100` | Drift above this counts as a hitch |
| `pulse_window` | `15000` | One sample per this many ms |
| `pulse_flush_interval` | `30000` | How often batches are sent |
| `pulse_cpu_budget` | `0.0005` | Ceiling on the collector's own CPU, as a fraction of one core |

## If something is wrong

**`dropped` is climbing** — the backend is unreachable, or the token is wrong.
The collector keeps working and keeps the newest samples; it never grows into
your server's memory.

**The dashboard says "no data"** — check `pulse` in the console. If `sent` is 0
and `buffered` is climbing, it is a network or token problem.

**`DEGRADED` in the `pulse` output** — the collector exceeded its CPU budget
and halved its own sampling rate. Report it; that should not happen.

**A regression was blamed on the wrong resource** — this is the most valuable
bug report you can file. Include the resource, the timestamp, and what you
believe actually changed.
