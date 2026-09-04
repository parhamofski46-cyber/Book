#!/usr/bin/env sh
# End-to-end over real HTTP: the Lua collector talking to the Node backend.
#
#   sh scripts/verify-live.sh
#
# Everything else in the suite meets at the wire format. This is the only check
# that puts Lua, HTTP and Node in the same sentence.
set -eu

PORT=${PORT:-8799}
WORK=$(mktemp -d)
DB="$WORK/verify.db"
cleanup() { [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

printf 'starting a clean backend on :%s\n' "$PORT"
PULSE_DB="$DB" PULSE_PORT="$PORT" PULSE_ADMIN_TOKEN=verify-admin \
  node --no-warnings backend/src/main.js >"$WORK/pulse.log" 2>&1 &
PID=$!

i=0
until curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 30 ] && { cat "$WORK/pulse.log"; exit 1; }
  sleep 1
done

TOKEN=$(PULSE_DB="$DB" PULSE_PORT="$PORT" node --no-warnings backend/scripts/add-server.js "verify-rp" \
  | grep -o 'pls_[A-Za-z0-9_-]*' | head -1)
[ -n "$TOKEN" ] || { echo "add-server.js did not print a token"; exit 1; }
printf 'registered a server, token %s...\n' "$(printf '%s' "$TOKEN" | cut -c1-8)"

lua5.4 sim/live.lua "http://127.0.0.1:$PORT/v1/ingest" "$TOKEN" "${MINUTES:-30}"

STORED=$(curl -s -H "authorization: Bearer verify-admin" \
  "http://127.0.0.1:$PORT/v1/servers/1/series?range=24h" | grep -o '"count":[0-9]*' | cut -d: -f2)
printf 'backend has %s windows from the collector\n' "${STORED:-0}"
[ "${STORED:-0}" -gt 0 ] || { echo "FAILED: the backend stored nothing"; exit 1; }

curl -s -o /dev/null -w 'dashboard: HTTP %{http_code}\n' \
  -H "authorization: Bearer verify-admin" "http://127.0.0.1:$PORT/s/1"
echo "PASS: Lua collector -> HTTP -> Node backend -> dashboard"
