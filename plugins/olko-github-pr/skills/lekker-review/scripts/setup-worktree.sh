#!/bin/bash
# setup-worktree.sh -- lekker-review helper
# Usage: setup-worktree.sh REPO_SLUG PR_BRANCH OUT_JSON [PREV_SHA]
# Emits a JSON result file at OUT_JSON and prints "OK <OUT_JSON>" on success.
#
# Local branch mode (pre-push review): set LEKKER_LOCAL_REPO=<path to a repo
# working copy>. Repo discovery, the network fetch, and the origin/<branch>
# checkout are all skipped; the worktree is created detached at the LOCAL ref
# passed as PR_BRANCH (a branch name, HEAD, or a sha). Nothing is required to
# exist on the remote. REPO_SLUG is still used for reporting only.

set -euo pipefail

REPO_SLUG="${1:?REPO_SLUG required}"
PR_BRANCH="${2:?PR_BRANCH required}"
OUT_JSON="${3:?OUT_JSON required}"
PREV_SHA="${4:-}"

LOCAL_REPO="${LEKKER_LOCAL_REPO:-}"

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
# 1z. Local branch mode short-circuit -- the caller already knows the repo.
# ---------------------------------------------------------------------------
if [[ -n "$LOCAL_REPO" ]]; then
    if ! git -C "$LOCAL_REPO" rev-parse --show-toplevel >/dev/null 2>&1; then
        printf 'ERROR: LEKKER_LOCAL_REPO=%s is not a git repository\n' "$LOCAL_REPO" >&2
        exit 1
    fi
    REPO_ROOT="$(git -C "$LOCAL_REPO" rev-parse --show-toplevel)"
    NOTES="${NOTES}local-branch-mode;"
fi

# ---------------------------------------------------------------------------
# 1a. Try the cache
# ---------------------------------------------------------------------------
if [[ -z "$REPO_ROOT" ]] && [[ -f "$CACHE_FILE" ]]; then
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
if [[ -n "$LOCAL_REPO" ]]; then
    : # local mode: repo already resolved, never clone and never cache
elif [[ -z "$REPO_ROOT" ]]; then
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
if [[ -n "$LOCAL_REPO" ]]; then
    # Detached, so a branch that is currently checked out in the user's own
    # working copy can still be reviewed. No fetch: the point of this mode is
    # that the commits are not on the remote yet.
    if ! git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_PATH" "$PR_BRANCH" 2>/dev/null; then
        printf 'ERROR: could not create local worktree at %s from ref %s\n' \
            "$WORKTREE_PATH" "$PR_BRANCH" >&2
        exit 1
    fi
