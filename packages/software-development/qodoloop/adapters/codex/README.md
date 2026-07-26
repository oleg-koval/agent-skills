# Codex Adapter for qodoloop

This is a Codex-specific adapter for the `olko:qodoloop` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:qodoloop skill to drive this PR to zero unresolved Qodo findings.
```

## Workflow

See `../../SKILL.md` for the full workflow: wait for Qodo's review of the current head, fetch
unresolved inline review threads via paginated GraphQL, read each finding's own Agent Prompt,
apply the fix, commit and push once the fix is durable, then reply to each thread (resolving fixed
ones, leaving blocked ones open) and repeat until clean, a rate limit is hit, or the iteration cap
is reached. The procedure is plain `git`/`gh` and is agent-agnostic.
