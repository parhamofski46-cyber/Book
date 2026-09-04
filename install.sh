#!/usr/bin/env sh
# One-command backend install.
#
#   sh install.sh
#
# Brings up the backend, then prints the block to paste into server.cfg. Does
# not touch your game server -- the collector is a folder you copy in yourself,
# and the last thing this prints tells you where.
set -eu

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -f docker-compose.yml ] || die "run this from the repository root"

if [ ! -f .env ]; then
  if command -v openssl >/dev/null 2>&1; then
    TOKEN=$(openssl rand -hex 16)
  else
    TOKEN=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  fi
  printf 'PULSE_ADMIN_TOKEN=%s\n' "$TOKEN" > .env
  chmod 600 .env
  say "Created .env with a new admin token."
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "Starting the backend..."
  docker compose up -d --build
  # Inside the image the working directory is /app, so the script sits at
  # scripts/, not backend/scripts/.
  RUNNER="docker compose exec -T pulse node"
  ADD_SERVER="scripts/add-server.js"
else
  command -v node >/dev/null 2>&1 || die "neither Docker nor Node found. Install one: https://nodejs.org"
  case "$(node -v)" in
    v22.*|v23.*|v24.*|v2[5-9].*) : ;;
    *) die "Node 22.5 or newer is required (found $(node -v))" ;;
  esac
  say "Docker not found -- starting with Node instead."
  # shellcheck disable=SC1091
  . ./.env
  export PULSE_ADMIN_TOKEN
  (cd backend && node --no-warnings src/main.js &) 
  RUNNER="node"
  ADD_SERVER="backend/scripts/add-server.js"
fi

say "Waiting for it to come up..."
i=0
until curl -sf http://127.0.0.1:8787/healthz >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 30 ] && die "backend did not start. Check: docker compose logs pulse"
  sleep 1
done
say "Backend is up on http://127.0.0.1:8787"
say ""

printf 'Name for your FiveM server [my-rp]: '
read -r NAME || NAME=""
[ -n "${NAME:-}" ] || NAME="my-rp"

$RUNNER --no-warnings "$ADD_SERVER" "$NAME"

say "Last step: open the download link above, unzip it into your FiveM"
say "resources folder, add 'ensure pulse_collector' to server.cfg, restart,"
say "then run 'pulse test' in the server console."
