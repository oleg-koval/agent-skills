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
- `fill-music-player`
- `promptctl`
- `product-builder`

## Planned next steps

1. Copy more skills from the incubator into `packages/`.
2. Add sync tooling from source repos.
3. Add marketplace-ready metadata where the target platform is known.

## Root manifests

- Claude marketplace manifest: `.claude-plugin/marketplace.json`
- Cursor plugin index: `.cursor-plugin/index.json`

These are generated from the neutral package inventory and kept in the repo for platform-specific consumption.

## Install and test

### Codex

Install all canonical packages into your local Codex skills directory:

```bash
./scripts/install-codex-symlinks.sh
```

This creates symlinks from `packages/*` into `${CODEX_HOME:-~/.codex}/skills`.

To test a skill in a fresh Codex session, mention it explicitly:

```text
Use the docs-index-keeper skill to set up docs index automation in this repo.
```

```text
Use the semantic-release-beta skill to add prereleases on a beta branch.
```

### Claude

The repository includes a generated root manifest at `.claude-plugin/marketplace.json` and per-package Claude adapter stubs under `packages/*/adapters/claude/`.

Current status:

- suitable for local packaging and iteration
- not yet validated against a live Claude marketplace install flow

### Cursor

The repository includes a generated root plugin index at `.cursor-plugin/index.json` and per-package Cursor adapter stubs under `packages/*/adapters/cursor/`.

Current status:

- suitable for local packaging and iteration
- not yet validated against a live Cursor plugin install flow

## Local validation

Rebuild generated manifests:

```bash
./scripts/build-adapters.sh
```

Validate the neutral catalog and generated root manifests:

```bash
./scripts/validate-catalog.sh
```

## Smoke-tested workflows

The following package workflows have been smoke-tested locally before first push:

- `docs-index-keeper`
  - installed from npm in a temporary git repo
  - initialized hook generation with `npx docs-index-keeper init`
  - updated `docs/README.md` from a staged Markdown file
  - passed `docs-index-keeper check`
- `semantic-release-beta`
  - configured a temporary git repo with `main` and `beta` branches
  - ran `semantic-release --dry-run --no-ci` on `beta`
  - verified prerelease calculation to `1.0.0-beta.1`

The semantic-release smoke test was intentionally self-contained and used a local bare git remote plus a valid `file://` repository URL so dry-run behavior could be validated without real npm or GitHub publishing credentials.

## Licensing notes

- `fill-music-player` includes an MIT license and is safe to carry as-is in this repository.
- `product-builder` now has an MIT license file added in the source repo clone and in this catalog package, matching the existing MIT claim in its README.
