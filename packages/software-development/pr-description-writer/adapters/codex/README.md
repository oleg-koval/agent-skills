# Codex Adapter for pr-description-writer

This is a Codex-specific adapter for the `olko:pr-description-writer` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:pr-description-writer skill to draft a PR description for this branch.
```

## Workflow

See `../../SKILL.md` for the full workflow: gather branch context (commits since base,
diff summary), check for an existing PR template, draft a structured title and body, then
create or update the GitHub PR using `gh pr create` / `gh pr edit`. The procedure is
plain `git`/`gh` and is agent-agnostic.
