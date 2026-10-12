#!/bin/sh
# Tests for the shared pr-review-state.sh used by the review-bot loops.
# A fake `gh` serves GraphQL pages from fixtures, one response per call, so the
# verdict logic, thread pagination, and the wait/settle loop run without the network.
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
SKILLS="$ROOT/plugins/olko-github-pr/skills"
LOOPS="codexloop geminiloop copilotloop coderabbitloop qodoloop"
SCRIPT="$SKILLS/codexloop/scripts/pr-review-state.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pr-review-state-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# Every loop ships a byte-identical copy: a fix in one must land in all.
for loop in $LOOPS; do
    copy="$SKILLS/$loop/scripts/pr-review-state.sh"
    [ -x "$copy" ] || fail "$loop is missing an executable scripts/pr-review-state.sh"
    cmp -s "$SCRIPT" "$copy" || fail "$loop/scripts/pr-review-state.sh differs from codexloop's copy"
done

mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/gh" <<'EOF'
#!/bin/sh
# Serve the next fixture in $FAKE_GH_DIR (1.json, 2.json, ...); repeat the last one when exhausted.
n=$(cat "$FAKE_GH_DIR/count" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$FAKE_GH_DIR/count"
f="$FAKE_GH_DIR/$n.json"
[ -f "$f" ] || f=$(ls "$FAKE_GH_DIR"/*.json | sort -V | tail -1)
cat "$f"
EOF
chmod +x "$TEST_ROOT/bin/gh"

HEAD=aaa111
OLD=zzz999

# page HAS_NEXT REVIEWS COMMENTS THREADS [REACTIONS] -> one GraphQL response
page() {
    jq -n --arg head "$HEAD" --argjson next "$1" --argjson reviews "$2" \
        --argjson comments "$3" --argjson threads "$4" --argjson reactions "${5:-[]}" '{data:{repository:{pullRequest:{
          headRefOid:$head,
          commits:{nodes:[{commit:{oid:$head, committedDate:"2026-10-12T10:00:00Z"}}]},
          reviews:{nodes:$reviews}, comments:{nodes:$comments}, reactions:{nodes:$reactions},
          reviewThreads:{pageInfo:{hasNextPage:$next, endCursor:"c1"}, nodes:$threads}}}}}'
}
review() { # LOGIN COMMIT SUBMITTED
    printf '{"author":{"login":"%s","__typename":"Bot"},"commit":{"oid":"%s"},"submittedAt":"%s","body":""}' "$1" "$2" "$3"
}
comment() { # LOGIN TYPENAME UPDATED BODY
    printf '{"author":{"login":"%s","__typename":"%s"},"createdAt":"%s","updatedAt":"%s","body":"%s"}' "$1" "$2" "$3" "$3" "$4"
}
reaction() { # LOGIN CONTENT CREATED
    printf '{"content":"%s","createdAt":"%s","user":{"login":"%s"}}' "$2" "$3" "$1"
}
thread() { # ID RESOLVED LOGIN TYPENAME
    printf '{"id":"%s","isResolved":%s,"isOutdated":false,"path":"a.ts","line":1,"comments":{"nodes":[{"databaseId":1,"url":"u","author":{"login":"%s","__typename":"%s"},"body":"finding"}]}}' "$1" "$2" "$3" "$4"
}

# run NAME EXPECTED_EXIT EXPECTED_VERDICT [extra args]; fixtures already in $TEST_ROOT/NAME
run() {
    name=$1 want_exit=$2 want_verdict=$3
    shift 3
    set +e
    out=$(PATH="$TEST_ROOT/bin:$PATH" FAKE_GH_DIR="$TEST_ROOT/$name" \
        bash "$SCRIPT" --repo o/r --pr 7 --bot codex --interval 0 "$@" 2>"$TEST_ROOT/$name.err")
    code=$?
    set -e
    [ "$code" = "$want_exit" ] || { cat "$TEST_ROOT/$name.err" >&2; fail "$name: exit $code, want $want_exit"; }
    got=$(printf '%s' "$out" | jq -r .verdict)
    [ "$got" = "$want_verdict" ] || fail "$name: verdict $got, want $want_verdict"
    LAST_OUT=$out
}
fixture() { mkdir -p "$TEST_ROOT/$1"; }

# 1. Threads resolved but the bot only reviewed the OLD head: the old loops exited "done" here.
fixture stale
page false "[$(review chatgpt-codex-connector $OLD 2026-10-12T09:00:00Z)]" "[]" \
    "[$(thread t1 true chatgpt-codex-connector Bot)]" > "$TEST_ROOT/stale/1.json"
run stale 20 pending

# 2. Bot reviewed the current head and nothing is open: clean.
fixture clean
page false "[$(review chatgpt-codex-connector $HEAD 2026-10-12T10:05:00Z)]" "[]" \
    "[$(thread t1 true chatgpt-codex-connector Bot)]" > "$TEST_ROOT/clean/1.json"
run clean 0 clean

# 3. A "no issues" issue comment after the head counts as acting on it, a progress notice does not.
fixture noissues
page false "[]" "[$(comment chatgpt-codex-connector Bot 2026-10-12T10:06:00Z "Codex Review: no major issues")]" \
    "[]" > "$TEST_ROOT/noissues/1.json"
run noissues 0 clean
fixture busy
page false "[]" "[$(comment chatgpt-codex-connector Bot 2026-10-12T10:06:00Z "Codex is busy working")]" \
    "[]" > "$TEST_ROOT/busy/1.json"
run busy 20 pending

# 4. Another bot left an unresolved thread on page 2: the target is clean, the PR is not.
fixture otherbot
page true "[$(review chatgpt-codex-connector $HEAD 2026-10-12T10:05:00Z)]" "[]" \
    "[$(thread t1 true chatgpt-codex-connector Bot)]" > "$TEST_ROOT/otherbot/1.json"
page false "[]" "[]" "[$(thread t2 false greptile-apps Bot)]" > "$TEST_ROOT/otherbot/2.json"
run otherbot 10 findings
[ "$(printf '%s' "$LAST_OUT" | jq '.counts.other_bots')" = 1 ] || fail "otherbot: other_bots count"
[ "$(printf '%s' "$LAST_OUT" | jq -r '.unresolved[0].thread_id')" = t2 ] || fail "otherbot: page-2 thread missing"

# 5. A human's open thread is reported but neither blocks nor counts as a bot finding.
fixture human
page false "[$(review chatgpt-codex-connector $HEAD 2026-10-12T10:05:00Z)]" "[]" \
    "[$(thread t3 false alice User)]" > "$TEST_ROOT/human/1.json"
run human 0 clean
[ "$(printf '%s' "$LAST_OUT" | jq '.counts.humans')" = 1 ] || fail "human: humans count"

# 6. Rate limit after the head is terminal.
fixture limited
page false "[]" "[$(comment coderabbitai Bot 2026-10-12T10:06:00Z "You have reached your PR review limit")]" \
    "[]" > "$TEST_ROOT/limited/1.json"
run limited 30 limited --bot coderabbitai

# 7. --since moves the cut-off past the commit date: an earlier comment no longer counts.
fixture since
page false "[]" "[$(comment chatgpt-codex-connector Bot 2026-10-12T10:06:00Z "no major issues")]" \
    "[]" > "$TEST_ROOT/since/1.json"
run since 20 pending --since 2026-10-12T10:30:00Z

# 8. --wait polls until the review lands.
fixture wait
cp "$TEST_ROOT/stale/1.json" "$TEST_ROOT/wait/1.json"
cp "$TEST_ROOT/clean/1.json" "$TEST_ROOT/wait/2.json"
run wait 0 clean --wait 30 --settle 0
[ "$(cat "$TEST_ROOT/wait/count")" = 2 ] || fail "wait: expected 2 reads"

# 9. --settle re-reads after clean and catches a late finding.
fixture settle
cp "$TEST_ROOT/clean/1.json" "$TEST_ROOT/settle/1.json"
page false "[$(review chatgpt-codex-connector $HEAD 2026-10-12T10:05:00Z)]" "[]" \
    "[$(thread t4 false chatgpt-codex-connector Bot)]" > "$TEST_ROOT/settle/2.json"
run settle 10 findings --wait 30 --settle 1

# 10. Every --bot must act on the head before clean.
fixture twobots
cp "$TEST_ROOT/clean/1.json" "$TEST_ROOT/twobots/1.json"
run twobots 20 pending --bot gemini-code-assist

# 11. Codex's clean signal can be a lone 👍 on the PR; its 👀 and a "**Running**" summary are not.
fixture thumbsup
page false "[]" "[]" "[]" "[$(reaction 'chatgpt-codex-connector[bot]' THUMBS_UP 2026-10-12T10:06:00Z)]" \
    > "$TEST_ROOT/thumbsup/1.json"
run thumbsup 0 clean
fixture eyes
page false "[]" "[]" "[]" "[$(reaction 'chatgpt-codex-connector[bot]' EYES 2026-10-12T10:06:00Z)]" \
    > "$TEST_ROOT/eyes/1.json"
run eyes 20 pending
fixture running
page false "[]" "[$(comment chatgpt-codex-connector Bot 2026-10-12T10:06:00Z "| Code Review | **Running** since now |")]" \
    "[]" > "$TEST_ROOT/running/1.json"
run running 20 pending
fixture oldthumb
page false "[]" "[]" "[]" "[$(reaction 'chatgpt-codex-connector[bot]' THUMBS_UP 2026-10-12T09:00:00Z)]" \
    > "$TEST_ROOT/oldthumb/1.json"
run oldthumb 20 pending

# 12. A review of an older commit never counts for the head, even if it was submitted later.
fixture oldreview
page false "[$(review chatgpt-codex-connector $OLD 2026-10-12T10:30:00Z)]" "[]" "[]" > "$TEST_ROOT/oldreview/1.json"
run oldreview 20 pending

# 13. --wait keeps polling while the bot has not acted on the head, even with a thread left open.
fixture waitopen
page false "[]" "[]" "[$(thread t5 false greptile-apps Bot)]" > "$TEST_ROOT/waitopen/1.json"
page false "[$(review chatgpt-codex-connector $HEAD 2026-10-12T10:05:00Z)]" "[]" \
    "[$(thread t5 false greptile-apps Bot)]" > "$TEST_ROOT/waitopen/2.json"
run waitopen 10 findings --wait 30
[ "$(cat "$TEST_ROOT/waitopen/count")" = 2 ] || fail "waitopen: expected 2 reads"
[ "$(printf '%s' "$LAST_OUT" | jq '.bots[0].acted_on_head')" = true ] || fail "waitopen: head not acted on"

# 14. A walkthrough that merely mentions rate limiting is not a limit notice.
fixture ratetopic
page false "[]" "[$(comment coderabbitai Bot 2026-10-12T10:06:00Z "Adds rate limiting to the API client")]" \
    "[]" > "$TEST_ROOT/ratetopic/1.json"
run ratetopic 20 pending --bot coderabbitai   # pending only because the default --bot codex is silent
[ "$(printf '%s' "$LAST_OUT" | jq '.bots[1] | .limited == false and .acted_on_head')" = true ] \
    || fail "ratetopic: a rate-limiting topic was read as a limit notice"

# 15. Usage errors exit 2.
set +e
bash "$SCRIPT" --pr 7 --bot codex >/dev/null 2>&1
[ $? = 2 ] || fail "missing --repo should exit 2"
set -e

echo "pr-review-state tests passed"
