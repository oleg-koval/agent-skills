#!/bin/sh
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
ENGINE="$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/revmux-engine.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/revmux-engine-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

FAKE_BIN="$TEST_ROOT/bin"
CONFIG_DIR="$TEST_ROOT/config"
TASKS_DIR="$TEST_ROOT/tasks"
ROUND_DIR="$TEST_ROOT/round"
CALLS="$TEST_ROOT/calls"
mkdir -p "$FAKE_BIN" "$CONFIG_DIR/prompts/profiles" "$ROUND_DIR/input/context"
printf 'claude-only profile\n' > "$CONFIG_DIR/prompts/profiles/lekker-medium.md"
printf '{}\n' > "$TEST_ROOT/context.json"
printf '{"worktreePath":"%s","repoRoot":"%s","mergeBase":"HEAD"}\n' \
    "$ROOT" "$ROOT" > "$TEST_ROOT/worktree.json"
printf 'diff\n' > "$TEST_ROOT/pr.diff"
printf 'profile\n' > "$TEST_ROOT/profile.md"

cat > "$FAKE_BIN/revmux" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'call\n' >> "$REVMUX_TEST_CALLS"
for arg in "$@"; do
    if [[ "$arg" == "new" ]]; then
        scope="$REVMUX_TEST_ROUND/input/scope.md"
        goal="$REVMUX_TEST_ROUND/input/goal.md"
        profile="$REVMUX_TEST_ROUND/input/profile.md"
        context="$REVMUX_TEST_ROUND/input/context"
        case "${REVMUX_NULL_KEY:-}" in
            scope) scope=null ;;
            goal) goal=null ;;
            profile) profile=null ;;
            context) context=null ;;
        esac
        jq -n --arg scope "$scope" --arg goal "$goal" --arg profile "$profile" \
            --arg context "$context" --arg null_key "${REVMUX_NULL_KEY:-}" \
            '{scope:$scope,goal:$goal,profile:$profile,context:$context}
             | if $null_key == "" then . else .[$null_key] = null end'
        exit 0
    fi
done
printf '{}\n'
EOF
chmod +x "$FAKE_BIN/revmux"

run_engine() {
    profile_name="${4:-}"
    set -- \
        --task fixture --run 01-review --depth medium --workdir "$ROOT" \
        --diff-file "$1" --context-file "$2" --profile-file "$3" \
        --out "$TEST_ROOT/out.json" --tasks-dir "$TASKS_DIR" --config-dir "$CONFIG_DIR"
    if [ -n "$profile_name" ]; then
        set -- "$@" --profile "$profile_name"
    fi
    PATH="$FAKE_BIN:$PATH" \
    REVMUX_TEST_CALLS="$CALLS" \
    REVMUX_TEST_ROUND="$ROUND_DIR" \
    REVMUX_NULL_KEY="${REVMUX_NULL_KEY:-}" \
    "$ENGINE" "$@"
}

for missing_input in diff context profile; do
    : > "$CALLS"
    diff_file="$TEST_ROOT/pr.diff"
    context_file="$TEST_ROOT/context.json"
    profile_file="$TEST_ROOT/profile.md"
    case "$missing_input" in
        diff) diff_file="$TEST_ROOT/missing.diff" ;;
        context) context_file="$TEST_ROOT/missing-context.json" ;;
        profile) profile_file="$TEST_ROOT/missing-profile.md" ;;
    esac

    set +e
    run_engine "$diff_file" "$context_file" "$profile_file" >/dev/null 2>&1
    status=$?
    set -e
    [ "$status" -eq 2 ] || { echo "FAIL: unreadable $missing_input input exited $status" >&2; exit 1; }
    [ ! -s "$CALLS" ] || { echo "FAIL: unreadable $missing_input input consumed a round" >&2; exit 1; }
done

for null_key in scope goal profile context; do
    : > "$CALLS"
    set +e
    REVMUX_NULL_KEY="$null_key" run_engine \
        "$TEST_ROOT/pr.diff" "$TEST_ROOT/context.json" "$TEST_ROOT/profile.md" >/dev/null 2>&1
    status=$?
    set -e
    [ "$status" -eq 2 ] || { echo "FAIL: null $null_key path exited $status" >&2; exit 1; }
    [ "$(wc -l < "$CALLS")" -eq 1 ] || { echo "FAIL: null $null_key path invoked revmux after new" >&2; exit 1; }
done

# Runner support belongs to revmux. The lekker wrapper must not reject Codex
# profiles before revmux has a chance to execute them.
printf 'model: codex/gpt-5\n' > "$CONFIG_DIR/prompts/profiles/lekker-medium.md"
unset REVMUX_NULL_KEY
: > "$CALLS"
set +e
run_engine "$TEST_ROOT/pr.diff" "$TEST_ROOT/context.json" "$TEST_ROOT/profile.md" \
    lekker-medium-codex \
    >"$TEST_ROOT/codex-profile.stdout" 2>"$TEST_ROOT/codex-profile.stderr"
status=$?
set -e
[ "$status" -eq 0 ] || {
    echo "FAIL: codex profile run exited $status" >&2
    cat "$TEST_ROOT/codex-profile.stderr" >&2
    exit 1
}
[ "$(wc -l < "$CALLS")" -eq 2 ] || {
    echo "FAIL: codex profile did not reach revmux new + run" >&2
    exit 1
}

echo "PASS: test-revmux-engine"
