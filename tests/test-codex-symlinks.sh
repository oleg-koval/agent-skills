#!/bin/sh
# Asserts the codex symlink installer is re-runnable and links resolve.
set -eu

# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd, not an assignment typo
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

CODEX_HOME="$TMP" ./scripts/install-codex-symlinks.sh >/dev/null
first="$(find "$TMP/skills" -maxdepth 1 -type l | wc -l | tr -d ' ')"
test "$first" -gt 0 || { echo "FAIL: no symlinks created" >&2; exit 1; }

# Re-run must not fail and must not duplicate.
CODEX_HOME="$TMP" ./scripts/install-codex-symlinks.sh >/dev/null
second="$(find "$TMP/skills" -maxdepth 1 -type l | wc -l | tr -d ' ')"
test "$first" = "$second" || { echo "FAIL: re-run changed link count $first -> $second" >&2; exit 1; }

# Every link must resolve to a real SKILL.md and point at the right skill.
for link in "$TMP"/skills/*; do
  name="$(basename "$link")"
  expected="${name#olko:}"
  target="$(readlink "$link")"
  actual="$(basename "$target")"
  test -f "$link/SKILL.md" || { echo "FAIL: $link does not resolve to a SKILL.md" >&2; exit 1; }
  test "$actual" = "$expected" || {
    echo "FAIL: $name points at $actual, expected $expected (target $target)" >&2; exit 1; }
  case "$target" in
    */plugins/*/skills/"$expected") ;;
    *) echo "FAIL: $name target is not a plugin skill path: $target" >&2; exit 1 ;;
  esac
done

echo "PASS: test-codex-symlinks ($first links)"
