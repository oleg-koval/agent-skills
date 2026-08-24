# Codex Adapter for pr-finalize-complete

This is a Codex-specific adapter for the `olko:pr-finalize-complete` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:pr-finalize-complete skill to verify this PR is genuinely merge-ready.
```

## Workflow

See `../../SKILL.md` for the full workflow: establish ground truth on PR state, rebase
only if needed, triage each review comment to determine if it's already fixed, stale,
still present, or a false positive, verify unit test coverage for changed files, run
the real lint/format/test gates, push if needed, and report what still needs a human.
The procedure is plain git/gh and is agent-agnostic.
