#!/bin/sh
set -eu
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
node --test "$ROOT/tests/lekker-boundary-filesystem.test.mjs"
