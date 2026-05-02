---
name: add-to-my-skills
description: Copy a newly created skill from another repo into this catalog, refresh the README and generated manifests, then commit and push the change. Use when the user wants to bring a skill they built elsewhere into this repository.
license: MIT
compatibility: Codex, Claude Code, Cursor, and other Agent Skills compatible tools. Requires a writable git repository and access to the source skill repo.
metadata:
  author: Oleg Koval
  tags:
    - skills
    - skillshare
    - catalog
    - git
    - commit
    - push
---

# Add to My Skills

Use this skill when a skill was created in another repository and needs to be copied into this catalog as a first-class package.

## Outcome

Bring the source skill into `packages/software-development/`, register it in the catalog, refresh generated docs and adapters, and publish the change with a git commit and push.

## When to Use

- The user created a new `SKILL.md` in another repo and wants it added here
- The user wants this catalog to become the canonical home for that skill
- The user wants the README, generated manifests, commit, and push handled in one pass

## Clarify Before Acting

If any of these are unclear, ask up to 3 questions in one batch before editing:

- Source repo or source skill path
- Final skill name if it should differ from the source
- Destination branch or remote if the push target is unclear

Default assumptions when not specified:

- Copy the source skill as a new canonical package in `packages/software-development/<skill-name>/`
- Keep the source skill name unless the user asks to rename it
- Use this repository as the destination
- Commit with a conventional commit message and push to the current branch's upstream

## Workflow

1. Inspect the source skill:
   - locate the source `SKILL.md`
   - copy any supporting `references/`, `scripts/`, or `assets/` files that the skill needs
   - note any repo-specific assumptions that need to be rewritten for this catalog
2. Choose the package location:
   - default to `packages/software-development/<skill-name>/`
   - ensure the package directory name matches the `name` frontmatter value
3. Create or update the canonical package:
   - write `SKILL.md` first
   - keep the frontmatter accurate and concise
   - make the workflow explicit, actionable, and self-contained
4. Register the package in the repository inventory:
   - add the package to `catalog/skills.json`
   - add it to the appropriate collection file if it belongs in a bundle
   - update `README.md` so the package list, counts, and usage examples stay current
5. Refresh generated outputs:
   - run `./scripts/build-adapters.sh`
   - run `./scripts/validate-catalog.sh`
6. Verify the new package actually exists:
   - confirm `packages/software-development/<skill-name>/SKILL.md`
   - confirm generated adapter files and prompt files were created
7. Commit and push:
   - inspect `git status`
   - commit the change with a conventional message
   - push to the current upstream branch

## Git Safety

- Never overwrite unrelated changes
- Never force push unless the user explicitly asks
- Never commit secrets copied from the source repo
- If the source skill is incomplete or ambiguous, stop and ask for clarification instead of guessing

## Verification

- `./scripts/build-adapters.sh` completes successfully
- `./scripts/validate-catalog.sh` passes
- `git status` shows only the intended package, catalog, README, and generated files
- `git push` succeeds to the expected remote
