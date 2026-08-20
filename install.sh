#!/usr/bin/env bash
# One-command setup. Asks for the two things it cannot guess, does the rest.
set -euo pipefail

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

cd "$(dirname "$0")"

# Termux (Android) needs slightly different advice when something is missing.
IS_TERMUX=0
[ -n "${PREFIX:-}" ] && [ -d "${PREFIX:-}/bin" ] && case "$PREFIX" in *com.termux*) IS_TERMUX=1;; esac

say ""
say "${BOLD}ChanSub setup${OFF}"
say "─────────────────────────────────────────"

# --- 1. Python -----------------------------------------------------------
if ! command -v python3 >/dev/null; then
    if [ "$IS_TERMUX" = "1" ]; then
        die "python not found. Run:  pkg install python"
    fi
    die "python3 not found. Install Python 3.11 or newer first."
fi
PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 11) else 0)')
[ "$PY_OK" = "1" ] || die "Python 3.11+ required (found $(python3 -V 2>&1 | cut -d" " -f2))."
ok "Python $(python3 -V 2>&1 | cut -d' ' -f2)"

# --- 2. Virtualenv and dependencies --------------------------------------
if [ ! -d .venv ]; then
    if ! python3 -m venv .venv; then
        if [ "$IS_TERMUX" = "1" ]; then
            die "Could not create a virtualenv. Run:  pkg install python-pip"
        fi
        die "Could not create a virtualenv. On Debian/Ubuntu: sudo apt install python3-venv"
    fi
fi
# shellcheck disable=SC1091
source .venv/bin/activate
ok "virtualenv ready"

say "  installing dependencies (this takes a minute)…"
pip install --quiet --upgrade pip
pip install --quiet -e . || die "Dependency install failed. Scroll up for the reason."
ok "dependencies installed"

# --- 3. Configuration ----------------------------------------------------
if [ -f .env ]; then
    warn ".env already exists — keeping it. Delete it and re-run to start over."
else
    say ""
    say "${BOLD}Two things I need from you:${OFF}"
    say ""
    say "  1. Your bot token — from @BotFather in Telegram (/newbot)"
    say "  2. Your numeric Telegram id — from @userinfobot"
    say ""

    while :; do
        read -rp "Bot token: " BOT_TOKEN
        BOT_TOKEN="${BOT_TOKEN// /}"
        [[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] && break
        warn "That doesn't look like a token. It looks like 7123456789:AAHdq..."
    done

    while :; do
        read -rp "Your Telegram id: " ADMIN_IDS
        ADMIN_IDS="${ADMIN_IDS// /}"
        [[ "$ADMIN_IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] && break
        warn "Digits only, e.g. 123456789"
    done

    read -rp "Card number for your own subscribers (optional, Enter to skip): " CARD
    read -rp "PayPal address for foreign customers (optional): " PAYPAL

    cp .env.example .env
    python3 - "$BOT_TOKEN" "$ADMIN_IDS" "$CARD" "$PAYPAL" <<'PYEOF'
import re, sys, pathlib
token, admins, card, paypal = sys.argv[1:5]
p = pathlib.Path(".env")
s = p.read_text()

def setkey(text, key, value):
    if not value:
        return text
    return re.sub(rf"^{key}=.*$", f"{key}={value}", text, flags=re.M)

s = setkey(s, "BOT_TOKEN", token)
s = setkey(s, "ADMIN_IDS", admins)
s = setkey(s, "PLATFORM_CARD_NUMBER", card)
s = setkey(s, "PLATFORM_PAYPAL_ACCOUNT", paypal)
p.write_text(s)
PYEOF
    chmod 600 .env
    ok ".env written (readable only by you)"
fi

# --- 4. Database ---------------------------------------------------------
alembic upgrade head >/dev/null 2>&1 || die "Migration failed. Run 'alembic upgrade head' to see why."
ok "database ready"

# --- 5. Verify the token actually works ----------------------------------
say ""
say "  checking the token against Telegram…"
set +e
RESULT=$(python3 - <<'PYEOF'
import asyncio, sys
from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession
from app.config import get_settings

async def main():
    s = get_settings()
    session = AiohttpSession(proxy=s.telegram_proxy) if s.telegram_proxy else None
    bot = Bot(token=s.bot_token, session=session)
    try:
        me = await bot.me()
        print(f"OK @{me.username}")
    except Exception as exc:                       # noqa: BLE001
        print(f"FAIL {type(exc).__name__}: {exc}")
    finally:
        await bot.session.close()

asyncio.run(main())
PYEOF
)
set -e

say ""
case "$RESULT" in
    OK*)
        ok "connected to Telegram as ${RESULT#OK }"
        say ""
        say "${BOLD}Done.${OFF} Start the bot with:"
        say ""
        say "    ${BOLD}./run.sh${OFF}"
        say ""
        say "Then in Telegram: add the bot to your private channel as an admin"
        say "with ${BOLD}Invite Users via Link${OFF} and ${BOLD}Ban Users${OFF}, and send it /setup."
        ;;
    *Unauthorized*)
        warn "Telegram rejected the token. Check it in @BotFather, then edit .env"
        ;;
    *)
        warn "Could not reach Telegram: ${RESULT#FAIL }"
        say ""
        say "  api.telegram.org is not reachable from this network."
        say ""
        say "  On a phone: turn on your VPN and run ./install.sh again."
        say "  On a server: set a proxy in .env, for example"
        say "      TELEGRAM_PROXY=socks5://127.0.0.1:1080"
        ;;
esac
say ""
