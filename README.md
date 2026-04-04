# olko-skills

Agent-agnostic skill collection for Codex, Claude, Cursor, and other skill-aware tools.

## Structure

- `packages/` — canonical skill packages
- `catalog/` — machine-readable inventory
- `collections/` — grouped package bundles
- `scripts/` — sync and validation helpers

## Principles

- Keep one canonical skill package per workflow.
- Put agent-specific wrappers in `adapters/` instead of duplicating the core skill.
- Keep catalogs neutral and machine-readable.
- Add marketplace-specific metadata on top of the canonical package, not instead of it.

## Initial packages

- `docs-index-keeper`
- `semantic-release-beta`
- `changelog-generator`
- `gh-cli`
- `git-commit`
- `gallery`
- `promptctl`

## Planned next steps

1. Copy more skills from the incubator into `packages/`.
2. Add sync tooling from source repos.
3. Add marketplace-ready metadata where the target platform is known.

## Root manifests

- Claude marketplace manifest: `.claude-plugin/marketplace.json`
- Cursor plugin index: `.cursor-plugin/index.json`

These are generated from the neutral package inventory and kept in the repo for platform-specific consumption.