else
    # Fetch the base branch too: without it origin/<base> is whatever this clone
    # last saw, and the merge-base drifts back far enough to list files the PR
    # never touched (65 instead of 9 on one review). Explicit refspecs, because
    # a --depth clone is single-branch and would not update either ref.
    # LEKKER_BASE_BRANCH names the branch to fetch when LEKKER_BASE_REF is not
    # origin/<branch>: a merged PR is diffed against <mergeCommit>^1, because its
    # head is already inside the base branch and the merge-base would be the head.
    FETCH_SPECS=("+refs/heads/${PR_BRANCH}:refs/remotes/origin/${PR_BRANCH}")
    BASE_BRANCH="${LEKKER_BASE_BRANCH:-}"
    if [[ -z "$BASE_BRANCH" && "${LEKKER_BASE_REF:-}" == origin/* ]]; then
        BASE_BRANCH="${LEKKER_BASE_REF#origin/}"
    fi
    if [[ -n "$BASE_BRANCH" ]]; then
        FETCH_SPECS+=("+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}")
    fi
    git -C "$REPO_ROOT" fetch origin "${FETCH_SPECS[@]}" 2>/dev/null \
        || git -C "$REPO_ROOT" fetch origin "$PR_BRANCH" 2>/dev/null || true

    if ! git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" "origin/$PR_BRANCH" 2>/dev/null; then
        if ! git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" FETCH_HEAD 2>/dev/null; then
            printf 'ERROR: could not create worktree at %s\n' "$WORKTREE_PATH" >&2
            exit 1
        fi
        NOTES="${NOTES}worktree-used-FETCH_HEAD;"
    fi
fi

# ---------------------------------------------------------------------------
# 3. Determine changed files (to scope tsc/eslint to this PR's diff instead
#    of the whole repo -- see scripts/changed-files.sh). Runs before the
#    node_modules step, which needs to know whether a lockfile changed.
# ---------------------------------------------------------------------------
CHANGED_FILES_FILE="/tmp/lekker-changed-$$.txt"
CF_ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/lekker-changed-err.XXXXXX")"
chmod 600 "$CF_ERR_FILE"
trap 'rm -f "$CF_ERR_FILE"' EXIT
if ! "$(dirname "$0")/changed-files.sh" "$WORKTREE_PATH" \
    >"$CHANGED_FILES_FILE" 2>"$CF_ERR_FILE"; then
    cat "$CF_ERR_FILE" >&2
    exit 1
fi
BASE_REF_NOTE="$(sed -n 's/^base-ref: //p' "$CF_ERR_FILE")"
MERGE_BASE_NOTE="$(sed -n 's/^merge-base: //p' "$CF_ERR_FILE")"
rm -f "$CF_ERR_FILE"

# A blank line here would make `grep -F -f` match EVERY tsc error line, turning
# the repo's standing type debt into "errors this PR introduced". Strip them.
if [[ -f "$CHANGED_FILES_FILE" ]]; then
    grep -v '^[[:space:]]*$' "$CHANGED_FILES_FILE" > "${CHANGED_FILES_FILE}.clean" 2>/dev/null || true
    mv "${CHANGED_FILES_FILE}.clean" "$CHANGED_FILES_FILE" 2>/dev/null || true
fi

MERGE_BASE_VAL="${MERGE_BASE_NOTE:-null}"
BASE_REF_VAL="null"
if [[ -n "$BASE_REF_NOTE" ]] && [[ "$BASE_REF_NOTE" != "unknown" ]]; then
    BASE_REF_VAL="$BASE_REF_NOTE"
else
    NOTES="${NOTES}static-checks-repo-wide-no-base-ref;"
fi

# The caller passes the PR's own file count (gh pr view) so a merge-base that
# still drifted is reported instead of silently widening the static checks.
if [[ -n "${LEKKER_EXPECTED_FILES:-}" ]] && [[ -f "$CHANGED_FILES_FILE" ]]; then
    GOT_FILES="$(grep -c . "$CHANGED_FILES_FILE" 2>/dev/null || true)"
    if [[ "${GOT_FILES:-0}" != "$LEKKER_EXPECTED_FILES" ]]; then
        NOTES="${NOTES}changed-files-mismatch:${GOT_FILES:-0}-vs-${LEKKER_EXPECTED_FILES};"
    fi
fi

# ---------------------------------------------------------------------------
# 3b. node_modules
#     A PR that changes a lockfile gets a fresh `npm ci` in each changed
#     lockfile's dir: the repo root's node_modules holds the OLD tree, so
#     symlinking it would type-check and lint against dependencies the PR
#     replaced. Every other PR symlinks the root's node_modules as before.
# ---------------------------------------------------------------------------
NM_LINKED=false
DEPS_INSTALL_FILE="/tmp/lekker-deps-install-$$.tsv"
printf '' > "$DEPS_INSTALL_FILE"

LOCK_DIRS=()
if [[ -s "$CHANGED_FILES_FILE" ]]; then
    while IFS= read -r cf; do
        case "$cf" in
            package-lock.json|npm-shrinkwrap.json) LOCK_DIRS+=(".") ;;
            */package-lock.json|*/npm-shrinkwrap.json) LOCK_DIRS+=("${cf%/*}") ;;
            yarn.lock|*/yarn.lock|pnpm-lock.yaml|*/pnpm-lock.yaml|bun.lock|*/bun.lock|bun.lockb|*/bun.lockb)
                NOTES="${NOTES}deps-install-unsupported:${cf};" ;;
        esac
    done < "$CHANGED_FILES_FILE"
fi

