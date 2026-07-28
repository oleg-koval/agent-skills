# Codex Adapter for ci-fix-loop

This is a Codex-specific adapter for the `olko:ci-fix-loop` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:ci-fix-loop skill to diagnose and fix the failing GitHub Actions checks on this PR.
```

## Workflow

See `../../SKILL.md` for the full workflow: identify failing checks, verify the failure
is not a base-branch regression, fetch failing job logs via `gh run view --log-failed`,
diagnose the root cause, apply a targeted fix, commit and push staged changes, then poll
until CI reports a new result — repeating up to 5 times until all required checks are
green or a real blocker needs a human. The procedure is plain `git`/`gh` and is agent-agnostic.
