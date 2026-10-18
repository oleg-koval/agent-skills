#!/bin/sh
set -eu

# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

HERMES_HOME="$TMP/profile with spaces" sh ./scripts/install-hermes-symlinks.sh >/dev/null
skills_dir="$TMP/profile with spaces/skills/olko-agent-skills"
expected="$(node --input-type=module -e 'import {loadCatalog} from "./scripts/lib/catalog.mjs"; console.log(loadCatalog().skills.filter(s => s.adapters.includes("hermes")).length)')"
actual="$(find "$skills_dir" -type l | wc -l | tr -d ' ')"
test "$actual" = "$expected" || { echo "FAIL: linked $actual of $expected Hermes skills" >&2; exit 1; }
find "$skills_dir" -type l | while IFS= read -r link; do
  test -f "$link/SKILL.md" || { echo "FAIL: broken Hermes skill link: $link" >&2; exit 1; }
done

HERMES_HOME="$TMP/profile with spaces" sh ./scripts/install-hermes-symlinks.sh >/dev/null
test "$(find "$skills_dir" -type l | wc -l | tr -d ' ')" = "$expected" || {
  echo "FAIL: rerun changed Hermes link count" >&2; exit 1; }
test -f "$skills_dir/olko-reflection/wrap-up/SKILL.md" || {
  echo "FAIL: wrap-up link does not resolve" >&2; exit 1; }

# A collision must fail before creating any links.
mkdir -p "$TMP/conflict/skills/olko-agent-skills/olko-reflection/wrap-up"
if HERMES_HOME="$TMP/conflict" sh ./scripts/install-hermes-symlinks.sh >/dev/null 2>&1; then
  echo "FAIL: installer replaced an existing skill path" >&2
  exit 1
fi
test "$(find "$TMP/conflict/skills/olko-agent-skills" -type l | wc -l | tr -d ' ')" = 0 || {
  echo "FAIL: installer wrote links before detecting a collision" >&2; exit 1; }

echo "PASS: test-hermes-symlinks ($actual links, rerun and collision checks)"
