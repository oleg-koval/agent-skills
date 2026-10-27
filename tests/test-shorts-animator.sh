#!/bin/sh
set -eu

# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SA="$ROOT/plugins/olko-creative/skills/shorts-animator/scripts"

# Domain rules (timeline, captions, patch, look, check), no browser, ffmpeg or voice needed.
node --test "$SA"/test/*.test.ts >/dev/null || { node --test "$SA"/test/*.test.ts; exit 1; }

# The CLI loads every module (a syntax or import error anywhere fails here) and lists the shipped looks.
looks="$(node "$SA/sa.ts" looks)"
for l in oil watercolor pastel ink gouache; do
  printf '%s\n' "$looks" | grep -q "^$l " || { echo "FAIL: SA looks is missing $l" >&2; exit 1; }
done

# check runs end to end on a fresh project without a browser.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$SA/sa.ts" new "$TMP/p" >/dev/null
node "$SA/sa.ts" set "$TMP/p" 'voice="none"' >/dev/null
node "$SA/sa.ts" check "$TMP/p" >/dev/null || { node "$SA/sa.ts" check "$TMP/p"; echo "FAIL: check on a new project" >&2; exit 1; }
echo "shorts-animator: ok"
