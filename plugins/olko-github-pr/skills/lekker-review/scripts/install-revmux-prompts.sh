#!/usr/bin/env bash
# Installs lekker's revmux lenses + profiles into ~/.config/revmux (layer 2),
# idempotently. --check verifies without writing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_LENSES="$REPO_ROOT/references/revmux/lenses"
SRC_PROFILES="$REPO_ROOT/references/revmux/profiles"

CONFIG_DIR="${REVMUX_CONFIG_DIR:-$HOME/.config/revmux}"
DST_LENSES="$CONFIG_DIR/lenses"
DST_PROFILES="$CONFIG_DIR/prompts/profiles"

CHECK_MODE=0
if [ "${1:-}" = "--check" ]; then
  CHECK_MODE=1
fi

FAIL=0

sync_one() {
  local src="$1" dst="$2"
  local name
  name="$(basename "$src")"

  if [ "$CHECK_MODE" -eq 1 ]; then
    if [ ! -f "$dst" ]; then
      echo "missing: $name"
      FAIL=1
    elif ! diff -q "$src" "$dst" >/dev/null 2>&1; then
      echo "differs: $name"
      FAIL=1
    fi
    return
  fi

  mkdir -p "$(dirname "$dst")"
  if [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    echo "installed: $name"
  elif diff -q "$src" "$dst" >/dev/null 2>&1; then
    echo "unchanged: $name"
  else
    echo "updated: $name"
    diff -u "$dst" "$src" || true
    cp "$src" "$dst"
  fi
}

for f in "$SRC_LENSES"/*.md; do
  sync_one "$f" "$DST_LENSES/$(basename "$f")"
done

for f in "$SRC_PROFILES"/*.md; do
  sync_one "$f" "$DST_PROFILES/$(basename "$f")"
done

if [ "$CHECK_MODE" -eq 1 ]; then
  exit "$FAIL"
fi
