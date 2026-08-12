# Codex Adapter for branch-cleanup

This is a Codex-specific adapter for the `olko:branch-cleanup` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:branch-cleanup skill to prune stale branches after the Dependabot merge wave.
```

## Workflow

See `../../SKILL.md` for the full workflow: fetch and prune remote tracking refs, identify
merged/closed remote branches via GitHub PR state, safety-filter protected and open-PR
branches, preview or execute deletions, and optionally clean up merged local branches.
Defaults to dry-run — pass --execute to apply. The procedure is plain git/gh and is agent-agnostic.
