# Skill Anatomy

This document describes the structure and format of skill packages in this repository. Use it when adding a new package, reviewing an existing skill, or updating generated adapters.

## File Location

Every skill lives under its plugin directory in `plugins/`:

```text
plugins/
  olko-{plugin}/
    .claude-plugin/plugin.json   # generated
    skills/
      skill-name/
        SKILL.md                # Required canonical skill definition
        references/             # Optional supporting material loaded on demand
```

Examples:

```text
plugins/olko-release/skills/semantic-release-beta/SKILL.md
plugins/olko-creative/skills/fill-music-player/SKILL.md
plugins/olko-creative/skills/gallery/SKILL.md
```

Generated adapters live outside the plugin directory, one tree per tool, at `adapters/{tool}/olko-{plugin}/skills/{skill}/`. Three tools are mandated to read their wrappers straight from repo-root paths rather than `adapters/`: `.windsurf/rules/{skill}.md`, `.kiro/steering/{skill}.md`, and `.github/prompts/{skill}.prompt.md`.

## SKILL.md Format

### Frontmatter

Every `SKILL.md` starts with YAML frontmatter:

```yaml
---
name: skill-name-with-hyphens
description: Brief statement of what the skill does. Use when specific trigger conditions apply.
license: MIT
compatibility: Codex, Claude Code, Cursor, GitHub Copilot, and other Agent Skills compatible tools.
metadata:
  author: Oleg Koval
  tags:
    - tag-name
---
```

Rules:

- `name`: lowercase, hyphen-separated, and matching the skill directory name.
- `description`: concise activation guidance; include what the skill does and when to use it.
- `license`: include when the source package carries an explicit license.
- `compatibility`: state supported agent/tool assumptions and any required local tooling.
- `metadata.tags`: keep tags practical for catalog discovery.

The frontmatter feeds generated manifests and adapter files, so keep it accurate and avoid long process summaries.

## Standard Sections

Use sections that make the skill executable by an agent. Exact headings can vary by workflow, but strong skills usually include:

```markdown
# Skill Title

## Overview
One or two sentences explaining the outcome the skill produces.

## When to Use
- Concrete trigger phrases or task types
- Exclusions when the skill should not run

## Workflow
Numbered steps the agent should follow.

## Commands
Exact commands, flags, or file paths when relevant.

## Verification
- [ ] Evidence that proves the work completed successfully
- [ ] Tests, build output, generated files, or manual checks to report
```

## Section Purposes

### Overview

State the skill's job and expected outcome. Keep this short enough that the workflow remains the source of truth.

### When to Use

List concrete triggers. Good triggers are user phrases, repository conditions, or task types. Avoid vague statements such as "use for better quality."

### Workflow

The workflow is the core of the skill. It should be specific enough for an agent to execute without inventing missing steps.

Good:

```text
Run `./scripts/validate-catalog.sh` after changing catalog paths.
```

Bad:

```text
Make sure the catalog is good.
```

### Commands

Include exact commands when a tool is part of the workflow. Prefer existing repo scripts over one-off shell fragments.

### Verification

Verification is the exit criteria. Every item should be evidence-backed: test output, command output, generated files, screenshots, or a documented manual check.

## Supporting Files

Create supporting files only when they reduce the main `SKILL.md` size or keep specialized detail out of the primary workflow.

Use `references/` for:

- long checklists
- example templates
- provider-specific notes
- detailed command references

Keep short operational guidance in `SKILL.md` so the skill remains self-contained.

## Adapters

Adapters are wrappers for agent-specific packaging. They should point back to the canonical skill under `plugins/` and avoid duplicating business logic.

Current adapter targets:

| Adapter | Generated files | Root output |
|---------|----------------|-------------|
| `codex` | `adapters/codex/README.md` (static stub) | n/a |
| `claude` | `adapters/claude/olko-{plugin}/plugin.json` + `adapters/claude/olko-{plugin}/skills/{name}/SKILL.md` | `.claude-plugin/` |
| `cursor` | `adapters/cursor/olko-{plugin}/plugin.json` + `adapters/cursor/olko-{plugin}/skills/{name}/SKILL.md` | `.cursor-plugin/index.json` |
| `grok` | `adapters/grok/olko-{plugin}/...` | `.grok-plugin/index.json` |
| `pi` | `adapters/pi/olko-{plugin}/...` | n/a |
| `hermes` | `adapters/hermes/olko-{plugin}/...` | n/a |
| `copilot` | n/a | `.github/prompts/{name}.prompt.md` |
| `windsurf` | n/a | `.windsurf/rules/{name}.md` |
| `kiro` | n/a | `.kiro/steering/{name}.md` |

Adapter coverage is not uniform across the catalog; a skill only ships the adapters listed in its `adapters` array in `catalog/skills.json`. As of this writing: claude 49, grok 47, cursor 45, copilot 45, codex 42, windsurf 35, kiro 35, pi 2, hermes 2 (out of 49 canonical skills).

Claude plugin and marketplace identifiers must be kebab-case. Keep `olko:*` names for Codex and Cursor lookup names, but do not use colons or spaces in Claude marketplace/plugin names.

After changing a skill's name, description, plugin assignment, path, tags, or adapter support, update `catalog/skills.json` and rebuild generated files:

```bash
./scripts/build-adapters.sh
./scripts/validate-catalog.sh
```

## Catalog Requirements

`catalog/skills.json` groups skills by plugin. Each skill must have a matching entry nested under its plugin's `skills` array:

```json
{
  "name": "olko-agent-skills",
  "plugins": [
    {
      "name": "olko-release",
      "description": "Ship a release: semantic-release setup, changelogs, store listing copy, release-day routine.",
      "skills": [
        {
          "name": "skill-name",
          "lookupName": "olko:skill-name",
          "path": "plugins/olko-release/skills/skill-name",
          "description": "Short catalog description.",
          "tags": ["tag"],
          "adapters": ["codex", "claude", "cursor", "copilot"]
        }
      ]
    }
  ]
}
```

Rules:

- `lookupName` uses the `olko:` prefix.
- `path` points at the canonical skill directory under `plugins/`, not an adapter.
- `description` should be shorter than the full frontmatter description.
- `adapters` must reflect generated or supported adapter targets.
- A skill's plugin assignment (which plugin's `skills` array it lives in) comes from `PLUGIN_ASSIGNMENT` in `scripts/lib/catalog.mjs`.

## Writing Principles

1. Process over knowledge. Skills are workflows, not essays.
2. Specific over general. Name commands, paths, files, and evidence.
3. Evidence over assumption. Verification should require proof.
4. Canonical package first. Update `SKILL.md` before generated adapters.
5. Progressive disclosure. Move long detail into `references/` only when needed.
6. Minimal scope. Add only the sections that change agent behavior.

## Cross-Skill References

Reference other skills by lookup name or package path instead of duplicating content:

```markdown
Use `olko:git-commit` when the user asks to commit the resulting changes.
See `plugins/olko-release/skills/semantic-release-beta/SKILL.md` for beta release setup.
```

Do not copy another skill's workflow into a new skill unless the behavior intentionally diverges.
