# Codex Adapter for qodoloop

This is a Codex-specific adapter for the `olko:qodoloop` skill.
The canonical skill definition is in `../../../SKILL.md`.

## Usage

Invoke in a Codex session:

```
Use the olko:qodoloop skill to drive this PR to zero unresolved Qodo findings.
```

## Workflow

See `../../../SKILL.md` for the full workflow: push, wait for Qodo's next pass, fetch unresolved
inline review threads via GraphQL, read each finding's own Agent Prompt, apply the fix, reply to
the thread explaining what was done, resolve it, push again, and repeat until clean, a rate limit
is hit, or the iteration cap is reached. The procedure is plain `git`/`gh` and is agent-agnostic.
