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
  bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" \
  o/r HEAD "$T/rules-only.json" >/dev/null
node - "$T/rules-only.json" <<'NODE'
const fs = require('node:fs')
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!data.projectRules.includes('review-rule')) throw new Error('scan guidance missing')
if (data.projectRules.includes('external-secret-sentinel') || data.projectRules.includes('leak/AGENTS.md')) throw new Error('symlink guidance leaked')
NODE
echo "PASS: test-lekker-project-rules"
