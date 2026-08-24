#!/bin/sh
# Asserts validate-catalog.sh rejects a catalog with a duplicate package name.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $1" >&2; exit 1; }

# Baseline: the real catalog must pass.
./scripts/validate-catalog.sh >/dev/null 2>&1 || fail "real catalog does not validate"

# Duplicate a package entry and assert validation fails.
BACKUP="$(mktemp)"
cp catalog/skills.json "$BACKUP"
restore() { cp "$BACKUP" catalog/skills.json; rm -f "$BACKUP"; }
trap restore EXIT

node -e '
const fs = require("fs")
const c = JSON.parse(fs.readFileSync("catalog/skills.json", "utf8"))
c.packages.push(JSON.parse(JSON.stringify(c.packages[0])))
fs.writeFileSync("catalog/skills.json", JSON.stringify(c, null, 2) + "\n")
'

if ./scripts/validate-catalog.sh >/dev/null 2>&1; then
  fail "validator accepted a catalog with a duplicate package name"
fi

echo "PASS: test-catalog-integrity"
