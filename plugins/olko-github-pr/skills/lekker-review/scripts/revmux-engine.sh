#!/bin/bash
# revmux-engine.sh -- lekker-review's revmux caller (Phase 2 of the revmux spike).
#
# Usage:
#   revmux-engine.sh --task SLUG --run NAME --depth medium|deep --workdir DIR \
#     --diff-file FILE --context-file FILE --profile-file FILE --out FILE \
#     [--tasks-dir DIR] [--config-dir DIR] [--profile NAME]
#
# Builds one revmux round (scope.md, goal.md, input/context/, input/profile.md),
# runs revmux --no-tui, writes its stdout JSON to --out, and exits with revmux's
# own code (0 = no findings, 1 = findings, 2 = tool error). A round name that
# already exists is revmux's own error -- this script never deletes anything to
# work around it.
set -euo pipefail

TASK=""
RUN=""
DEPTH=""
WORKDIR=""
DIFF_FILE=""
CONTEXT_FILE=""
PROFILE_FILE=""
OUT=""
TASKS_DIR="${LEKKER_REVMUX_TASKS_DIR:-$HOME/code-reviews/revmux-tasks}"
CONFIG_DIR="${REVMUX_CONFIG_DIR:-$HOME/.config/revmux}"
PROFILE_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --task) TASK="$2"; shift 2 ;;
        --run) RUN="$2"; shift 2 ;;
        --depth) DEPTH="$2"; shift 2 ;;
        --workdir) WORKDIR="$2"; shift 2 ;;
        --diff-file) DIFF_FILE="$2"; shift 2 ;;
        --context-file) CONTEXT_FILE="$2"; shift 2 ;;
        --profile-file) PROFILE_FILE="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --tasks-dir) TASKS_DIR="$2"; shift 2 ;;
        --config-dir) CONFIG_DIR="$2"; shift 2 ;;
        --profile) PROFILE_NAME="$2"; shift 2 ;;
        *) printf 'revmux-engine: unknown arg %s\n' "$1" >&2; exit 2 ;;
    esac
done

for req in TASK RUN DEPTH WORKDIR DIFF_FILE CONTEXT_FILE PROFILE_FILE OUT; do
    if [[ -z "${!req}" ]]; then
        printf 'revmux-engine: missing required --%s\n' "$(printf '%s' "$req" | tr 'A-Z' 'a-z' | tr '_' '-')" >&2
        exit 2
    fi
done

for input in DIFF_FILE CONTEXT_FILE PROFILE_FILE; do
    if [[ ! -r "${!input}" ]]; then
        printf 'revmux-engine: --%s must be a readable file: %s\n' \
            "$(printf '%s' "$input" | tr 'A-Z' 'a-z' | tr '_' '-')" "${!input}" >&2
        exit 2
    fi
done

WORKTREE_JSON="$(dirname "$CONTEXT_FILE")/worktree.json"
if [[ ! -r "$WORKTREE_JSON" ]]; then
    printf 'revmux-engine: worktree configuration must be readable: %s\n' "$WORKTREE_JSON" >&2
    exit 2
fi

case "$DEPTH" in
    medium|deep) ;;
    *)
        printf 'revmux-engine: depth "%s" is not supported by this engine (only medium|deep -- scan stays on the workflow engine, it has no worktree)\n' "$DEPTH" >&2
        exit 2
        ;;
esac

if [[ -z "$PROFILE_NAME" ]]; then
    PROFILE_NAME="lekker-${DEPTH}"
fi
if [[ ! "$PROFILE_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'revmux-engine: invalid profile name: %s\n' "$PROFILE_NAME" >&2
    exit 2
fi

command -v revmux >/dev/null 2>&1 || { printf 'revmux-engine: revmux binary not found on PATH\n' >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { printf 'revmux-engine: jq not found on PATH\n' >&2; exit 2; }

mkdir -p "$TASKS_DIR"

NEW_JSON="$(revmux --tasks-dir "$TASKS_DIR" --config-dir "$CONFIG_DIR" new --task "$TASK" --run "$RUN")"

resolve_new_path() {
    local key="$1"
    local value
    if ! value="$(printf '%s' "$NEW_JSON" | jq -er --arg key "$key" \
        '.[$key] | select(type == "string" and length > 0)')" \
        || [[ -z "$value" || "$value" == "null" ]]; then
        printf 'revmux-engine: revmux new returned an invalid %s path\n' "$key" >&2
        return 2
    fi
    printf '%s' "$value"
}

SCOPE_FILE="$(resolve_new_path scope)"
GOAL_FILE="$(resolve_new_path goal)"
PROFILE_INPUT_FILE="$(resolve_new_path profile)"
CONTEXT_DIR="$(resolve_new_path context)"

mkdir -p "$CONTEXT_DIR"

TARGET_LABEL="$(jq -r '.reviewTarget // "unknown target"' "$CONTEXT_FILE" 2>/dev/null || printf 'unknown target')"

BASE_REF=""
BASE_REF="$(jq -r '.mergeBase // .baseRef // empty' "$WORKTREE_JSON" 2>/dev/null || true)"

{
    printf '# Scope\n\n'
    printf 'Under review: %s\n\n' "$TARGET_LABEL"
    printf 'Diff file (authoritative): %s\n\n' "$DIFF_FILE"
    if [[ -n "$BASE_REF" ]]; then
        printf 'Reproduce inside WORKDIR with:\n\n    git -C %s diff %s...HEAD\n\n' "$WORKDIR" "$BASE_REF"
    else
        printf 'No base ref was recorded for this worktree; the diff file above is authoritative, do not attempt to reconstruct it from git.\n\n'
    fi
} > "$SCOPE_FILE"

{
    printf '# Goal\n\n'
    printf '## PR title\n\n%s\n\n' "$(jq -r '.reviewTarget // "none provided"' "$CONTEXT_FILE" 2>/dev/null || printf 'none provided')"
    printf '## Ticket / acceptance criteria\n\n%s\n\n' "$(jq -r '.acList // "none provided"' "$CONTEXT_FILE" 2>/dev/null || printf 'none provided')"
    printf '## Scoping decisions\n\n%s\n\n' "$(jq -r '.scopingDecisions // "none provided"' "$CONTEXT_FILE" 2>/dev/null || printf 'none provided')"
} > "$GOAL_FILE"

cp "$CONTEXT_FILE" "$CONTEXT_DIR/context.json"
cp "$DIFF_FILE" "$CONTEXT_DIR/pr.diff"
cp "$WORKTREE_JSON" "$CONTEXT_DIR/worktree.json"
cp "$PROFILE_FILE" "$PROFILE_INPUT_FILE"

REVMUX_OUT="$OUT"
set +e
revmux --task "$TASK" --run "$RUN" --profile "$PROFILE_NAME" \
    --workdir "$WORKDIR" --tasks-dir "$TASKS_DIR" --config-dir "$CONFIG_DIR" \
    --tools=Read,Grep,Glob,WebFetch,WebSearch \
    --no-tui > "$REVMUX_OUT"
CODE=$?
set -e

case "$CODE" in
    0) printf 'revmux exit 0 (no findings)\n' >&2 ;;
    1) printf 'revmux exit 1 (findings reported)\n' >&2 ;;
    *) printf 'revmux exit %s (tool error)\n' "$CODE" >&2 ;;
esac

exit "$CODE"
