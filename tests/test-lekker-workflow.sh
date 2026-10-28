#!/usr/bin/env sh
set -eu

node --test tests/lekker-workflow.test.mjs tests/lekker-human-noise.test.mjs tests/lekker-finding-state.test.mjs tests/lekker-eval-runner.test.mjs tests/lekker-review-rules.test.mjs tests/lekker-risk-paths.test.mjs
