<div align="center">
  <h1>agent skills</h1>
  <p><strong>Agent-agnostic skill catalog for Codex, Claude, Cursor, Grok, Copilot, Windsurf, Kiro, and other skill-aware tools.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-16a34a" alt="MIT license">
    <img src="https://img.shields.io/badge/skills-23-2563eb" alt="23 skills">
    <img src="https://img.shields.io/badge/platforms-Codex%20%7C%20Claude%20%7C%20Cursor%20%7C%20Grok%20%7C%20Copilot%20%7C%20Windsurf%20%7C%20Kiro-111827" alt="Codex Claude Cursor Grok Copilot Windsurf Kiro">
    <img src="https://img.shields.io/badge/status-public%20catalog-16a34a" alt="Public catalog">
  </p>
</div>

Agent-agnostic skill collection for Codex, Claude, Cursor, Grok, and other skill-aware tools.

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

</details>

<details>
<summary><b>Grok</b></summary>

Grok (xAI) supports plugins via marketplace or direct path. Add this catalog as a marketplace source:

```bash
grok plugin marketplace add oleg-koval/agent-skills
```

Or for local development / direct use:

```bash
grok agent --plugin-dir /path/to/agent-skills
```

Skills are available via their `olko:*` names or through the installed plugin. Grok discovers `plugin.json` + `skills/` (and falls back to `.claude-plugin/` manifests for compatibility).

The repo generates `.grok-plugin/index.json` for structured plugin discovery.

</details>

<details>
<summary><b>Cursor</b></summary>

Copy the relevant `SKILL.md` or adapter content into `.cursor/rules/`, or reference the full package directory from your Cursor rules.

</details>

<details>
<summary><b>GitHub Copilot</b></summary>

Copy `.github/copilot-instructions.md` to your repository and enable Copilot. It will automatically apply skill guidance.

</details>

<details>
<summary><b>Windsurf</b></summary>

Copy the relevant `.windsurf/rules/{skill-name}.md` into your project's `.windsurf/rules/` directory. Windsurf picks them up automatically as Cascade Rules.

</details>

<details>
<summary><b>Kiro</b></summary>

Copy the relevant `.kiro/steering/{skill-name}.md` into your project's `.kiro/steering/` directory.

</details>

<details>
<summary><b>Other agents</b></summary>

Skills are plain Markdown. Use the canonical package file directly:

```text
packages/{category}/{skill}/SKILL.md
```

</details>

## All 23 Skills

Each entry links to its `SKILL.md`. Reference any skill by its `olko:*` lookup name in a new agent session.

### Software development (19)

