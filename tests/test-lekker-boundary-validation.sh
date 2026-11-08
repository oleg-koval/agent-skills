#!/bin/sh
set -eu
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
node --test "$ROOT/tests/lekker-boundary-validation.test.mjs"
