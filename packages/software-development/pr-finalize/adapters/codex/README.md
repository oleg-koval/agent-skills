# Codex Adapter for pr-finalize

This is a Codex-specific adapter for the `olko:pr-finalize` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:pr-finalize skill to take PR #123 all the way to merge-ready.
```

## Workflow

See `../../SKILL.md` for the full workflow: establish the PR's ground truth (conflict state, which
checks are actually *required*, whether the repo auto-merges, whether each review bot really ran or
just rate-limited), rebase onto the base branch and resolve conflicts by understanding both sides,
sweep every review source (bots and humans) and triage each finding into fixed / rejected-with-reason
/ needs-a-human, close the unit and E2E coverage gap — stating explicitly when E2E is not applicable
and why — run the repo's own lint/format/test gates and capture their real output, then push,
explain the whole thing in one auditable PR comment, and verify the resulting state.

The procedure is plain `git`/`gh` and is agent-agnostic. Where a dedicated per-bot loop skill exists
(`olko:qodoloop`, `olko:coderabbitloop`, `olko:greploop`), delegate that bot's sweep to it rather
than reimplementing its protocol.
