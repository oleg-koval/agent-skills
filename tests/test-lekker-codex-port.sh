#!/bin/sh
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

SKILL="plugins/olko-github-pr/skills/lekker-review/SKILL.md"
CODEX_WORKFLOW="plugins/olko-github-pr/skills/lekker-review/references/codex-workflow.md"
ARTIFACT="plugins/olko-github-pr/skills/lekker-review/references/artifact-page.md"
ENGINE="plugins/olko-github-pr/skills/lekker-review/scripts/revmux-engine.sh"
INSTALLER="plugins/olko-github-pr/skills/lekker-review/scripts/install-revmux-prompts.sh"
CODEX_PROFILE="plugins/olko-github-pr/skills/lekker-review/references/revmux/profiles/lekker-medium-codex.md"
CODEX_ADAPTER="adapters/codex/olko-github-pr/README.md"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lekker-codex-port.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

node --input-type=module <<'EOF'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('catalog/skills.json', 'utf8'))
const skill = catalog.plugins
  .flatMap((plugin) => plugin.skills)
  .find((candidate) => candidate.name === 'lekker-review')

assert.ok(skill, 'lekker-review must exist in the catalog')
assert.ok(skill.adapters.includes('codex'), 'lekker-review must target Codex')
assert.match(skill.description, /Claude Code and OpenAI Codex/)
assert.doesNotMatch(skill.description, /5 parallel specialist review agents/)
EOF

test -f "$CODEX_WORKFLOW"
grep -q 'spawn_agent' "$CODEX_WORKFLOW"
grep -q 'wait_agent' "$CODEX_WORKFLOW"
grep -q 'Review -> Dedup -> Verify -> Critic -> Prove' "$CODEX_WORKFLOW"
grep -q '<SKILL_ROOT>/references/agents/<dimension>.md' "$CODEX_WORKFLOW"
grep -q 'repository-relative' "$CODEX_WORKFLOW"
grep -q 'assigned group' "$CODEX_WORKFLOW"
grep -q 'Codex native collaboration' "$SKILL"
grep -q 'OpenAI Codex' "$SKILL"
grep -q 'allowed-tools:.*spawn_agent.*wait_agent' "$SKILL"
grep -q 'stable local HTML' "$ARTIFACT"
grep -q 'base64url' "$ARTIFACT"
grep -q 'context-escape' "$ARTIFACT"
grep -q 'http.*https' "$ARTIFACT"
grep -q 'PREV_ARTIFACT_TARGET' "$ARTIFACT"
grep -q 'model: codex/' "$CODEX_PROFILE"
grep -q -- '--profile <REVMUX_PROFILE>' "$SKILL"
grep -q 'skills/lekker-review/SKILL.md' "$CODEX_ADAPTER"

if grep -q 'codex is not supported here' "$ENGINE"; then
  echo 'FAIL: revmux engine still rejects Codex profiles' >&2
  exit 1
fi
if grep -q 'refusing to install: codex reference' "$INSTALLER"; then
  echo 'FAIL: revmux prompt installer still rejects Codex profiles' >&2
  exit 1
fi

REVMUX_CONFIG_DIR="$TEST_ROOT/revmux" bash "$INSTALLER" >/dev/null
test -f "$TEST_ROOT/revmux/prompts/profiles/lekker-medium-codex.md"
test -f "$TEST_ROOT/revmux/prompts/profiles/lekker-deep-codex.md"
REVMUX_CONFIG_DIR="$TEST_ROOT/revmux" bash "$INSTALLER" --check >/dev/null

echo 'PASS: test-lekker-codex-port'
