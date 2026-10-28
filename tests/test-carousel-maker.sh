#!/bin/sh
set -eu

# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CM="$ROOT/plugins/olko-creative/skills/carousel-maker/scripts"

# Domain rules (schema, layout, check), no browser needed.
node --test "$CM"/test/*.test.ts >/dev/null || { node --test "$CM"/test/*.test.ts; exit 1; }

# new and check run end to end without a browser. The example deck asks for a "cover" drawing nobody
# has made yet, so check must flag it; with the drawing present the same deck must check clean.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$CM/cm.ts" new "$TMP/b" --name "Test" --handle @test >/dev/null
if node "$CM/cm.ts" check "$TMP/b" >"$TMP/out" 2>&1; then
  echo "FAIL: check passed a deck whose drawing is missing" >&2; exit 1
fi
grep -q 'no drawing "cover"' "$TMP/out" || { cat "$TMP/out"; echo "FAIL: check did not name the missing drawing" >&2; exit 1; }
: >"$TMP/b/library/cover.jpg"
node "$CM/cm.ts" check "$TMP/b" >/dev/null || { node "$CM/cm.ts" check "$TMP/b"; echo "FAIL: check on a complete deck" >&2; exit 1; }
echo "carousel-maker: ok"
