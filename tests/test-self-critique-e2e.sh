#!/usr/bin/env sh
set -eu

if [ "${SELF_CRITIQUE_E2E:-}" != "1" ]; then
  echo "skip: set SELF_CRITIQUE_E2E=1 to run the headless critique"
  exit 0
fi

node tests/self-critique-e2e.mjs
