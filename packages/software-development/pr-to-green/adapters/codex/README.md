# Codex Adapter for pr-to-green

This is a Codex-specific adapter for the `olko:pr-to-green` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:pr-to-green skill to drive this PR to merge-ready.
```

## Workflow

See `../../SKILL.md` for the full workflow: ensure the PR exists, run ci-fix-loop
until all required checks pass, detect active AI review bots (Qodo, CodeRabbit),
run their fix loops in sequence until zero threads are unresolved, then confirm
the PR is merge-ready. The procedure is plain `git`/`gh` and is agent-agnostic.
