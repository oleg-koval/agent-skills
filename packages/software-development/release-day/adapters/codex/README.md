# Codex Adapter for release-day

This is a Codex-specific adapter for the `olko:release-day` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:release-day skill to cut the iOS release for version 2.5.0.
```

## Workflow

See `../../SKILL.md` for the full workflow: verify the main branch CI is green, generate
a changelog from git history, draft platform-ready store listing copy, trigger
semantic-release or tag manually, wait for the build artifact, and queue the App Store
submission. Supports iOS, Android, and Garmin. The procedure is agent-agnostic.
