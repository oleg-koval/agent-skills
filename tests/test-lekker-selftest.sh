#!/usr/bin/env sh
set -eu

# The lekker-review selftest lifts functions out of workflow.js by source
# extraction and exercises the pure logic with no agents. It shipped broken in
# 1.41.0: a change to workflow.js removed a const the suite lifted, the suite
# threw on load, and CI stayed green because nothing ran it. A self-test outside
# the test run is a test nobody runs, so it runs here now.
node plugins/olko-github-pr/skills/lekker-review/scripts/selftest.mjs
