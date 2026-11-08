#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
node --test tests/lekker-defect-policy.test.mjs
