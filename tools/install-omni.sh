#!/usr/bin/env bash
# Installs the 'omni' toggle into the current user's shell profile.
# Safe to re-run: it replaces an existing install rather than stacking copies.
set -euo pipefail

DEST="$HOME/.omni.sh"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/omni.sh"
MARKER="# >>> omni toggle >>>"

if [ ! -f "$SRC" ]; then
  echo "omni.sh not found next to this installer ($SRC)" >&2
  exit 1
fi

cp "$SRC" "$DEST"
echo "installed  $DEST"

# Pick the profile for the shell the user actually logs into.
case "$(basename "${SHELL:-/bin/bash}")" in
  zsh)  RC="$HOME/.zshrc" ;;
  bash) RC="$HOME/.bashrc" ;;
  *)    RC="$HOME/.profile" ;;
esac
touch "$RC"

if grep -qF "$MARKER" "$RC"; then
  echo "already wired  $RC"
else
  {
    printf '\n%s\n' "$MARKER"
    printf '%s\n' '[ -f "$HOME/.omni.sh" ] && source "$HOME/.omni.sh"'
    printf '%s\n' "# <<< omni toggle <<<"
  } >> "$RC"
  echo "wired      $RC"
fi

if ! command -v omniroute >/dev/null 2>&1; then
  echo
  echo "note: omniroute itself is not installed yet. run:"
  echo "  npm install -g omniroute"
fi

echo
echo "done. open a new terminal, or run:  source $RC"
echo "then:  omni status"
