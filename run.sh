#!/usr/bin/env bash
# Start the bot. Ctrl+C stops it.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "No .env found. Run ./install.sh first."; exit 1; }
source .venv/bin/activate
exec python -m app.bot.main
