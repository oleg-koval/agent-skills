#!/usr/bin/env sh
set -eu

node --test tests/lekker-workflow.test.mjs tests/lekker-finding-state.test.mjs
