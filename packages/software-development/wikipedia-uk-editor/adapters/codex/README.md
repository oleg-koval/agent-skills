# Codex Adapter for wikipedia-uk-editor

Codex resolves this skill today via a symlink:

```
~/.codex/skills/olko:wikipedia-uk-editor -> .../agent-skills/packages/software-development/wikipedia-uk-editor
```

`SKILL.md`, `references/`, and `scripts/` are all reachable through that symlink. Because it's a
symlink and not a copy, any edit made to this package (this file included) reaches Codex
immediately — no reinstall, no rebuild step.

The canonical skill definition is `../../SKILL.md`.

## Requirements

`curl` and `python3` — `scripts/wiki.sh` (the read-only MediaWiki API helper) shells out to both.
See the `compatibility:` field in `../../SKILL.md`.

## Invocation

```text
Use the olko:wikipedia-uk-editor skill to draft a Ukrainian Wikipedia edit for <URL or title>.
```

```text
Use the olko:wikipedia-uk-editor skill: Легкі → Вичитувати on "<title>"
```

## Modes

Classified from the input in `../../SKILL.md` §1:

- **Translate** — en.wikipedia.org URL with no uk equivalent
- **Expand** — uk stub or thin article
- **Source** — uk article carrying `{{Без джерел}}` / `{{Джерело}}`
- **Cleanup** — uk article with prose/format problems
- **Plan** — "what should I edit next" → reads `references/strategy.md`

Newcomer task types (`copyedit`, `links`, `references`, `update`, `expand`) route into these same
modes but under a tighter, type-specific scope ceiling — see `references/newcomer-tasks.md` for
the full mapping and what each type must not touch.

## Workflow

Resolve the title, read the live wikitext through `scripts/wiki.sh` (read-only), gather and
verify real sources, draft policy-compliant wikitext using the verified templates in
`references/wikitext-uk.md`, run the self-check in `../../SKILL.md` §5, and hand back
ready-to-paste wikitext with a Ukrainian edit summary. The skill never saves an edit — the human
pastes it.
