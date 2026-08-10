# Codex Adapter for pr-finalize-complete

This is a Codex-specific adapter for the `olko:pr-finalize-complete` skill.
The canonical skill definition is in `../../../SKILL.md`.

## Usage

Invoke in a Codex session:

```
Use the olko:pr-finalize-complete skill to verify this PR is actually merge-ready.
```

## Workflow

See `../../../SKILL.md` for the full workflow: re-check every review-bot and human finding against
the code as it stands now, separating comments that are genuinely fixed from those that are merely
stale (bot comments on moved or renamed files are common), run the repo's real lint and test gates
and report actual exit codes, then prepare a clean push. The procedure is plain `git`/`gh` and is
agent-agnostic.

Use this rather than `pr-finalize` when the work is believed already done and you need that claim
verified. The skill's non-negotiables are the point: never claim a test passed without running it,
and never resolve a bot comment without checking whether the issue still exists.
