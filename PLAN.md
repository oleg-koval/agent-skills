# Fix Skillshare Skill Loading

## Summary
Root cause: the generated `adapters/cursor/skills/*/SKILL.md` wrappers start with the provenance HTML comment, so YAML frontmatter is no longer the first content in the file. Skillshare/Cursor treats that as missing frontmatter and skips the skills.

## Key Changes
- Update `scripts/build-adapters.sh` so generated `SKILL.md` wrappers keep YAML frontmatter at the top.
- Preserve the generated provenance comment, but move it below the frontmatter block for both `claude` and `cursor` wrappers.
- Regenerate the tracked adapter files under `packages/*/adapters/{cursor,claude}/skills/*/SKILL.md` so the repo matches the fixed generator.
- Add a validation check in `scripts/validate-catalog.sh` that asserts every `SKILL.md` starts with `---`, so this regression fails fast in CI.

## Test Plan
- Run `./scripts/build-adapters.sh`.
- Run `./scripts/validate-catalog.sh`.
- Spot-check a few generated cursor wrappers to confirm the first line is `---` and the provenance comment is no longer before frontmatter.
- Reopen Skillshare/Cursor once the updated files are installed to confirm the warnings disappear.

## Assumptions
- The canonical `packages/*/SKILL.md` files are already valid; the issue is only in generated wrapper files.
- Keeping the provenance comment is useful, so the fix will reposition it rather than removing it.
- No catalog metadata changes are needed; this is a formatting/generation bug only.
