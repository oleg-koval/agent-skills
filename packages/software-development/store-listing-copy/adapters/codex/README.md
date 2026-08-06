# Codex Adapter for store-listing-copy

This is a Codex-specific adapter for the `olko:store-listing-copy` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:store-listing-copy skill to generate App Store listing copy for the next release.
```

## Workflow

See `../../SKILL.md` for the full workflow: read app metadata and git changelog, classify
changes by user impact, draft platform-specific copy fields (title, subtitle, description,
what's new, keywords) within each platform's character limits, validate against store
policy rules, and write the output to a scratch file for human review and paste. Supports
iOS App Store, Google Play, and Garmin Connect IQ. The procedure is agent-agnostic.
