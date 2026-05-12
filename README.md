<div align="center">
  <h1>agent skills</h1>
  <p><strong>Agent-agnostic skill catalog for Codex, Claude, Cursor, Copilot, Windsurf, Kiro, and other skill-aware tools.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-16a34a" alt="MIT license">
    <img src="https://img.shields.io/badge/skills-18-2563eb" alt="18 skills">
    <img src="https://img.shields.io/badge/platforms-Codex%20%7C%20Claude%20%7C%20Cursor%20%7C%20Copilot%20%7C%20Windsurf%20%7C%20Kiro-111827" alt="Codex Claude Cursor Copilot Windsurf Kiro">
    <img src="https://img.shields.io/badge/status-public%20catalog-16a34a" alt="Public catalog">
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

## Quick Start

<details>
<summary><b>Codex</b></summary>

Install all package symlinks into your local Codex skills directory:

```bash
git clone https://github.com/oleg-koval/agent-skills.git
cd agent-skills
./scripts/install-codex-symlinks.sh
```

Then mention a lookup name in a new Codex session:

```text
Use the olko:semantic-release-beta skill to add prereleases on a beta branch.
```

</details>

<details>
<summary><b>Claude Code</b></summary>

The repository includes a generated Claude marketplace manifest at `.claude-plugin/marketplace.json`.

**For marketplace installs:**

```text
/plugin marketplace add oleg-koval/agent-skills
```

Then install the catalog plugin:

```text
/plugin install olko-agent-skills@olko-agent-skills
```

**For local development:**

Clone the repo and point Claude Code at the plugin directory:

```bash
git clone https://github.com/oleg-koval/agent-skills.git
claude --plugin-dir /path/to/agent-skills
```

