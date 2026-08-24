#!/bin/sh
# Asserts build-adapters.sh is deterministic: running it twice changes nothing.
set -eu

# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd, not an assignment typo
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "SKIP: working tree is dirty, cannot assert generation cleanliness" >&2
  exit 0
fi

./scripts/build-adapters.sh >/dev/null
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: generated tree is stale, run ./scripts/build-adapters.sh and commit" >&2
  git diff --stat >&2
  git status --porcelain >&2
  exit 1
fi

./scripts/build-adapters.sh >/dev/null
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: generation is not idempotent, second run produced a diff" >&2
  git diff --stat >&2
  git status --porcelain >&2
  exit 1
fi

echo "PASS: test-generation-idempotent"
