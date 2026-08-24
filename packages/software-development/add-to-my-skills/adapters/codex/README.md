# Codex Adapter for add-to-my-skills

This is the Codex-specific adapter for the `olko:add-to-my-skills` skill. The canonical workflow is in
`../../SKILL.md`.

## Usage

Invoke it when a skill from another repository or a catalog page should become a first-class package:

```text
Use the olko:add-to-my-skills skill to bring this skill into the catalog, generate all adapters, validate it, and publish the change.
```

For Codex, resolve a supplied `skills.olegkoval.com/skills/<name>/` URL to its canonical GitHub or local
source before copying. Preserve unrelated dirty work, prefer an isolated worktree, update the canonical
`SKILL.md` before generated adapters, run `npm run build` and `npm test`, and report commit/push/PR state
separately from local validation.
