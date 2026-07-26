# Codex Adapter for coderabbitloop

This is a Codex-specific adapter for the `olko:coderabbitloop` skill.
The canonical skill definition is in `../../../SKILL.md`.

## Usage

Invoke in a Codex session:

```
Use the olko:coderabbitloop skill to drive this PR to zero unresolved CodeRabbit findings.
```

## Workflow

See `../../../SKILL.md` for the full workflow: push (nudging with `@coderabbitai review` if the
repo doesn't auto-review), fetch unresolved inline review threads via GraphQL, read each finding's
own Prompt for AI Agents block, apply the fix, reply to the thread explaining what was done,
resolve it, push again, and repeat until clean, a rate limit is hit, or the iteration cap is
reached. The procedure is plain `git`/`gh` and is agent-agnostic.