| Skill | What it does | Use when |
|-------|-------------|----------|
| [add-to-my-skills](packages/software-development/add-to-my-skills/SKILL.md) | Copies a newly created skill from another repo into this catalog, refreshes the README and generated manifests, then commits and pushes | Adding a skill you wrote elsewhere into this catalog |
| [ai-tools-setup](packages/software-development/ai-tools-setup/SKILL.md) | Sets up, repairs, and reports on the RTK + ICM + Vox AI development toolkit — installs missing tools, fixes broken hooks and MCP config | Bootstrapping AI dev tools on a new machine or diagnosing broken integrations |
| [apple-store-submit](packages/software-development/apple-store-submit/SKILL.md) | Handles App Store rejection emails end-to-end — parses rejection reasons, creates a fix plan, implements code changes, and prepares resubmission | Responding to App Store rejections for privacy strings, entitlements, or guideline violations |
| [changelog-generator](packages/software-development/changelog-generator/SKILL.md) | Transforms git commits into polished user-facing changelogs by categorising changes and rewriting technical commit messages | Preparing release notes, app store update descriptions, or a public changelog |
| [cloudflare-block-countries](packages/software-development/cloudflare-block-countries/SKILL.md) | Blocks specific countries via Cloudflare WAF Custom Rules using the API | Geo-blocking traffic or setting up WAF country rules across single or multiple zones |
| [crash-course](packages/software-development/crash-course/SKILL.md) | Expert tutor for rapid, source-grounded learning of any topic: a timed 4-hour sprint plus cheat-sheet, learning-ladder, quiz-me, Feynman, and resource-curation modes | Ramping up on an unfamiliar codebase, project, or concept under time pressure |
| [docs-index-keeper](packages/software-development/docs-index-keeper/SKILL.md) | Keeps a Markdown docs index in sync through pre-commit, CI, or one-off maintenance flows | A repo has `docs/` and needs `docs/README.md` updated automatically |
| [gh-cli](packages/software-development/gh-cli/SKILL.md) | Guides GitHub CLI usage for repos, PRs, Actions, releases, issues, and all related GitHub operations | Working with GitHub from the command line and needing reliable `gh` commands |
| [git-commit](packages/software-development/git-commit/SKILL.md) | Creates conventional commits with diff-aware staging and message generation | Asking to commit changes or wanting a conventional commit message from the current diff |
| [macos-menubar-app](packages/software-development/macos-menubar-app/SKILL.md) | Builds a production-quality macOS menubar or notch app in SwiftUI — MenuBarExtra setup, sandbox entitlements, keyboard shortcuts, sound effects | Building a native macOS utility that lives in the menu bar or Dynamic Island notch |
| [mvp-oneshot](packages/software-development/mvp-oneshot/SKILL.md) | Takes a rough product idea and produces a scoped, testable MVP plan and initial implementation in a single pass | Going from idea to a shippable one-week MVP without losing scope |
| [obsidian-pr-sync](packages/software-development/obsidian-pr-sync/SKILL.md) | Fetches open GitHub PRs assigned to you or requesting review and writes a grouped age-sorted section into today's Obsidian daily note | Syncing GitHub review queue to Obsidian at the start of the day or on demand |
| [obsidian-task-rollover](packages/software-development/obsidian-task-rollover/SKILL.md) | Migrates unchecked tasks from today's Obsidian daily note to the next workday under `## Carried over` | End-of-day bullet-journal task migration |
| [open-source-publisher](packages/software-development/open-source-publisher/SKILL.md) | Prepares an open-source repository for public publishing with branding, CI/CD, and release hygiene | Releasing a private project publicly with proper GitHub Pages, README, and social preview |
| [product-builder](packages/software-development/product-builder/SKILL.md) | Builds a full-stack web app or SaaS product from a user description using production-oriented defaults | Building a complete app, SaaS, dashboard, or product rather than a prototype |
| [promptctl](packages/software-development/promptctl/SKILL.md) | Uses `promptctl` for reusable prompt templates, scoring, and workflow automation | A project needs prompt conventions, review, scoring, or reusable prompt workflows |
| [review-past-performance](packages/software-development/review-past-performance/SKILL.md) | Pulls 24h of ICM memories, git history, and skill analytics; detects repeated mistakes and slow workflows; proposes 1-3 concrete fixes | Daily self-improvement loop or codifying a repeated workflow |
| [semantic-release-beta](packages/software-development/semantic-release-beta/SKILL.md) | Sets up `semantic-release` with stable `main` releases and beta prereleases on a `beta` branch | A Node package needs stable npm publishing plus beta prereleases |
| [skill-budget-audit](packages/software-development/skill-budget-audit/SKILL.md) | Diagnoses and fixes Claude Code's skill context budget overflow — identifies heavy plugin bundles that exceed the 2% budget | Skills failing to load or Claude hitting context limits from plugin bundles |
| [starter-rules](packages/software-development/starter-rules/SKILL.md) | Loads and enforces hard rules for every oleg-koval/* starter | Ensuring 300-line files, E2E tests, pre-commit hooks, Vertical Slice architecture, and KISS/DRY/SOLID |

### Marketing (2)

| Skill | What it does | Use when |
|-------|-------------|----------|
| [search-console-indexing-audit](packages/marketing/search-console-indexing-audit/SKILL.md) | Audits Google Search Console Coverage exports against sitemap, robots, canonical, redirect, and noindex signals | Diagnosing GSC indexing issues such as redirects, canonical alternates, and discovered-but-not-indexed pages |
| [viral-launch](packages/marketing/viral-launch/SKILL.md) | Sets up a project repository and launch plan for shareable marketing, public launch readiness, and growth loops | Preparing a repo, product, open-source package, or creator tool for public launch |

### Music (1)

| Skill | What it does | Use when |
|-------|-------------|----------|
| [fill-music-player](packages/music/fill-music-player/SKILL.md) | Fills a portable music player with a curated random selection while balancing formats, artists, albums, and capacity | Copying music from a NAS or local library to a Walkman, iPod, USB drive, or similar device |

### Photography (1)

| Skill | What it does | Use when |
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
| Grok | `.grok-plugin/index.json` | Plugin index (plus `.claude-plugin/` compatibility) |
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
    ├── codex/
    ├── claude/
    ├── cursor/
    ├── grok/
    ├── windsurf/
    └── kiro/
```

Key design choices:

- Process over prose: skills are workflows agents follow, not generic reference essays.
- Progressive disclosure: `SKILL.md` is the entry point; supporting files load only when needed.
- Adapter separation: agent-specific wrappers wrap the canonical package instead of forking it.

See [docs/skill-anatomy.md](docs/skill-anatomy.md) for the package format.

## Project Structure

```text
agent-skills/
├── packages/
│   ├── software-development/   (19 skills)
│   ├── marketing/              (2 skills)
│   ├── music/                  (1 skill)
│   └── photography/            (1 skill)
├── catalog/
├── collections/
├── scripts/
├── .claude-plugin/
├── .cursor-plugin/
├── .github/prompts/
├── .windsurf/rules/
└── .kiro/steering/
```

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
