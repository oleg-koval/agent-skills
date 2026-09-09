#!/bin/bash
# revmux-engine.sh -- lekker-review's revmux caller (Phase 2 of the revmux spike).
#
# Usage:
#   revmux-engine.sh --task SLUG --run NAME --depth medium|deep --workdir DIR \
#     --diff-file FILE --context-file FILE --profile-file FILE --out FILE \
#     [--tasks-dir DIR] [--config-dir DIR]
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
        *) printf 'revmux-engine: unknown arg %s\n' "$1" >&2; exit 2 ;;
    esac
done

for req in TASK RUN DEPTH WORKDIR DIFF_FILE CONTEXT_FILE PROFILE_FILE OUT; do
    if [[ -z "${!req}" ]]; then
        printf 'revmux-engine: missing required --%s\n' "$(printf '%s' "$req" | tr 'A-Z' 'a-z' | tr '_' '-')" >&2
        exit 2
    fi
done

case "$DEPTH" in
    medium|deep) ;;
    *)
        printf 'revmux-engine: depth "%s" is not supported by this engine (only medium|deep -- scan stays on the workflow engine, it has no worktree)\n' "$DEPTH" >&2
        exit 2
        ;;
esac

PROFILE_NAME="lekker-${DEPTH}"

command -v revmux >/dev/null 2>&1 || { printf 'revmux-engine: revmux binary not found on PATH\n' >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { printf 'revmux-engine: jq not found on PATH\n' >&2; exit 2; }

# ---------------------------------------------------------------------------
# Codex guard: refuse to run a profile whose resolved text names a codex/
# runner. Company does not support the codex CLI (revmux is claude-only here).
# ---------------------------------------------------------------------------
PROFILE_TEXT_FILE="$CONFIG_DIR/prompts/profiles/${PROFILE_NAME}.md"
if [[ ! -f "$PROFILE_TEXT_FILE" ]]; then
    printf 'revmux-engine: cannot resolve profile text at %s to run the codex guard -- refusing to proceed\n' "$PROFILE_TEXT_FILE" >&2
    exit 2
fi
if grep -q 'codex/' "$PROFILE_TEXT_FILE"; then
    printf 'revmux-engine: profile %s names a codex/ runner -- codex is not supported here, refusing to run\n' "$PROFILE_TEXT_FILE" >&2
    exit 2
fi

mkdir -p "$TASKS_DIR"

NEW_JSON="$(revmux --tasks-dir "$TASKS_DIR" --config-dir "$CONFIG_DIR" new --task "$TASK" --run "$RUN")"

SCOPE_FILE="$(printf '%s' "$NEW_JSON" | jq -r '.scope')"
GOAL_FILE="$(printf '%s' "$NEW_JSON" | jq -r '.goal')"
PROFILE_INPUT_FILE="$(printf '%s' "$NEW_JSON" | jq -r '.profile')"
CONTEXT_DIR="$(printf '%s' "$NEW_JSON" | jq -r '.context')"

mkdir -p "$CONTEXT_DIR"

TARGET_LABEL="$(jq -r '.reviewTarget // "unknown target"' "$CONTEXT_FILE" 2>/dev/null || printf 'unknown target')"

BASE_REF=""
WORKTREE_JSON="$(dirname "$CONTEXT_FILE")/worktree.json"
if [[ -f "$WORKTREE_JSON" ]]; then
    BASE_REF="$(jq -r '.baseRef // .mergeBase // empty' "$WORKTREE_JSON" 2>/dev/null || true)"
fi

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
cp "$PROFILE_FILE" "$PROFILE_INPUT_FILE"

REVMUX_OUT="$OUT"
set +e
revmux --task "$TASK" --run "$RUN" --profile "$PROFILE_NAME" \
    --workdir "$WORKDIR" --tasks-dir "$TASKS_DIR" --config-dir "$CONFIG_DIR" \
    --no-tui > "$REVMUX_OUT"
CODE=$?
set -e

case "$CODE" in
    0) printf 'revmux exit 0 (no findings)\n' >&2 ;;
    1) printf 'revmux exit 1 (findings reported)\n' >&2 ;;
    *) printf 'revmux exit %s (tool error)\n' "$CODE" >&2 ;;
esac

exit "$CODE"
