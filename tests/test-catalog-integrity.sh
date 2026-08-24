#!/bin/sh
# Asserts validate-catalog.sh rejects a duplicate skill name, an orphan skill on
# disk, and a plugin with no skills.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $1" >&2; exit 1; }

# Baseline: the real catalog must pass.
./scripts/validate-catalog.sh >/dev/null 2>&1 || fail "real catalog does not validate"

# Duplicate a skill entry and assert validation fails.
BACKUP="$(mktemp)"
cp catalog/skills.json "$BACKUP"
restore() { cp "$BACKUP" catalog/skills.json; rm -f "$BACKUP"; }
trap restore EXIT

node -e '
const fs = require("fs")
const c = JSON.parse(fs.readFileSync("catalog/skills.json", "utf8"))
c.plugins[0].skills.push(JSON.parse(JSON.stringify(c.plugins[0].skills[0])))
fs.writeFileSync("catalog/skills.json", JSON.stringify(c, null, 2) + "\n")
'

if ./scripts/validate-catalog.sh >/dev/null 2>&1; then
  fail "validator accepted a catalog with a duplicate skill name"
fi

# A skill on disk that no plugin claims must be rejected.
mkdir -p plugins/olko-git-tools/skills/orphan-probe
printf -- '---\nname: orphan-probe\ndescription: probe\n---\n\n# Probe\n' \
  > plugins/olko-git-tools/skills/orphan-probe/SKILL.md
if ./scripts/validate-catalog.sh >/dev/null 2>&1; then
  rm -rf plugins/olko-git-tools/skills/orphan-probe
  fail "validator accepted a skill on disk that the catalog does not register"
fi
rm -rf plugins/olko-git-tools/skills/orphan-probe

# A plugin with no skills must be rejected.
node -e '
const fs = require("fs")
const c = JSON.parse(fs.readFileSync("catalog/skills.json", "utf8"))
c.plugins.push({ name: "olko-empty-probe", description: "probe", skills: [] })
fs.writeFileSync("catalog/skills.json", JSON.stringify(c, null, 2) + "\n")
'
if ./scripts/validate-catalog.sh >/dev/null 2>&1; then
  fail "validator accepted a plugin with no skills"
fi
cp "$BACKUP" catalog/skills.json

echo "PASS: test-catalog-integrity"
