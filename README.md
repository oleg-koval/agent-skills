<div align="center">
  <h1>agent skills</h1>
  <p><strong>Agent-agnostic skill catalog for Codex, Claude, Cursor, and other skill-aware tools.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-16a34a" alt="MIT license">
    <img src="https://img.shields.io/badge/skills-10-2563eb" alt="10 skills">
    <img src="https://img.shields.io/badge/platforms-Codex%20%7C%20Claude%20%7C%20Cursor%20%7C%20Copilot-111827" alt="Codex Claude Cursor Copilot">
    <img src="https://img.shields.io/badge/status-private%20beta-7c3aed" alt="Private beta">
  </p>
</div>

Agent-agnostic skill collection for Codex, Claude, Cursor, and other skill-aware tools.

These skills are opinionated by design. They encode working defaults, preferred tools, and repeatable workflows instead of trying to be neutral snippets. Treat them as starting points with taste: useful out of the box, easy to inspect, and specific enough for an agent to execute consistently.

## Structure

- `packages/` — canonical skill packages organized by category
- `catalog/` — machine-readable inventory
- `collections/` — grouped package bundles
- `scripts/` — sync and validation helpers

## Principles

- Keep one canonical skill package per workflow.
- Put agent-specific wrappers in `adapters/` instead of duplicating the core skill.
- Keep catalogs neutral and machine-readable.
- Add marketplace-specific metadata on top of the canonical package, not instead of it.

## Packages

### Software development

- `docs-index-keeper`
- `semantic-release-beta`
- `changelog-generator`
- `gh-cli`
- `git-commit`
- `promptctl`
- `product-builder`

### Music

- `fill-music-player`

### Marketing

- `viral-launch`

### Photography

- `gallery`

## How to use skills

Install the Codex symlinks, then mention a skill by its lookup name in a new agent session:

```bash
./scripts/install-codex-symlinks.sh
```

```text
Use the olko:semantic-release-beta skill to add prereleases on a beta branch.
```

```text
Use the olko:gallery skill to build a photo gallery from this image folder.
```

```text
Use the olko:viral-launch skill to make this project launch-ready.
```

Each package has a canonical `SKILL.md` under `packages/{category}/{skill}/`. Agent-specific wrappers live under that package's `adapters/` directory.

When adding or changing a skill:

1. Update the canonical `SKILL.md` first.
2. Keep instructions concrete and operational.
3. Add references only when the agent needs extra detail to execute the workflow.
4. Update `catalog/skills.json` if the skill name, category, description, path, tags, or adapters change.
5. Run local validation before publishing changes.

## Root manifests

- Claude marketplace manifest: `.claude-plugin/marketplace.json`
- Cursor plugin index: `.cursor-plugin/index.json`
- Copilot repository instructions: `.github/copilot-instructions.md`
- Copilot prompt files: `.github/prompts/*.prompt.md`

These are generated from the neutral package inventory and kept in the repo for platform-specific consumption.

## Install and test

### Codex

Install all canonical packages into your local Codex skills directory:

```bash
./scripts/install-codex-symlinks.sh
```

This creates symlinks from the package catalog into `${CODEX_HOME:-~/.codex}/skills` using the lookup format `olko:{skill_name}`.

To test a skill in a fresh Codex session, mention it explicitly:

```text
Use the olko:docs-index-keeper skill to set up docs index automation in this repo.
```

```text
Use the olko:semantic-release-beta skill to add prereleases on a beta branch.
```

### Claude

The repository includes a generated root manifest at `.claude-plugin/marketplace.json` and per-package Claude adapter stubs under `packages/*/*/adapters/claude/`.

Current status:

- suitable for local packaging and iteration
- not yet validated against a live Claude marketplace install flow

### Cursor

The repository includes a generated root plugin index at `.cursor-plugin/index.json` and per-package Cursor adapter stubs under `packages/*/*/adapters/cursor/`.

Current status:

- suitable for local packaging and iteration
- not yet validated against a live Cursor plugin install flow

### GitHub Copilot

The repository includes generated Copilot repository instructions at `.github/copilot-instructions.md` and one reusable prompt file per skill under `.github/prompts/`.

Current status:

- suitable for repository-level Copilot customization
- generated from the canonical package catalog
- not yet validated against GitHub Copilot in a live GitHub workspace

### Source sync

`./scripts/sync-from-sources.sh` syncs package content only for catalog entries that explicitly define `sourcePath`. If no package has `sourcePath`, the script exits successfully and reports that there is nothing to sync.

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
  - used `semantic-release-npm-github-publish` as the release preset
  - ran `semantic-release --dry-run --no-ci` on `beta`
  - verified prerelease calculation to `1.0.0-beta.1`

The semantic-release smoke test was intentionally self-contained and used a local bare git remote plus a valid `file://` repository URL so dry-run behavior could be validated without real npm or GitHub publishing credentials.

## Licensing notes

- `fill-music-player` includes an MIT license and is safe to carry as-is in this repository.
- `product-builder` now has an MIT license file added in the source repo clone and in this catalog package, matching the existing MIT claim in its README.
