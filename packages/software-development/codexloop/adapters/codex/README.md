# Codex Adapter for codexloop

This is a Codex-specific adapter for the `olko:codexloop` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```
Use the olko:codexloop skill to clear the Codex review on this PR.
```

## Workflow

See `../../SKILL.md` for the full workflow: resolve the Codex bot login from the PR itself
(it varies by installation, so it is never hardcoded), post `@codex review` when no review exists
for the current head, poll the reviews endpoint until it lands, then evaluate every inline comment
against the real code before touching anything — fix only the findings that hold, rebut the rest
with evidence, reply to and resolve each thread, push, and repeat until clean or the iteration cap
is reached. The procedure is plain `git`/`gh` and is agent-agnostic.

Note the skill is deliberately skeptical: Codex reasons largely from the diff hunk, so its
characteristic failure is asserting a bug that the unchanged surrounding code already handles.
Reading the whole file and the call sites before accepting a finding is the point of the loop, and
a wrong suggestion applied is worse than the comment itself.
