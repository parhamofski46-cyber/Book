#!/usr/bin/env bash
# omni — switch Claude Code between the Anthropic subscription and a local
# OmniRoute gateway with a single command.
#
# Install:  source this file from ~/.bashrc or ~/.zshrc
# Usage:    omni on | off | status | stop | restart | log

OMNI_PORT="${OMNI_PORT:-20128}"
OMNI_HOST="${OMNI_HOST:-127.0.0.1}"
OMNI_LOG="${OMNI_LOG:-$HOME/.omniroute-toggle.log}"

# Claude Code needs an Authorization header even when the gateway itself is
# keyless, so send a placeholder unless the user supplies a real one.
OMNI_TOKEN="${OMNI_TOKEN:-omniroute-local}"

_omni_c() { # _omni_c <color> <text...>
  local c=$1; shift
  case "$c" in
    green) printf '\033[32m%s\033[0m\n' "$*" ;;
    blue)  printf '\033[34m%s\033[0m\n' "$*" ;;
    amber) printf '\033[33m%s\033[0m\n' "$*" ;;
    red)   printf '\033[31m%s\033[0m\n' "$*" ;;
    *)     printf '%s\n' "$*" ;;
  esac
}

_omni_installed() { command -v omniroute >/dev/null 2>&1; }

# True when something is answering on the gateway port.
_omni_up() {
  curl -s -o /dev/null --max-time 2 "http://${OMNI_HOST}:${OMNI_PORT}/" 2>/dev/null
}

_omni_start() {
  if _omni_up; then
    return 0
  fi
  _omni_c blue "starting OmniRoute on port ${OMNI_PORT} ..."
  nohup omniroute serve >>"$OMNI_LOG" 2>&1 &
  disown 2>/dev/null

  local i
  for i in $(seq 1 45); do
    sleep 1
    if _omni_up; then
      return 0
    fi
  done
  return 1
}

omni() {
  local cmd="${1:-status}"

  case "$cmd" in
    on)
      if ! _omni_installed; then
        _omni_c red "omniroute is not installed. run: npm install -g omniroute"
        return 1
      fi

      if ! _omni_start; then
        _omni_c red "gateway did not come up within 45s. check: omni log"
        return 1
      fi

      # Remember whatever was set before, so 'omni off' restores it exactly.
      if [ -z "$OMNI_ACTIVE" ]; then
        _OMNI_PREV_BASE_URL="$ANTHROPIC_BASE_URL"
        _OMNI_PREV_AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN"
        export _OMNI_PREV_BASE_URL _OMNI_PREV_AUTH_TOKEN
      fi

      export ANTHROPIC_BASE_URL="http://${OMNI_HOST}:${OMNI_PORT}/v1"
      export ANTHROPIC_AUTH_TOKEN="$OMNI_TOKEN"
      export OMNI_ACTIVE=1

      _omni_c green "OmniRoute ON  →  $ANTHROPIC_BASE_URL"
      _omni_c amber "your Claude subscription is NOT in use in this shell."
      ;;

    off)
      if [ -z "$OMNI_ACTIVE" ]; then
        _omni_c blue "already on the Claude subscription. nothing to do."
        return 0
      fi

      # Restore the previous values rather than blindly unsetting, in case the
      # shell already had its own endpoint configured.
      if [ -n "$_OMNI_PREV_BASE_URL" ]; then
        export ANTHROPIC_BASE_URL="$_OMNI_PREV_BASE_URL"
      else
        unset ANTHROPIC_BASE_URL
      fi
      if [ -n "$_OMNI_PREV_AUTH_TOKEN" ]; then
        export ANTHROPIC_AUTH_TOKEN="$_OMNI_PREV_AUTH_TOKEN"
      else
        unset ANTHROPIC_AUTH_TOKEN
      fi

      unset OMNI_ACTIVE _OMNI_PREV_BASE_URL _OMNI_PREV_AUTH_TOKEN
      _omni_c green "OmniRoute OFF  →  back on the Claude subscription."
      _omni_c blue "the gateway is still running. 'omni stop' shuts it down."
      ;;

    status)
      if [ -n "$OMNI_ACTIVE" ]; then
        _omni_c green "mode:    OmniRoute"
        printf 'endpoint: %s\n' "$ANTHROPIC_BASE_URL"
      else
        _omni_c blue "mode:    Claude subscription"
      fi

      if _omni_up; then
        printf 'gateway:  running on port %s\n' "$OMNI_PORT"
      else
        printf 'gateway:  stopped\n'
      fi
      ;;

    stop)
      omniroute stop >/dev/null 2>&1
      if _omni_up; then
        _omni_c red "gateway is still answering on port ${OMNI_PORT}."
      else
        _omni_c green "gateway stopped."
      fi
      ;;

    restart)
      omni stop
      omni on
      ;;

    log)
      if [ -f "$OMNI_LOG" ]; then
        tail -n "${2:-40}" "$OMNI_LOG"
      else
        _omni_c blue "no log yet at $OMNI_LOG"
      fi
      ;;

    -h|--help|help)
      cat <<'USAGE'
omni — switch Claude Code between the subscription and a local OmniRoute gateway

  omni on        start the gateway and route this shell through it
  omni off       restore the Claude subscription in this shell
  omni status    show the current mode and whether the gateway is up
  omni stop      shut the gateway down
  omni restart   stop, then start and re-attach
  omni log [n]   tail the gateway log (default 40 lines)

Scope: 'on' and 'off' only affect the shell they run in. Other terminals
keep whatever mode they were already in.
USAGE
      ;;

    *)
      _omni_c red "unknown command: $cmd"
      omni help
      return 1
      ;;
  esac
}
