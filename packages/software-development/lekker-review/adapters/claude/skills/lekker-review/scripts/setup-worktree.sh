#!/bin/bash
# setup-worktree.sh -- lekker-review helper
# Usage: setup-worktree.sh REPO_SLUG PR_BRANCH OUT_JSON [PREV_SHA]
# Emits a JSON result file at OUT_JSON and prints "OK <OUT_JSON>" on success.

set -euo pipefail

REPO_SLUG="${1:?REPO_SLUG required}"
PR_BRANCH="${2:?PR_BRANCH required}"
OUT_JSON="${3:?OUT_JSON required}"
PREV_SHA="${4:-}"

CACHE_DIR="$HOME/.cache/lekker-review"
CACHE_FILE="$CACHE_DIR/repo-map.tsv"
NOTES=""
WORKTREE_PATH="/tmp/lekker-review-$$"

mkdir -p "$CACHE_DIR"

# ---------------------------------------------------------------------------
# Helper: normalise a remote URL to an org/repo comparable key.
# Strips protocol, host, and trailing .git so "github.com/org/repo" ->
# "org/repo".
# ---------------------------------------------------------------------------
normalize_url() {
    local url
    url="$1"
    url="${url%.git}"
    # Strip https://host/ prefix
    url="${url#*://*/}"
    # For SCP-style git@host:org/repo - strip up to and including ':'
    url="${url#*:}"
    printf '%s' "$url"
}

SLUG_NORM="$(normalize_url "https://github.com/${REPO_SLUG}.git")"

REPO_ROOT=""

# ---------------------------------------------------------------------------
# 1a. Try the cache
# ---------------------------------------------------------------------------
if [[ -f "$CACHE_FILE" ]]; then
    while IFS=$'\t' read -r cached_slug cached_path; do
        [[ "$cached_slug" == "$REPO_SLUG" ]] || continue
        if [[ -d "$cached_path" ]]; then
            local_url="$(git -C "$cached_path" remote get-url origin 2>/dev/null || true)"
            local_norm="$(normalize_url "$local_url")"
            if [[ "$local_norm" == "$SLUG_NORM" ]]; then
                REPO_ROOT="$cached_path"
            fi
        fi
        break
    done < "$CACHE_FILE"
fi

# ---------------------------------------------------------------------------
# 1b. Try $PWD
# ---------------------------------------------------------------------------
if [[ -z "$REPO_ROOT" ]] && git -C "$PWD" remote get-url origin >/dev/null 2>&1; then
    pwd_url="$(git -C "$PWD" remote get-url origin 2>/dev/null || true)"
    pwd_norm="$(normalize_url "$pwd_url")"
    if [[ "$pwd_norm" == "$SLUG_NORM" ]]; then
        REPO_ROOT="$PWD"
    fi
fi

