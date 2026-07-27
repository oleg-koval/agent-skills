# Codex Adapter for wikipedia-uk-editor

This is a Codex-specific adapter for the `olko:wikipedia-uk-editor` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:wikipedia-uk-editor skill to draft a Ukrainian Wikipedia edit for <URL or title>.
```

## Workflow

See `../../SKILL.md` for the full workflow: classify the task (translate / expand / source /
cleanup / plan), read the live wikitext through the read-only `scripts/wiki.sh` MediaWiki helper,
gather and verify real sources, draft policy-compliant wikitext using the verified templates in
`references/wikitext-uk.md`, run the self-check, and hand back ready-to-paste wikitext with a
Ukrainian edit summary. The skill never saves an edit — the human pastes it.
