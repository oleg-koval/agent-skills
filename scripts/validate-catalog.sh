#!/bin/sh
set -eu

test -f catalog/skills.json
test -f collections/docs-tools.json
test -f collections/release-tools.json
test -f .claude-plugin/marketplace.json
test -f .cursor-plugin/index.json
echo "catalog files present"
