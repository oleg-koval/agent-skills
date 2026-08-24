#!/bin/bash
# verify-fixes.sh -- lekker-review fix-mode helper
# Runs static checks + (optionally) the test suite against the worktree AFTER
# fix agents have edited it, and emits a JSON result file.
#
# Usage: verify-fixes.sh WORKTREE_PATH OUT_JSON [RUN_TESTS]
#   RUN_TESTS: "tests" to run the package test script, anything else to skip.
#
# Never fails on a failing check -- a failing check is data, not an error.
# Exit code is non-zero only when the worktree itself is unusable.

set -uo pipefail

WORKTREE_PATH="${1:?WORKTREE_PATH required}"
OUT_JSON="${2:?OUT_JSON required}"
RUN_TESTS="${3:-no-tests}"

if [[ ! -d "$WORKTREE_PATH/.git" ]] && [[ ! -f "$WORKTREE_PATH/.git" ]]; then
    printf 'ERROR: %s is not a git worktree\n' "$WORKTREE_PATH" >&2
    exit 1
fi

TSC_FILE="/tmp/lekker-fix-tsc-$$.txt"
TSC_FULL_FILE="/tmp/lekker-fix-tsc-full-$$.txt"
TSC_CHANGED_FILE="/tmp/lekker-fix-tsc-changed-$$.txt"
TSC_COUNT_FILE="/tmp/lekker-fix-tsc-count-$$.txt"
ESLINT_FILE="/tmp/lekker-fix-eslint-$$.txt"
ESLINT_SCOPE_FILE="/tmp/lekker-fix-eslint-scope-$$.txt"
TEST_FILE="/tmp/lekker-fix-test-$$.txt"
STAT_FILE="/tmp/lekker-fix-stat-$$.txt"
printf '' > "$TSC_FILE"
printf '' > "$TSC_CHANGED_FILE"
printf '0' > "$TSC_COUNT_FILE"
printf '' > "$ESLINT_FILE"
printf 'skipped' > "$ESLINT_SCOPE_FILE"
printf '' > "$TEST_FILE"

HAS_NM=false
[[ -d "$WORKTREE_PATH/node_modules" || -L "$WORKTREE_PATH/node_modules" ]] && HAS_NM=true

# ---------------------------------------------------------------------------
# Uncommitted change footprint (what the fix agents actually wrote)
# ---------------------------------------------------------------------------
git -C "$WORKTREE_PATH" diff --stat > "$STAT_FILE" 2>&1 || true
DIRTY="$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null || true)"

# ---------------------------------------------------------------------------
# Determine changed files (to scope tsc/eslint identically to setup-worktree
# so fix-mode's post-fix numbers compare like-for-like against the baseline).
# --include-uncommitted also picks up what the fix agents just wrote, even if
# it wasn't part of the original PR diff.
# ---------------------------------------------------------------------------
CHANGED_FILES_FILE="/tmp/lekker-fix-changed-$$.txt"
BASE_REF_NOTE="$("$(dirname "$0")/changed-files.sh" "$WORKTREE_PATH" --include-uncommitted 2>&1 >"$CHANGED_FILES_FILE" | sed -n 's/^base-ref: //p')" || true

# A blank line here would make `grep -F -f` match EVERY tsc error line, turning
# the repo's standing type debt into "errors the fixes introduced". Strip them.
if [[ -f "$CHANGED_FILES_FILE" ]]; then
    grep -v '^[[:space:]]*$' "$CHANGED_FILES_FILE" > "${CHANGED_FILES_FILE}.clean" 2>/dev/null || true
    mv "${CHANGED_FILES_FILE}.clean" "$CHANGED_FILES_FILE" 2>/dev/null || true
fi

BASE_REF_VAL="null"
if [[ -n "$BASE_REF_NOTE" ]] && [[ "$BASE_REF_NOTE" != "unknown" ]]; then
    BASE_REF_VAL="$BASE_REF_NOTE"
fi

# Lintable, still-on-disk changed files (a deleted file must not go to eslint).
ESLINT_TARGETS=()
if [[ -s "$CHANGED_FILES_FILE" ]]; then
    while IFS= read -r cf; do
        [[ -z "$cf" ]] && continue
        case "$cf" in
            *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
            *) continue ;;
        esac
        [[ -f "$WORKTREE_PATH/$cf" ]] || continue
        ESLINT_TARGETS+=("$cf")
    done < "$CHANGED_FILES_FILE"
fi

# ---------------------------------------------------------------------------
# tsc + eslint (concurrent)
# ---------------------------------------------------------------------------
run_tsc() {
    # tsc needs the whole program to resolve types, so it always runs
    # repo-wide; only the reported OUTPUT is split by changed-file scope.
    if [[ -f "$WORKTREE_PATH/tsconfig.json" ]] && [[ "$HAS_NM" == "true" ]]; then
        (cd "$WORKTREE_PATH" && npx tsc --noEmit) > "$TSC_FULL_FILE" 2>&1 || true
        tail -40 "$TSC_FULL_FILE" >> "$TSC_FILE" || true
        grep -c 'error TS' "$TSC_FULL_FILE" > "$TSC_COUNT_FILE" 2>/dev/null || printf '0' > "$TSC_COUNT_FILE"
        if [[ -s "$CHANGED_FILES_FILE" ]]; then
            grep -F -f "$CHANGED_FILES_FILE" "$TSC_FULL_FILE" 2>/dev/null | tail -40 > "$TSC_CHANGED_FILE" || true
        fi
        rm -f "$TSC_FULL_FILE"
    else
        printf 'skipped\n' > "$TSC_FILE"
        printf '0' > "$TSC_COUNT_FILE"
    fi
}

