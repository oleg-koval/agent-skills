# Codex Adapter for dependabot-triage

This is a Codex-specific adapter for the `olko:dependabot-triage` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:dependabot-triage skill to triage the open Dependabot PRs in this repo.
```

## Workflow

See `../../SKILL.md` for the full workflow: fetch all open Dependabot and Renovate PRs,
classify each by risk tier (patch/minor/major/security), auto-approve and merge safe
patch bumps whose CI is green, flag major upgrades with a comment for human review, and
post a digest of what was done. The procedure is plain `gh` and is agent-agnostic.
