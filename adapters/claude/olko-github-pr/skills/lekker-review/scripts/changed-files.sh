#!/bin/bash
# changed-files.sh -- lekker-review helper
# Determines the base ref for the branch checked out in WORKTREE_PATH and
# prints, one path per line on stdout, the files this branch has changed
# relative to that base. Prints the base ref actually used to stderr,
# prefixed "base-ref: ", so callers can capture it separately from the file
# list.
#
# Usage: changed-files.sh WORKTREE_PATH [--include-uncommitted]
#   --include-uncommitted: also union in the worktree's uncommitted (working
#   tree + staged) changes -- what a fix agent just wrote, even if it wasn't
#   part of the original PR diff.
#
# LEKKER_BASE_REF=<ref> overrides base-ref detection entirely (pre-push branch
# mode passes the branch the PR would target). Also prints the resolved
# "merge-base: <sha>" to stderr so a caller can produce a diff from the exact
# same point this file list was scoped to.
#
# If automatic base-ref detection finds nothing, prints NOTHING to stdout,
# "base-ref: unknown" to stderr, and exits 0 so callers can fall back to a
# repo-wide check. An invalid explicit base or a missing merge base is a caller
# error and exits nonzero without emitting base-ref/merge-base metadata.

set -uo pipefail

WORKTREE_PATH="${1:?WORKTREE_PATH required}"
INCLUDE_UNCOMMITTED=false
[[ "${2:-}" == "--include-uncommitted" ]] && INCLUDE_UNCOMMITTED=true

# ---------------------------------------------------------------------------
# 1. Resolve a base ref: origin's default branch first, then a fixed
#    fallback order.
# ---------------------------------------------------------------------------
BASE_REF="${LEKKER_BASE_REF:-}"
if [[ -n "$BASE_REF" ]] && ! git -C "$WORKTREE_PATH" rev-parse --verify --quiet "$BASE_REF" >/dev/null 2>&1; then
    # An override that does not resolve is a caller error, not a reason to
    # silently review against the wrong base.
    printf 'ERROR: LEKKER_BASE_REF does not resolve: %s\n' "$BASE_REF" >&2
    exit 1
fi

SYM_REF="$(git -C "$WORKTREE_PATH" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)"
if [[ -z "$BASE_REF" ]] && [[ -n "$SYM_REF" ]]; then
    candidate="origin/${SYM_REF#refs/remotes/origin/}"
    if git -C "$WORKTREE_PATH" rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
        BASE_REF="$candidate"
    fi
fi

if [[ -z "$BASE_REF" ]]; then
    for candidate in origin/staging origin/main origin/master; do
        if git -C "$WORKTREE_PATH" rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
            BASE_REF="$candidate"
            break
        fi
    done
fi

if [[ -z "$BASE_REF" ]]; then
    printf 'base-ref: unknown\n' >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# 2. Merge-base + diff.
# ---------------------------------------------------------------------------
MERGE_BASE="$(git -C "$WORKTREE_PATH" merge-base HEAD "$BASE_REF" 2>/dev/null || true)"
if [[ -z "$MERGE_BASE" ]]; then
    printf 'ERROR: no merge base between HEAD and %s\n' "$BASE_REF" >&2
    exit 1
fi

printf 'base-ref: %s\n' "$BASE_REF" >&2
printf 'merge-base: %s\n' "$MERGE_BASE" >&2

CHANGED_TMP="/tmp/lekker-changed-files-tmp-$$.txt"
git -C "$WORKTREE_PATH" diff --name-only "$MERGE_BASE" HEAD > "$CHANGED_TMP" 2>/dev/null || true

if [[ "$INCLUDE_UNCOMMITTED" == "true" ]]; then
    git -C "$WORKTREE_PATH" diff --name-only HEAD >> "$CHANGED_TMP" 2>/dev/null || true
    git -C "$WORKTREE_PATH" diff --name-only --cached >> "$CHANGED_TMP" 2>/dev/null || true
    # Untracked-but-not-ignored files too: a fix agent that creates a new file
    # (extracted helper, new test) and does not stage it is invisible to both
    # diffs above, so its type/lint errors would escape attribution entirely.
    git -C "$WORKTREE_PATH" ls-files --others --exclude-standard >> "$CHANGED_TMP" 2>/dev/null || true
    sort -u "$CHANGED_TMP" -o "$CHANGED_TMP" 2>/dev/null || true
fi

cat "$CHANGED_TMP"
rm -f "$CHANGED_TMP"
