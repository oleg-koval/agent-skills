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
if printf '%s' "$rules" | grep -q ignored-rule; then
  echo "FAIL: node_modules REVIEW.md collected"
  exit 1
fi
echo "PASS: test-lekker-project-rules"
