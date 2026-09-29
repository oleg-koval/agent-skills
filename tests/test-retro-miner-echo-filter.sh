#!/bin/sh
# Regression test for the agent-ops-retro transcript miner's echo filter.
# Harness output arrives as user-role records, so a filter that misses a wrapper
# inflates the "human turns" count. The 2026-09-29 retro found 491 of 748 counted
# turns were harness output (inter-agent messages, compaction resumes, stop-hook
# feedback). Each wrapper below must be excluded; the two typed turns must survive.
set -eu

# shellcheck disable=SC1007  # CDPATH= is a deliberate empty assignment for this idiom
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MINER="$ROOT/plugins/olko-reflection/skills/agent-ops-retro/scripts/mine-transcripts.mjs"

fail() { echo "FAIL: $1" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/projects/proj"

node - "$TMP/projects/proj/s1.jsonl" <<'EOF'
const fs = require('fs');
const turn = (text, i) => JSON.stringify({
  type: 'user', userType: 'external', sessionId: 's1',
  timestamp: `2026-09-20T10:00:${String(i).padStart(2, '0')}Z`,
  message: { role: 'user', content: text },
});
const texts = [
  'fix the failing test please',
  'Another Claude session sent a message: done with the audit',
  '<agent-message from="leaf">report</agent-message>',
  'This session is being continued from a previous conversation that ran out of context.',
  'Stop hook feedback: phase not closed',
  '[SYSTEM NOTIFICATION] task finished',
  'Your response above was cut off. Continue.',
  '<system-reminder>ctx</system-reminder>',
  'looks good, ship it',
];
fs.writeFileSync(process.argv[2], texts.map(turn).join('\n') + '\n');
EOF

node "$MINER" --since 2026-09-15 --until 2026-09-30 --root "$TMP/projects" --out "$TMP/mine.json" >/dev/null 2>&1 \
  || fail "miner exited non-zero"

got="$(node -e 'const r=require(process.argv[1]);console.log(`${r.humanTurnsOrganic} ${r.humanTurnsEchoesExcluded} ${r.echoFilterVersion}`)' "$TMP/mine.json")"
[ "$got" = "2 6 3" ] || fail "expected 'organic=2 echoes=6 version=3', got '$got'"

echo "ok: retro miner echo filter"