See [Publishing to Marketplaces](#publishing-to-marketplaces) below for full submission details.

</details>

<details>
<summary><b>Cursor</b></summary>

The repository includes a generated Cursor plugin index at `.cursor-plugin/index.json` and per-package Cursor adapters under `packages/*/*/adapters/cursor/`.

**For plugin marketplace:**

Install from Cursor's extension marketplace using the published repository.

**For a single project:**

Copy the relevant `SKILL.md` or adapter content into `.cursor/rules/`, or reference the full package directory from your Cursor rules.

See [Publishing to Marketplaces](#publishing-to-marketplaces) for registry submission.

</details>

<details>
<summary><b>GitHub Copilot</b></summary>

Use the generated repository instructions and prompt files:

```text
.github/copilot-instructions.md
.github/prompts/*.prompt.md
```

**To use in your GitHub workspace:**

Copy `.github/copilot-instructions.md` to your repository and enable Copilot. It will automatically apply skill guidance.

**To customize per-skill:**

Use files from `.github/prompts/*.prompt.md` in your Copilot configuration.

See [Publishing to Marketplaces](#publishing-to-marketplaces) for integration details.

</details>

<details>
<summary><b>Windsurf</b></summary>

The repository includes generated Windsurf Cascade Rules at `.windsurf/rules/`.

**For a single project:**

Copy the relevant `.windsurf/rules/{skill-name}.md` into your project's `.windsurf/rules/` directory. Windsurf picks them up automatically as Cascade Rules.

**For all skills at once:**

```bash
git clone https://github.com/oleg-koval/agent-skills.git
cp agent-skills/.windsurf/rules/*.md /path/to/your/project/.windsurf/rules/
```

Each rule file has a `description` frontmatter field that Windsurf displays in the rules panel.

</details>

<details>
<summary><b>Kiro</b></summary>

The repository includes generated Kiro steering documents at `.kiro/steering/`.

**For a single project:**

Copy the relevant `.kiro/steering/{skill-name}.md` into your project's `.kiro/steering/` directory.

**For all skills at once:**

```bash
git clone https://github.com/oleg-koval/agent-skills.git
cp agent-skills/.kiro/steering/*.md /path/to/your/project/.kiro/steering/
```

Each steering doc uses `inclusion: manual` so Kiro only loads it when you explicitly reference it, keeping context lean.

</details>

<details>
<summary><b>Other agents</b></summary>

Skills are plain Markdown. Use the canonical package file directly:

```text
packages/{category}/{skill}/SKILL.md
```

Agent-specific wrappers live under:

```text
packages/{category}/{skill}/adapters/
```

</details>

## All 18 Skills

These packages are the entry points. Each one is a structured workflow with concrete trigger conditions and execution steps. You can reference any skill directly by its `olko:*` lookup name.

### Software development

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [docs-index-keeper](packages/software-development/docs-index-keeper/SKILL.md) | Keeps a Markdown docs index in sync through pre-commit, CI, or one-off maintenance flows | A repo has `docs/` and needs `docs/README.md` or another Markdown index updated automatically |
| [semantic-release-beta](packages/software-development/semantic-release-beta/SKILL.md) | Sets up `semantic-release-npm-github-publish` with stable `main` releases and beta prereleases | A Node package needs stable npm publishing plus beta prereleases from a `beta` branch |
| [changelog-generator](packages/software-development/changelog-generator/SKILL.md) | Generates user-facing changelogs and release notes from git history | Preparing release notes, app store update text, customer changelogs, or internal release summaries |
| [gh-cli](packages/software-development/gh-cli/SKILL.md) | Guides GitHub CLI usage for repos, PRs, Actions, releases, issues, and related GitHub operations | Working with GitHub from the command line and needing reliable `gh` commands |
| [git-commit](packages/software-development/git-commit/SKILL.md) | Creates conventional commits with diff-aware staging and message generation | The user asks to commit changes or wants a conventional commit message from the current diff |
| [add-to-my-skills](packages/software-development/add-to-my-skills/SKILL.md) | Copies a skill from another repo into this catalog, then refreshes docs, manifests, commit, and push | Bringing a newly created skill into this repository |
| [promptctl](packages/software-development/promptctl/SKILL.md) | Uses `promptctl` for reusable prompt templates, scoring, and workflow automation | A project needs prompt conventions, prompt review, prompt scoring, or reusable prompt workflows |
| [product-builder](packages/software-development/product-builder/SKILL.md) | Builds a full-stack web app or SaaS product from a user description using production-oriented defaults | The user asks to build a complete app, SaaS, dashboard, or product rather than a prototype |
| [cloudflare-block-countries](packages/software-development/cloudflare-block-countries/SKILL.md) | Blocks specific countries via Cloudflare WAF Custom Rules using the API | Geo-blocking traffic, setting up WAF country rules, or blocking regions across single or multiple zones |
| [ai-tools-setup](packages/software-development/ai-tools-setup/SKILL.md) | Installs, repairs, and measures the RTK+ICM+Vox AI development toolkit | Setting up or repairing AI dev tooling hooks, MCP config, or reviewing a weekly token savings digest |
| [starter-rules](packages/software-development/starter-rules/SKILL.md) | Loads and enforces hard rules for every oleg-koval/* starter | Ensuring 300-line files, E2E tests, pre-commit hooks, Vertical Slice architecture, and KISS/DRY/SOLID |
| [open-source-publisher](packages/software-development/open-source-publisher/SKILL.md) | Prepares an open-source repository for public publishing with branding, CI/CD, and release hygiene | Releasing a private project publicly with proper GitHub Pages, README, and social preview |
| [obsidian-pr-sync](packages/software-development/obsidian-pr-sync/SKILL.md) | Fetches open GitHub PRs assigned to you or requesting review, and writes a grouped age-sorted section into today's Obsidian daily note | Syncing GitHub review queue to Obsidian at the start of the day or on demand |
| [obsidian-task-rollover](packages/software-development/obsidian-task-rollover/SKILL.md) | Migrates unchecked tasks from today's Obsidian daily note to the next workday under `## Carried over`, marking source tasks as `[>]` | End-of-day bullet-journal task migration, rolling unfinished work to the next workday |

### Music

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [fill-music-player](packages/music/fill-music-player/SKILL.md) | Fills a portable music player with a curated random music selection while balancing formats, artists, albums, and capacity | Copying music from a NAS or local library to a Walkman, iPod, USB drive, or similar device |

### Marketing

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [viral-launch](packages/marketing/viral-launch/SKILL.md) | Sets up a project repository and launch plan for shareable marketing, public launch readiness, and growth loops | Preparing a repo, product, open-source package, waitlist, or creator tool for public launch |
| [search-console-indexing-audit](packages/marketing/search-console-indexing-audit/SKILL.md) | Audits Google Search Console Coverage exports against sitemap, robots, canonical, redirect, and noindex signals | Diagnosing GSC indexing issues such as redirects, canonical alternates, and discovered but not indexed pages |

### Photography

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [gallery](packages/photography/gallery/SKILL.md) | Creates photo galleries with AI-assisted layout curation and sequencing | Building a gallery from photos or planning photo layout, sequencing, and curation |

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
Use the olko:add-to-my-skills skill to copy a skill from another repo into this catalog, update the README, and push the change.
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

| Harness | File | Format |
|---------|------|--------|
| Claude Code | `.claude-plugin/marketplace.json` | Marketplace plugin registry |
| Claude Code | `.claude-plugin/plugin.json` | Plugin manifest |
| Cursor | `.cursor-plugin/index.json` | Plugin index |
| GitHub Copilot | `.github/copilot-instructions.md` | Repository instructions |
| GitHub Copilot | `.github/prompts/*.prompt.md` | Per-skill prompt files |
| Windsurf | `.windsurf/rules/*.md` | Cascade rules |
| Kiro | `.kiro/steering/*.md` | Steering documents |

All root manifests are generated from `catalog/skills.json` by `./scripts/build-adapters.sh`.

## How Skills Work

Every package follows a consistent anatomy:

```text
packages/{category}/{skill}/
├── SKILL.md              # Required canonical skill definition
├── references/           # Optional supporting material loaded only when needed
└── adapters/             # Agent-specific wrappers (all generated by build-adapters.sh)
    ├── codex/            # OpenAI Codex — README.md stub
    ├── claude/           # Claude Code — plugin.json + skills/SKILL.md copy
    ├── cursor/           # Cursor — plugin.json + skills/SKILL.md copy
    ├── windsurf/         # Windsurf — rules/{name}.md (Cascade Rules format)
    └── kiro/             # Amazon Kiro — steering/{name}.md (steering doc format)
```

Key design choices:

- Process over prose: skills are workflows agents follow, not generic reference essays.
- Progressive disclosure: `SKILL.md` is the entry point; supporting files load only when needed.
- Adapter separation: Codex, Claude, Cursor, Copilot, Windsurf, and Kiro metadata wrap the canonical package instead of forking it.
- Verifiable changes: catalog and manifest changes should pass `./scripts/validate-catalog.sh`.

See [docs/skill-anatomy.md](docs/skill-anatomy.md) for the package format.

## Project Structure

```text
agent-skills/
├── packages/                         # Canonical skill packages
│   ├── software-development/
│   │   ├── docs-index-keeper/
│   │   ├── semantic-release-beta/
│   │   ├── changelog-generator/
│   │   ├── gh-cli/
│   │   ├── git-commit/
│   │   ├── add-to-my-skills/
│   │   ├── promptctl/
│   │   └── product-builder/
│   ├── music/
│   │   └── fill-music-player/
│   ├── marketing/
│   │   └── viral-launch/
│   └── photography/
│       └── gallery/
├── catalog/                          # Machine-readable package inventory
├── collections/                      # Grouped package bundles
├── scripts/                          # Build, validation, sync, and install helpers
├── .claude-plugin/                   # Generated Claude marketplace manifest
├── .cursor-plugin/                   # Generated Cursor plugin index
├── .github/prompts/                  # Generated GitHub Copilot prompt files
├── .windsurf/rules/                  # Generated Windsurf Cascade Rules
├── .kiro/steering/                   # Generated Kiro steering documents
└── docs/                             # Contributor and package format docs
```

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

Status: **Stable** — ready for daily use

### Claude Code

The repository includes a generated marketplace manifest at `.claude-plugin/marketplace.json` and per-package Claude adapter stubs under `packages/*/*/adapters/claude/`.

**Local development:**

```bash
git clone https://github.com/oleg-koval/agent-skills.git
claude --plugin-dir /path/to/agent-skills
```

**Marketplace installation:**

See [Publishing to Marketplaces → Claude Marketplace](#claude-marketplace) for submission and user installation instructions.

Status: **Ready for marketplace** — fully generated manifests, ready to publish

### Cursor

The repository includes a generated plugin index at `.cursor-plugin/index.json` and per-package Cursor adapter stubs under `packages/*/*/adapters/cursor/`.

See [Publishing to Marketplaces → Cursor Plugin Registry](#cursor-plugin-registry) for submission instructions.

Status: **Ready for marketplace** — plugin index generated and ready to submit

### GitHub Copilot

The repository includes generated repository instructions at `.github/copilot-instructions.md` and per-skill prompt files under `.github/prompts/`.

To use in your GitHub workspace, copy `.github/copilot-instructions.md` to your repository.

See [Publishing to Marketplaces → GitHub Copilot](#github-copilot) for integration details.

Status: **Ready to use** — copy instructions to any GitHub repository

### Source sync

`./scripts/sync-from-sources.sh` syncs package content only for catalog entries that explicitly define `sourcePath`. If no package has `sourcePath`, the script exits successfully and reports that there is nothing to sync.

## Publishing to Marketplaces

### Claude Marketplace

The repository includes a generated marketplace manifest at `.claude-plugin/marketplace.json` that is compatible with Claude Code's plugin system.

**To submit to Claude marketplace:**

1. Ensure the repository is public and contains this structure:
   ```
   ├── .claude-plugin/
   │   └── marketplace.json    # Generated from catalog/skills.json
   └── packages/
       └── {category}/{skill}/
           ├── SKILL.md        # Required canonical definition
           └── adapters/
               └── claude/     # Optional Claude-specific wrapper
   ```

2. Push to GitHub with a public repository:
   ```bash
   git push origin main
   ```

3. Submit the repository URL to Claude's plugin marketplace:
   - In Claude Code: `/plugin marketplace add oleg-koval/agent-skills`
   - Or visit the Claude plugin marketplace and add `https://github.com/oleg-koval/agent-skills`

4. The marketplace will:
   - Read `.claude-plugin/marketplace.json` for plugin metadata
   - Index all skills from `catalog/skills.json`
   - Auto-register skills by their `name` field
   - Use `adapters: ["claude"]` entries to provide Claude-specific hints

**After publishing:**
- Users install with: `/plugin install olko-agent-skills@olko-agent-skills`
- All 12 skills become available as `olko:*` lookup names in Claude Code

### Cursor Plugin Registry

Cursor plugin index is generated at `.cursor-plugin/index.json`.

**To submit to Cursor:**

1. Ensure Cursor plugin metadata is present:
   - `.cursor-plugin/index.json` (generated)
   - `packages/*/*/adapters/cursor/` (optional Cursor-specific guidance)

2. Submit the repository to Cursor's plugin marketplace with the `.cursor-plugin/` manifest

3. Users install from Cursor's extension marketplace and reference skills by lookup name

### GitHub Copilot

Generated Copilot instructions are at `.github/copilot-instructions.md` and per-skill prompts under `.github/prompts/`.

**To use in a GitHub workspace:**

1. Copy `.github/copilot-instructions.md` to your repository
2. Copilot reads this file automatically when enabled
3. Per-skill prompts can be referenced or imported into custom Copilot configurations

### Codex

Codex installation uses symlinks:

```bash
./scripts/install-codex-symlinks.sh
```

Codex looks up skills by `olko:*` lookup names from the installed symlink directories.

## Local validation

Rebuild generated manifests:

```bash
./scripts/build-adapters.sh
```

Validate the neutral catalog and generated root manifests:

```bash
./scripts/validate-catalog.sh
```

Run both before pushing marketplace updates:

```bash
./scripts/build-adapters.sh && ./scripts/validate-catalog.sh
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

- `add-to-my-skills`
  - copied a source skill into `packages/software-development/`
  - refreshed generated manifests with `./scripts/build-adapters.sh`
  - validated catalog and generated files with `./scripts/validate-catalog.sh`

The semantic-release smoke test was intentionally self-contained and used a local bare git remote plus a valid `file://` repository URL so dry-run behavior could be validated without real npm or GitHub publishing credentials.

## Licensing notes

- `fill-music-player` includes an MIT license and is safe to carry as-is in this repository.
- `product-builder` now has an MIT license file added in the source repo clone and in this catalog package, matching the existing MIT claim in its README.
