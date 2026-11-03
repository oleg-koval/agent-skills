#!/usr/bin/env sh
# setup-worktree.sh must collect CLAUDE.md, REVIEW.md and AGENTS.md into projectRules.
set -eu

ROOT="$(pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

git init -q "$T/repo"
echo "claude-rule" > "$T/repo/CLAUDE.md"
echo "review-rule" > "$T/repo/REVIEW.md"
echo "agents-rule" > "$T/repo/AGENTS.md"
mkdir "$T/repo/node_modules"
echo "ignored-rule" > "$T/repo/node_modules/REVIEW.md"
printf 'external-secret-sentinel\n' > "$T/external-rules"
mkdir "$T/repo/leak"
ln -s "$T/external-rules" "$T/repo/leak/REVIEW.md"
ln -s "$T/missing-rules" "$T/repo/leak/AGENTS.md"
git -C "$T/repo" add -A
git -C "$T/repo" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
  commit -q -m init
git -C "$T/repo" branch base
echo "pr-only-rule" >> "$T/repo/REVIEW.md"
git -C "$T/repo" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
  commit -q -am "PR-specific rule"
mkdir "$T/home"

HOME="$T/home" LEKKER_LOCAL_REPO="$T/repo" \
  bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" \
  o/r HEAD "$T/out.json" >/dev/null

rules="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).projectRules)' "$T/out.json")"
for want in claude-rule review-rule agents-rule; do
  printf '%s' "$rules" | grep -q "$want" || { echo "FAIL: projectRules lacks $want"; exit 1; }
done
if printf '%s' "$rules" | grep -Eq 'external-secret-sentinel|leak/REVIEW.md|leak/AGENTS.md'; then
  echo "FAIL: symlinked guidance was collected"
  exit 1
fi
if printf '%s' "$rules" | grep -q ignored-rule; then
  echo "FAIL: node_modules REVIEW.md collected"
  exit 1
fi
# Scan mode archives guidance without creating a worktree.
HOME="$T/home" LEKKER_LOCAL_REPO="$T/repo" LEKKER_RULES_ONLY=1 \
  LEKKER_BASE_REF=refs/heads/base \
  bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" \
  o/r HEAD "$T/rules-only.json" >/dev/null
node - "$T/rules-only.json" <<'NODE'
const fs = require('node:fs')
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!data.projectRules.includes('review-rule')) throw new Error('scan guidance missing')
if (data.projectRules.includes('external-secret-sentinel') || data.projectRules.includes('leak/AGENTS.md')) throw new Error('symlink guidance leaked')
if (!data.baseProjectRules || !data.baseProjectRules.includes('review-rule')) throw new Error('base scan guidance missing')
if (data.baseProjectRules.includes('pr-only-rule')) throw new Error('base scan guidance came from PR tree')
NODE
# Rules added to the base after the fork are not the PR's base rules.
git -C "$T/repo" checkout -q base
echo "base-later-rule" >> "$T/repo/REVIEW.md"
git -C "$T/repo" -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false \
  commit -q -am "base gains a rule after the fork"
git -C "$T/repo" checkout -q -
HOME="$T/home" LEKKER_LOCAL_REPO="$T/repo" LEKKER_RULES_ONLY=1 \
  LEKKER_BASE_REF=refs/heads/base \
  bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" \
  o/r HEAD "$T/rules-fork.json" >/dev/null
node - "$T/rules-fork.json" <<'NODE'
const fs = require('node:fs')
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!data.baseProjectRules || !data.baseProjectRules.includes('review-rule')) throw new Error('fork base rules missing')
if (data.baseProjectRules.includes('base-later-rule')) throw new Error('base tip rule leaked into baseProjectRules')
NODE
# An unresolvable base degrades instead of aborting the scan.
HOME="$T/home" LEKKER_LOCAL_REPO="$T/repo" LEKKER_RULES_ONLY=1 \
  LEKKER_BASE_REF=refs/heads/does-not-exist \
  bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" \
  o/r HEAD "$T/rules-nobase.json" >/dev/null
node - "$T/rules-nobase.json" <<'NODE'
const fs = require('node:fs')
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!data.projectRules.includes('review-rule')) throw new Error('projectRules lost on base failure')
if (data.baseProjectRules !== null) throw new Error('baseProjectRules should be null')
if (!data.notes.includes('base-rules-unavailable')) throw new Error('notes lacks base-rules-unavailable')
NODE
# A fork older than a depth-100 clone still finds its merge-base after the deepen retry.
git init -q -b main "$T/origin"
G="git -C $T/origin -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false"
echo "deep-base-rule" > "$T/origin/REVIEW.md"
$G add -A
$G commit -q -m c0
$G branch pr
i=1
while [ "$i" -le 150 ]; do $G commit -q --allow-empty -m "m$i"; i=$((i + 1)); done
$G checkout -q pr
echo "deep-pr-rule" >> "$T/origin/REVIEW.md"
$G commit -q -am "pr change"
git clone -q --depth=100 --no-single-branch "file://$T/origin" "$T/shallow"
HOME="$T/home" LEKKER_LOCAL_REPO="$T/shallow" LEKKER_RULES_ONLY=1 \
  LEKKER_BASE_REF=origin/main \
  bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" \
  o/r origin/pr "$T/rules-deep.json" >/dev/null
node - "$T/rules-deep.json" <<'NODE'
const fs = require('node:fs')
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (typeof data.baseProjectRules !== 'string') throw new Error('shallow fork base rules null')
if (data.baseProjectRules.includes('deep-pr-rule')) throw new Error('base rules came from PR tree')
NODE
echo "PASS: test-lekker-project-rules"
