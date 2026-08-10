# Codex Adapter for geminiloop

This is a Codex-specific adapter for the `olko:geminiloop` skill.
The canonical skill definition is in `../../../SKILL.md`.

## Usage

Invoke in a Codex session:

```
Use the olko:geminiloop skill to clear the Gemini Code Assist review on this PR.
```

## Workflow

See `../../../SKILL.md` for the full workflow: post `/gemini review` when no review exists for the
current head, poll the reviews endpoint until it lands (Gemini publishes no check-run or score, so
detection is by review rather than by check), then evaluate every inline comment against the real
code before touching anything — fix only the findings that hold, rebut the rest with evidence,
reply to and resolve each thread, push, and repeat until no unresolved comments remain or the
iteration cap is reached. The procedure is plain `git`/`gh` and is agent-agnostic.

Inline comments carry a priority badge (`critical`/`high`/`medium`/`low`); weight the top two
seriously and treat the bottom two as usually-skippable nits unless clearly correct. The skill
biases toward rebutting over changing: never modify correct code to silence the bot.