run_eslint() {
    if [[ "$HAS_NM" != "true" ]]; then
        printf 'skipped\n' > "$ESLINT_FILE"
        printf 'skipped' > "$ESLINT_SCOPE_FILE"
        return
    fi
    local has_config
    has_config=false
    (cd "$WORKTREE_PATH" && compgen -G '.eslintrc*' >/dev/null 2>&1) && has_config=true
    if [[ "$has_config" == "false" ]]; then
        (cd "$WORKTREE_PATH" && compgen -G 'eslint.config*' >/dev/null 2>&1) && has_config=true
    fi
    if [[ "$has_config" == "true" ]]; then
        if [[ -s "$CHANGED_FILES_FILE" ]]; then
            if [[ ${#ESLINT_TARGETS[@]} -gt 0 ]]; then
                (cd "$WORKTREE_PATH" && npx eslint --max-warnings=0 "${ESLINT_TARGETS[@]}" 2>&1 | tail -40 >> "$ESLINT_FILE") || true
                printf 'changed-files' > "$ESLINT_SCOPE_FILE"
            else
                printf 'no-changed-lintable-files\n' > "$ESLINT_FILE"
                printf 'none' > "$ESLINT_SCOPE_FILE"
            fi
        else
            # Base ref could not be resolved -- fall back to the old repo-wide run.
            (cd "$WORKTREE_PATH" && npx eslint . --max-warnings=0 2>&1 | tail -40 >> "$ESLINT_FILE") || true
            printf 'full-fallback' > "$ESLINT_SCOPE_FILE"
        fi
    else
        printf 'no-eslint-config\n' > "$ESLINT_FILE"
        printf 'no-eslint-config' > "$ESLINT_SCOPE_FILE"
    fi
}

run_tsc &
TSC_PID=$!
run_eslint &
ESLINT_PID=$!
wait "$TSC_PID" || true
wait "$ESLINT_PID" || true

# ---------------------------------------------------------------------------
# Test suite (sequential, opt-in, hard timeout)
# ---------------------------------------------------------------------------
TEST_RAN=false
TEST_EXIT="null"
if [[ "$RUN_TESTS" == "tests" ]] && [[ "$HAS_NM" == "true" ]] \
    && [[ -f "$WORKTREE_PATH/package.json" ]] \
    && grep -q '"test"[[:space:]]*:' "$WORKTREE_PATH/package.json"; then
    TEST_RAN=true
    # `set -o pipefail` is active, so the subshell's exit status already
    # reflects a failing `npm test` even though tail is last in the pipeline.
    if command -v timeout >/dev/null 2>&1; then
        (cd "$WORKTREE_PATH" && timeout 600 npm test --silent 2>&1 | tail -60 >> "$TEST_FILE")
    else
        (cd "$WORKTREE_PATH" && npm test --silent 2>&1 | tail -60 >> "$TEST_FILE")
    fi
    TEST_EXIT=$?
else
    printf 'skipped\n' > "$TEST_FILE"
fi

HEAD_SHA_SHORT="$(git -C "$WORKTREE_PATH" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"

# ---------------------------------------------------------------------------
# Emit JSON
# ---------------------------------------------------------------------------
python3 - \
    "$TSC_FILE" \
    "$ESLINT_FILE" \
    "$TEST_FILE" \
    "$STAT_FILE" \
    "$TEST_RAN" \
    "$TEST_EXIT" \
    "$HEAD_SHA_SHORT" \
    "$DIRTY" \
    "$CHANGED_FILES_FILE" \
    "$BASE_REF_VAL" \
    "$ESLINT_SCOPE_FILE" \
    "$TSC_CHANGED_FILE" \
    "$TSC_COUNT_FILE" \
    "$OUT_JSON" <<'PYEOF'
import json, sys, os

(tsc_file, eslint_file, test_file, stat_file, test_ran, test_exit,
 head_sha_short, dirty, changed_files_file, base_ref_val,
 eslint_scope_file, tsc_changed_file, tsc_count_file,
 out_json) = sys.argv[1:15]

def read_file(path):
    if not os.path.exists(path):
        return ""
    with open(path, "r", errors="replace") as f:
        return f.read()

changed_files = [l for l in read_file(changed_files_file).splitlines() if l.strip()]

eslint_scope = read_file(eslint_scope_file).strip() or "skipped"

try:
    tsc_error_count = int(read_file(tsc_count_file).strip() or "0")
except ValueError:
    tsc_error_count = 0

data = {
    "tscTail":        read_file(tsc_file),
    "eslintTail":     read_file(eslint_file),
    "testTail":       read_file(test_file),
    "testRan":        test_ran == "true",
    "testExitCode":   None if test_exit in ("null", "") else int(test_exit),
    "diffStat":       read_file(stat_file),
    "dirtyPaths":     [l for l in dirty.splitlines() if l.strip()],
    "headShaShort":   head_sha_short,
    "changedFiles":   changed_files,
    "baseRef":        None if base_ref_val == "null" else base_ref_val,
    "eslintScope":    eslint_scope,
    "tscChangedTail": read_file(tsc_changed_file),
    "tscErrorCount":  tsc_error_count,
}

for p in (tsc_file, eslint_file, test_file, stat_file, changed_files_file,
          eslint_scope_file, tsc_changed_file, tsc_count_file):
    try:
        os.remove(p)
    except OSError:
        pass

with open(out_json, "w") as f:
    json.dump(data, f, indent=2)

print("OK " + out_json)
PYEOF