# Portable timeout (macOS has no `timeout`). Exit 143 means it was killed.
run_with_timeout() {
    local secs pid watcher rc
    secs="$1"; shift
    "$@" &
    pid=$!
    ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) &
    watcher=$!
    rc=0
    wait "$pid" || rc=$?
    kill "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
    return "$rc"
}

ROOT_LOCK_CHANGED=false
for d in "${LOCK_DIRS[@]+"${LOCK_DIRS[@]}"}"; do
    [[ "$d" == "." ]] && ROOT_LOCK_CHANGED=true
done

if [[ ${#LOCK_DIRS[@]} -gt 0 ]] && [[ -n "${LEKKER_NO_INSTALL:-}" ]]; then
    NOTES="${NOTES}deps-install-disabled;"
elif [[ ${#LOCK_DIRS[@]} -gt 0 ]]; then
    for d in "${LOCK_DIRS[@]}"; do
        log_file="/tmp/lekker-npm-ci-$$-${d//\//_}.log"
        # --ignore-scripts: a dependency bump under review must not get to run
        # its postinstall on the reviewer's machine.
        rc=0
        (cd "$WORKTREE_PATH/$d" && run_with_timeout 300 npm ci --ignore-scripts \
            --no-audit --no-fund --prefer-offline) > "$log_file" 2>&1 || rc=$?
        if [[ "$rc" == "0" ]]; then
            status="ok"
            [[ "$d" == "." ]] && NM_LINKED=true
        elif [[ "$rc" == "143" ]]; then
            status="timeout"
        else
            status="failed"
        fi
        printf '%s\t%s\t%s\n' "$d" "$status" "$log_file" >> "$DEPS_INSTALL_FILE"
        [[ "$status" == "ok" ]] || NOTES="${NOTES}deps-install-${status}:${d};"
    done
fi

if [[ "$ROOT_LOCK_CHANGED" == "false" ]]; then
    if [[ -d "$REPO_ROOT/node_modules" ]]; then
        ln -s "$REPO_ROOT/node_modules" "$WORKTREE_PATH/node_modules"
        NM_LINKED=true
    fi
fi

# Nested packages (web/, extensions/*) resolve imports from their own
# node_modules; without it tsc reports every import in them as TS2307.
while IFS= read -r pj; do
    d="${pj#"$WORKTREE_PATH"/}"; d="${d%/package.json}"
    [[ -e "$WORKTREE_PATH/$d/node_modules" ]] && continue
    [[ -d "$REPO_ROOT/$d/node_modules" ]] || continue
    case " ${LOCK_DIRS[*]+"${LOCK_DIRS[*]}"} " in *" $d "*) continue ;; esac
    ln -s "$REPO_ROOT/$d/node_modules" "$WORKTREE_PATH/$d/node_modules"
done < <(find "$WORKTREE_PATH" -mindepth 2 -maxdepth 3 -name package.json \
    -not -path '*/node_modules/*' 2>/dev/null)
[[ "$NM_LINKED" == "true" ]] || NOTES="${NOTES}no-node_modules-static-checks-skipped;"

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
# Structured lint report, kept beside the output JSON (NOT deleted with the
# temp files): lint-findings.mjs turns it into botPredicted findings, so the
# review can fix what the bot reviewers would have charged for. Exported by
# path as eslintJson.
ESLINT_JSON_FILE="$(dirname "$OUT_JSON")/eslint-report.json"
printf '' > "$TSC_TAIL_FILE"
printf '' > "$TSC_CHANGED_FILE"
printf '0' > "$TSC_COUNT_FILE"
printf '' > "$ESLINT_TAIL_FILE"
printf 'skipped' > "$ESLINT_SCOPE_FILE"
printf '' > "$ESLINT_JSON_FILE"

# Render a stylish-style tail from the JSON report. An empty or unparseable
# report (eslint crashed, bad config) keeps whatever eslint wrote on stderr
# instead of rendering "0 errors" from nothing.
render_eslint_tail() {
    local rendered="$ESLINT_JSON_FILE.txt"
    node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
if (!raw.trim()) process.exit(3);
let report;
try { report = JSON.parse(raw); } catch { process.exit(3); }
if (!Array.isArray(report)) process.exit(3);
const lines = [];
let errors = 0, warnings = 0;
for (const f of report) {
  const msgs = f.messages || [];
  if (!msgs.length) continue;
  lines.push(f.filePath);
  for (const m of msgs) {
    if (m.severity === 2) errors++; else warnings++;
    lines.push(`  ${m.line}:${m.column}  ${m.severity === 2 ? "error" : "warning"}  ${m.message}  ${m.ruleId || ""}`);
  }
}
lines.push(`total: ${errors} error(s), ${warnings} warning(s)`);
process.stdout.write(lines.slice(-40).join("\n") + "\n");
' "$ESLINT_JSON_FILE" > "$rendered" 2>/dev/null
    if [[ -s "$rendered" ]]; then
        cat "$rendered" > "$ESLINT_TAIL_FILE"
    fi
    rm -f "$rendered"
}

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
                    # One run, JSON formatter: the machine-readable report feeds
                    # lint-findings.mjs and the human tail is rendered from the
                    # same report, so the two can never disagree.
                    (cd "$WORKTREE_PATH" && npx eslint --max-warnings=0 -f json -o "$ESLINT_JSON_FILE" "${ESLINT_TARGETS[@]}" 2> "$ESLINT_TAIL_FILE") || true
                    render_eslint_tail
                    printf 'changed-files' > "$ESLINT_SCOPE_FILE"
                else
                    printf 'no-changed-lintable-files\n' > "$ESLINT_TAIL_FILE"
                    printf 'none' > "$ESLINT_SCOPE_FILE"
                fi
            else
                # Base ref could not be resolved -- fall back to the old repo-wide run.
                # No JSON here on purpose: a repo-wide report is standing debt,
                # not this change's, and must not become botPredicted findings.
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
    "$MERGE_BASE_VAL" \
    "$DEPS_INSTALL_FILE" \
    "$ESLINT_JSON_FILE" \
    "$OUT_JSON" <<'PYEOF'
import json, sys, os

(worktree_path, repo_root, head_sha, head_sha_short,
 tsc_file, eslint_file, rules_file, delta_file, notes,
 changed_files_file, base_ref_val, eslint_scope_file,
 tsc_changed_file, tsc_count_file, merge_base_val,
 deps_install_file, eslint_json_file, out_json) = sys.argv[1:19]

def read_file(path):
    if not os.path.exists(path):
        return ""
    with open(path, "r", errors="replace") as f:
        return f.read()

# One row per changed-lockfile dir: dir<TAB>status<TAB>log path. Empty = no
# lockfile changed (or install disabled), so the root node_modules was linked.
deps_install = []
for row in read_file(deps_install_file).splitlines():
    parts = row.split("\t")
    if len(parts) != 3:
        continue
    d, status, log = parts
    entry = {"dir": d, "status": status}
    if status != "ok":
        entry["tail"] = "\n".join(read_file(log).splitlines()[-20:])
    deps_install.append(entry)
    try:
        os.remove(log)
    except OSError:
        pass

changed_files = [l for l in read_file(changed_files_file).splitlines() if l.strip()]


def file_has_content(path):
    try:
        return os.path.getsize(path) > 0
    except OSError:
        return False


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
    "mergeBase":      None if merge_base_val == "null" else merge_base_val,
    "eslintScope":    eslint_scope,
    "tscChangedTail": read_file(tsc_changed_file),
    "tscErrorCount":  tsc_error_count,
    "depsInstall":    deps_install,
    # Path, not content: lint-findings.mjs reads it. None when eslint produced
    # no structured report (skipped, no config, crashed, or the repo-wide
    # fallback), so a consumer can tell "no lint report" from "no problems".
    "eslintJson":     eslint_json_file if file_has_content(eslint_json_file) else None,
}

for p in (tsc_file, eslint_file, rules_file, changed_files_file,
          eslint_scope_file, tsc_changed_file, tsc_count_file,
          deps_install_file):
    try:
        os.remove(p)
    except OSError:
        pass

with open(out_json, "w") as f:
    json.dump(data, f, indent=2)

print("OK " + out_json)
PYEOF
