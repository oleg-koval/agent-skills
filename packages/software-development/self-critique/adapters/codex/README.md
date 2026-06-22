# Codex Adapter for self-critique

This is a Codex-specific adapter for the `olko:self-critique` skill.
The canonical skill definition is in `../../../SKILL.md`.

## Usage

Invoke in a Codex session:

```
Use the olko:self-critique skill to adversarially review your last answer and report a confidence score.
```

## Workflow

See `../../../SKILL.md` for the full workflow: spawn a critic agent, verify every claim against live
sources, find the related issue or pattern you missed, then loop (revise, re-score) until satisfied
and report where you were wrong, iterations-to-satisfy, the numeric improvement, and a final score.

The optional Claude Code `Stop` hook (`scripts/critique-nudge.mjs`) is Claude-specific and does not
apply to Codex; the skill procedure itself is agent-agnostic.
