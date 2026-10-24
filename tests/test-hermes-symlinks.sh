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
expected=57
catalog_total="$(node --input-type=module -e 'import {loadCatalog} from "./scripts/lib/catalog.mjs"; console.log(loadCatalog().skills.length)')"
hermes_total="$(node --input-type=module -e 'import {loadCatalog} from "./scripts/lib/catalog.mjs"; console.log(loadCatalog().skills.filter(s => s.adapters.includes("hermes")).length)')"
if test "$catalog_total" != "$expected" || test "$hermes_total" != "$catalog_total"; then
  echo "FAIL: Hermes covers $hermes_total of $catalog_total canonical skills, expected $expected" >&2
  exit 1
fi
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

# Relative HERMES_HOME is resolved from the caller, before the installer changes directory.
mkdir -p "$TMP/relative caller"
(cd "$TMP/relative caller" && HERMES_HOME="relative profile" sh "$ROOT/scripts/install-hermes-symlinks.sh" >/dev/null)
test -f "$TMP/relative caller/relative profile/skills/olko-agent-skills/olko-reflection/wrap-up/SKILL.md" || {
  echo "FAIL: relative Hermes profile was not used" >&2; exit 1; }

# Stale catalog-owned links require explicit pruning; foreign links are preserved.
stale="$skills_dir/olko-reflection/retired"
foreign="$skills_dir/olko-reflection/foreign"
ln -s "$ROOT/plugins/olko-reflection/skills/retired" "$stale"
ln -s "$ROOT" "$foreign"
if HERMES_HOME="$TMP/profile with spaces" sh ./scripts/install-hermes-symlinks.sh >/dev/null 2>&1; then
  echo "FAIL: stale link was not reported" >&2; exit 1
fi
test -L "$stale" || { echo "FAIL: stale link removed without --prune" >&2; exit 1; }
HERMES_HOME="$TMP/profile with spaces" sh ./scripts/install-hermes-symlinks.sh --prune >/dev/null
if test -L "$stale" || ! test -L "$foreign"; then
  echo "FAIL: pruning did not preserve foreign links" >&2
  exit 1
fi

# Two simultaneous installs should both finish successfully.
HERMES_HOME="$TMP/parallel" sh ./scripts/install-hermes-symlinks.sh >"$TMP/parallel-1.log" 2>&1 &
first_pid=$!
HERMES_HOME="$TMP/parallel" sh ./scripts/install-hermes-symlinks.sh >"$TMP/parallel-2.log" 2>&1 &
second_pid=$!
failed=0
wait "$first_pid" || failed=1
wait "$second_pid" || failed=1
if test "$failed" -ne 0; then
  echo "FAIL: concurrent Hermes installers did not both succeed" >&2
  exit 1
fi

# A collision must fail before creating any links.
mkdir -p "$TMP/conflict/skills/olko-agent-skills/olko-reflection/wrap-up"
if HERMES_HOME="$TMP/conflict" sh ./scripts/install-hermes-symlinks.sh >/dev/null 2>&1; then
  echo "FAIL: installer replaced an existing skill path" >&2
  exit 1
fi
test "$(find "$TMP/conflict/skills/olko-agent-skills" -type l | wc -l | tr -d ' ')" = 0 || {
  echo "FAIL: installer wrote links before detecting a collision" >&2; exit 1; }

echo "PASS: test-hermes-symlinks ($actual links, rerun, relative path, prune, concurrency, collision)"
