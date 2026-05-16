# Fix Skillshare Skill Loading

### Task 1: Fix generated adapter frontmatter
Root cause: the generated `adapters/cursor/skills/*/SKILL.md` wrappers start with the provenance HTML comment, so YAML frontmatter is no longer the first content in the file. Skillshare/Cursor treats that as missing frontmatter and skips the skills.

Key changes:
- [x] Update `scripts/build-adapters.sh` so generated `SKILL.md` wrappers keep YAML frontmatter at the top.
- [x] Preserve the generated provenance comment, but move it below the frontmatter block for both `claude` and `cursor` wrappers.

### Task 2: Regenerate tracked adapters and add validation
Key changes:
- [x] Regenerate the tracked adapter files under `packages/*/adapters/{cursor,claude}/skills/*/SKILL.md` so the repo matches the fixed generator.
- [x] Add a validation check in `scripts/validate-catalog.sh` that asserts every `SKILL.md` starts with `---`, so this regression fails fast in CI.

### Task 3: Verify the fix
Test plan:
- [x] Run `./scripts/build-adapters.sh`.
- [x] Run `./scripts/validate-catalog.sh`.
- [x] Spot-check a few generated cursor wrappers to confirm the first line is `---` and the provenance comment is no longer before frontmatter.
- [x] Reopen Skillshare/Cursor once the updated files are installed to confirm the warnings disappear.

### Task 4: Confirm assumptions
- [ ] The canonical `packages/*/SKILL.md` files are already valid; the issue is only in generated wrapper files.
- [ ] Keeping the provenance comment is useful, so the fix will reposition it rather than removing it.
- [ ] No catalog metadata changes are needed; this is a formatting/generation bug only.