# ---------------------------------------------------------------------------
# 1c. Scan ~/Work (maxdepth 4)
# ---------------------------------------------------------------------------
if [[ -z "$REPO_ROOT" ]]; then
    while IFS= read -r git_dir; do
        candidate="${git_dir%/.git}"
        [[ -d "$candidate" ]] || continue
        cand_url="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
        [[ -n "$cand_url" ]] || continue
        cand_norm="$(normalize_url "$cand_url")"
        if [[ "$cand_norm" == "$SLUG_NORM" ]]; then
            REPO_ROOT="$candidate"
            break
        fi
    done < <(find "$HOME/Work" -maxdepth 4 -name ".git" -type d 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# 1d. Shallow clone as last resort (not cached)
# ---------------------------------------------------------------------------
if [[ -z "$REPO_ROOT" ]]; then
    CLONE_DIR="/tmp/lekker-clone-$$"
    git clone --depth=100 "https://github.com/${REPO_SLUG}.git" "$CLONE_DIR"
    REPO_ROOT="$CLONE_DIR"
    NOTES="${NOTES}cloned-shallow;"
else
    # Refresh cache entry: remove stale line and append fresh one
    if [[ -f "$CACHE_FILE" ]]; then
        grep -v "^${REPO_SLUG}	" "$CACHE_FILE" > "${CACHE_FILE}.tmp" 2>/dev/null || true
        mv "${CACHE_FILE}.tmp" "$CACHE_FILE"
    fi
    printf '%s\t%s\n' "$REPO_SLUG" "$REPO_ROOT" >> "$CACHE_FILE"
fi

# ---------------------------------------------------------------------------
# 2. Fetch + worktree
# ---------------------------------------------------------------------------
git -C "$REPO_ROOT" fetch origin "$PR_BRANCH" 2>/dev/null || true

if ! git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" "origin/$PR_BRANCH" 2>/dev/null; then
    if ! git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" FETCH_HEAD 2>/dev/null; then
        printf 'ERROR: could not create worktree at %s\n' "$WORKTREE_PATH" >&2
        exit 1
    fi
    NOTES="${NOTES}worktree-used-FETCH_HEAD;"
fi

# ---------------------------------------------------------------------------
# 3. node_modules symlink
# ---------------------------------------------------------------------------
NM_LINKED=false
if [[ -d "$REPO_ROOT/node_modules" ]]; then
    ln -s "$REPO_ROOT/node_modules" "$WORKTREE_PATH/node_modules"
    NM_LINKED=true
else
    NOTES="${NOTES}no-node_modules-static-checks-skipped;"
fi

# ---------------------------------------------------------------------------
# 3b. Determine changed files (to scope tsc/eslint to this PR's diff instead
#     of the whole repo -- see scripts/changed-files.sh).
# ---------------------------------------------------------------------------
CHANGED_FILES_FILE="/tmp/lekker-changed-$$.txt"
BASE_REF_NOTE="$("$(dirname "$0")/changed-files.sh" "$WORKTREE_PATH" 2>&1 >"$CHANGED_FILES_FILE" | sed -n 's/^base-ref: //p')" || true

# A blank line here would make `grep -F -f` match EVERY tsc error line, turning
# the repo's standing type debt into "errors this PR introduced". Strip them.
if [[ -f "$CHANGED_FILES_FILE" ]]; then
    grep -v '^[[:space:]]*$' "$CHANGED_FILES_FILE" > "${CHANGED_FILES_FILE}.clean" 2>/dev/null || true
    mv "${CHANGED_FILES_FILE}.clean" "$CHANGED_FILES_FILE" 2>/dev/null || true
fi

BASE_REF_VAL="null"
if [[ -n "$BASE_REF_NOTE" ]] && [[ "$BASE_REF_NOTE" != "unknown" ]]; then
    BASE_REF_VAL="$BASE_REF_NOTE"
else
    NOTES="${NOTES}static-checks-repo-wide-no-base-ref;"
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
# 4. Concurrent tsc + eslint (never fail the script)
# ---------------------------------------------------------------------------
TSC_TAIL_FILE="/tmp/lekker-tsc-$$.txt"
TSC_FULL_FILE="/tmp/lekker-tsc-full-$$.txt"
TSC_CHANGED_FILE="/tmp/lekker-tsc-changed-$$.txt"
TSC_COUNT_FILE="/tmp/lekker-tsc-count-$$.txt"
ESLINT_TAIL_FILE="/tmp/lekker-eslint-$$.txt"
ESLINT_SCOPE_FILE="/tmp/lekker-eslint-scope-$$.txt"
printf '' > "$TSC_TAIL_FILE"
printf '' > "$TSC_CHANGED_FILE"
printf '0' > "$TSC_COUNT_FILE"
printf '' > "$ESLINT_TAIL_FILE"
printf 'skipped' > "$ESLINT_SCOPE_FILE"

run_tsc() {
    # tsc needs the whole program to resolve types, so it always runs
    # repo-wide; only the reported OUTPUT is split by changed-file scope.
    if [[ -f "$WORKTREE_PATH/tsconfig.json" ]] && [[ "$NM_LINKED" == "true" ]]; then
        (cd "$WORKTREE_PATH" && npx tsc --noEmit) > "$TSC_FULL_FILE" 2>&1 || true
        tail -40 "$TSC_FULL_FILE" >> "$TSC_TAIL_FILE" || true
        grep -c 'error TS' "$TSC_FULL_FILE" > "$TSC_COUNT_FILE" 2>/dev/null || printf '0' > "$TSC_COUNT_FILE"
        if [[ -s "$CHANGED_FILES_FILE" ]]; then
            grep -F -f "$CHANGED_FILES_FILE" "$TSC_FULL_FILE" 2>/dev/null | tail -40 > "$TSC_CHANGED_FILE" || true
        fi
        rm -f "$TSC_FULL_FILE"
    else
        printf 'skipped\n' > "$TSC_TAIL_FILE"
        printf '0' > "$TSC_COUNT_FILE"
    fi
}

run_eslint() {
    local has_config
    has_config=false
    if [[ "$NM_LINKED" == "true" ]]; then
        (cd "$WORKTREE_PATH" && compgen -G '.eslintrc*' >/dev/null 2>&1) && has_config=true
        if [[ "$has_config" == "false" ]]; then
            (cd "$WORKTREE_PATH" && compgen -G 'eslint.config*' >/dev/null 2>&1) && has_config=true
        fi
        if [[ "$has_config" == "true" ]]; then
            if [[ -s "$CHANGED_FILES_FILE" ]]; then
                if [[ ${#ESLINT_TARGETS[@]} -gt 0 ]]; then
                    # Default (stylish) formatter: ESLint 9 removed the bundled "compact" formatter
                    (cd "$WORKTREE_PATH" && npx eslint --max-warnings=0 "${ESLINT_TARGETS[@]}" 2>&1 | tail -40 >> "$ESLINT_TAIL_FILE") || true
                    printf 'changed-files' > "$ESLINT_SCOPE_FILE"
                else
                    printf 'no-changed-lintable-files\n' > "$ESLINT_TAIL_FILE"
                    printf 'none' > "$ESLINT_SCOPE_FILE"
                fi
            else
                # Base ref could not be resolved -- fall back to the old repo-wide run.
                (cd "$WORKTREE_PATH" && npx eslint . --max-warnings=0 2>&1 | tail -40 >> "$ESLINT_TAIL_FILE") || true
                printf 'full-fallback' > "$ESLINT_SCOPE_FILE"
            fi
        else
            printf 'no-eslint-config\n' > "$ESLINT_TAIL_FILE"
            printf 'no-eslint-config' > "$ESLINT_SCOPE_FILE"
        fi
    else
        printf 'skipped\n' > "$ESLINT_TAIL_FILE"
        printf 'skipped' > "$ESLINT_SCOPE_FILE"
    fi
}

run_tsc &
TSC_PID=$!
run_eslint &
ESLINT_PID=$!
wait "$TSC_PID" || true
wait "$ESLINT_PID" || true

# ---------------------------------------------------------------------------
# 5. Collect PROJECT_RULES from CLAUDE.md files (depth <= 3, skip node_modules)
# ---------------------------------------------------------------------------
PROJECT_RULES_FILE="/tmp/lekker-rules-$$.txt"
printf '' > "$PROJECT_RULES_FILE"

while IFS= read -r claude_md; do
    printf '=== %s ===\n' "$claude_md" >> "$PROJECT_RULES_FILE"
    cat "$claude_md" >> "$PROJECT_RULES_FILE"
    printf '\n' >> "$PROJECT_RULES_FILE"
done < <(find "$WORKTREE_PATH" -maxdepth 3 -name 'CLAUDE.md' \
    -not -path '*/node_modules/*' 2>/dev/null)

# ---------------------------------------------------------------------------
# 6. HEAD SHA
# ---------------------------------------------------------------------------
HEAD_SHA="$(git -C "$WORKTREE_PATH" rev-parse HEAD)"
HEAD_SHA_SHORT="$(git -C "$WORKTREE_PATH" rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
# 7. Delta diff (PREV_SHA)
# ---------------------------------------------------------------------------
DELTA_FILE_VAL="null"
if [[ -n "$PREV_SHA" ]]; then
    if git -C "$WORKTREE_PATH" cat-file -e "$PREV_SHA" 2>/dev/null; then
        DELTA_FILE_PATH="/tmp/lekker-delta-$$.diff"
        git -C "$WORKTREE_PATH" diff "${PREV_SHA}..HEAD" > "$DELTA_FILE_PATH"
        DELTA_FILE_VAL="$DELTA_FILE_PATH"
    else
        NOTES="${NOTES}prev-sha-not-found-full-review;"
    fi
fi

# ---------------------------------------------------------------------------
# 8. Emit JSON via python3 (safe escaping via json.dump)
#    All values passed as argv to avoid any shell-escaping in the heredoc.
# ---------------------------------------------------------------------------
python3 - \
    "$WORKTREE_PATH" \
    "$REPO_ROOT" \
    "$HEAD_SHA" \
    "$HEAD_SHA_SHORT" \
    "$TSC_TAIL_FILE" \
    "$ESLINT_TAIL_FILE" \
    "$PROJECT_RULES_FILE" \
    "$DELTA_FILE_VAL" \
    "$NOTES" \
    "$CHANGED_FILES_FILE" \
    "$BASE_REF_VAL" \
    "$ESLINT_SCOPE_FILE" \
    "$TSC_CHANGED_FILE" \
    "$TSC_COUNT_FILE" \
    "$OUT_JSON" <<'PYEOF'
import json, sys, os

(worktree_path, repo_root, head_sha, head_sha_short,
 tsc_file, eslint_file, rules_file, delta_file, notes,
 changed_files_file, base_ref_val, eslint_scope_file,
 tsc_changed_file, tsc_count_file,
 out_json) = sys.argv[1:16]

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
    "worktreePath":   worktree_path,
    "repoRoot":       repo_root,
    "headSha":        head_sha,
    "headShaShort":   head_sha_short,
    "tscTail":        read_file(tsc_file),
    "eslintTail":     read_file(eslint_file),
    "projectRules":   read_file(rules_file),
    "deltaFile":      None if delta_file == "null" else delta_file,
    "notes":          notes,
    "changedFiles":   changed_files,
    "baseRef":        None if base_ref_val == "null" else base_ref_val,
    "eslintScope":    eslint_scope,
    "tscChangedTail": read_file(tsc_changed_file),
    "tscErrorCount":  tsc_error_count,
}

for p in (tsc_file, eslint_file, rules_file, changed_files_file,
          eslint_scope_file, tsc_changed_file, tsc_count_file):
    try:
        os.remove(p)
    except OSError:
        pass

with open(out_json, "w") as f:
    json.dump(data, f, indent=2)

print("OK " + out_json)
PYEOF
