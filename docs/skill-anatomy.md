# Skill Anatomy

This document describes the structure and format of skill packages in this repository. Use it when adding a new package, reviewing an existing skill, or updating generated adapters.

## File Location

Every skill lives in its own category directory under `packages/`:

```text
packages/
  category-name/
    skill-name/
      SKILL.md            # Required canonical skill definition
      references/         # Optional supporting material loaded on demand
      adapters/           # Optional agent-specific wrappers
        codex/
        claude/
        cursor/
```

Examples:

```text
packages/software-development/semantic-release-beta/SKILL.md
packages/music/fill-music-player/SKILL.md
packages/photography/gallery/SKILL.md
```

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

- `name`: lowercase, hyphen-separated, and matching the package directory name.
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

Adapters are wrappers for agent-specific packaging. They should point back to the canonical skill package and avoid duplicating business logic.

Current adapter targets:

- `adapters/codex/`
- `adapters/claude/`
- `adapters/cursor/`
- generated GitHub Copilot prompt files in `.github/prompts/`

Claude plugin and marketplace identifiers must be kebab-case. Keep `olko:*` names for Codex lookup names, but do not use colons or spaces in Claude marketplace/plugin names.

After changing a package name, description, category, path, tags, or adapter support, update `catalog/skills.json` and rebuild generated files:

```bash
./scripts/build-adapters.sh
./scripts/validate-catalog.sh
```

## Catalog Requirements

Each package must have a matching entry in `catalog/skills.json`:

```json
{
  "name": "skill-name",
  "lookupName": "olko:skill-name",
  "category": "software-development",
  "path": "packages/software-development/skill-name",
  "description": "Short catalog description.",
  "tags": ["tag"],
  "adapters": ["codex", "claude", "cursor", "copilot"]
}
```

Rules:

- `lookupName` uses the `olko:` prefix.
- `path` points at the canonical package directory, not an adapter.
- `description` should be shorter than the full frontmatter description.
- `adapters` must reflect generated or supported adapter targets.

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
See `packages/software-development/semantic-release-beta/SKILL.md` for beta release setup.
```

Do not copy another skill's workflow into a new package unless the behavior intentionally diverges.
