# Ukrainian Wikipedia newcomer task types

Verified against the live `uk.wikipedia.org` API, 2026-08-20.

`MediaWiki:NewcomerTasks.json` is the authoritative GrowthExperiments "Suggested edits"
(Пропоновані редагування) task-type → maintenance-template map on ukwiki. The table below is
that map.

## Task-type mapping

| ukwiki UI label | Tier | task type | Backing template(s) |
|---|---|---|---|
| Вичитувати | Легкі / easy | `copyedit` | `Шаблон:Мовні помилки` |
| (not offered in UI — structured) | easy | `link-recommendation` | none |
| (not offered in that UI list) | easy | `links` | `Шаблон:Упорядкувати`, `Шаблон:Брак посилань` |
| Шукати зовнішні посилання | Середні / medium | `references` | `Шаблон:Без джерел` |
| Оновлювати статті | Середні / medium | `update` | `Шаблон:Оновити` |
| (not offered — structured) | medium | `image-recommendation`, `section-image-recommendation` | none |
| Розширювати короткі статті | Важкі / hard | `expand` | `Шаблон:Доробити` |

All six templates confirmed EXISTS. `Шаблон:Доробити` is a REDIRECT to `Шаблон:Заготовка`
(see `references/wikitext-uk.md`).

## Scope contract per task type

An assigned task type is a **ceiling**, not a suggestion — overreach on a young account is what
draws patrollers (see `references/strategy.md` Phase 1). Stay inside the type you picked.

### `copyedit` — Вичитувати

- IS: language, grammar, punctuation, typography fixes only.
- NOT: no new facts, no new refs, no restructuring, no adding/removing/reordering sections.
- Remove `{{Мовні помилки}}` in the same edit only if the whole article was actually proofread.
- Edit summary shape: `Вичитка: виправлено [конкретні помилки]`.

### `links` — Упорядкувати / Брак посилань

- IS: wikilinks and formatting only.
- NOT: no prose rewriting.
- Edit summary shape: `Впорядкування посилань: [що додано/виправлено]`.

### `references` — Шукати зовнішні посилання

- IS: add inline `<ref>` to claims that are **already there**.
- NOT: never rewrite a claim to fit a source you happened to find. If no source supports it as
  written, report it — do not reshape it.
- Remove `{{Без джерел}}` only when every substantive claim is cited.
- Edit summary shape: `Додано джерела: [що саме підтверджено]`.

### `update` — Оновлювати статті

- IS: replace outdated values/dates/status with sourced current ones, plus the minimum prose the
  change forces.
- NOT: no scope expansion, no new sections.
- Every updated number needs a source actually fetched this session — this is the highest
  fabrication-risk type in the set and SKILL.md Hard Rule 2 applies with no exceptions.
- Edit summary shape: `Оновлено дані: [що змінено] за станом на [дата]`.

### `expand` — Розширювати короткі статті

- IS: the **only** type permitted to add sections and substantial new sourced prose. Routes into
  the existing **Expand** mode in SKILL.md.
- `{{Заготовка}}` comes off only when the article genuinely stops being a stub.
- Edit summary shape: `Розширено статтю: додано [розділи/теми], джерела`.

## Out of scope: structured task types

`link-recommendation`, `image-recommendation`, and `section-image-recommendation` are served
through the Growth UI's own accept/reject widget on ukwiki, not by pasting wikitext. This skill
does not improvise a manual equivalent for them — say so plainly and decline rather than draft
around it.

## Finding candidates

`action=query&list=growthtasks` requires login, so this read-only skill cannot use it. Find
candidate articles for a task type instead with:

```sh
./scripts/wiki.sh tasks <type> [n]
```
