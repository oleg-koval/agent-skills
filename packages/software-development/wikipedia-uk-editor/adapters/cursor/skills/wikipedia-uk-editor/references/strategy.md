# Ukrainian Wikipedia contribution strategy

Baseline (fetched 2026-07-27 from the ukwiki API): **1 429 237 articles**, 48.4M edits, ~4 764 active users, 44 admins. Small active community, huge unmaintained surface. That ratio is the whole opportunity — and the whole risk. With 4 764 active editors, a new high-volume account is *visible*, and a handful of patrollers will look at it.

## The core principle

Edit count is the wrong target. **Standing** is the target — once you are autoconfirmed and trusted, nothing you do gets reverted, and throughput goes up permanently. Volume without standing produces reverts, warnings, and eventually a block, which zeroes everything.

So: earn permissions first, then scale.

## Phase 0 — account setup (day 1, one hour)

1. Register; enable email.
2. Write a real `Користувач:Ім'я` page: who you are, your subject areas (photography, software/AI, wearables, Ukrainian tech), your languages. A blank user page on a high-volume new account reads as a bot.
3. **Disclose AI assistance explicitly on that page.** One honest sentence — you draft with an AI assistant and verify every source yourself before saving. This converts the single biggest liability into a non-issue. Undisclosed and later noticed is much worse than declared upfront.
4. Read (skim, then keep open): ВП:ЗН, ВП:АД, ВП:НТЗ, ВП:ОД, ВП:Авторські права.
5. Do your first five edits in `Вікіпедія:Пісочниця` and on your own `Користувач:Ім'я/Чернетка`, not in article space.

## Phase 1 — autoconfirmed (days 1–5)

Ukrainian Wikipedia grants *автопідтверджений* status after an account is a few days old with a modest number of edits. Until then, some actions are restricted and everything you do is patrolled hard.

Do **only low-risk edits** in this window. Nothing that can be reverted:

- fix an actual typo, a broken link, a wrong date you can source
- add a missing `{{Reflist}}`, fix a malformed `<ref>`
- add one genuinely good source to an article carrying `{{Без джерел}}`
- add a missing category that already exists

Rules for this phase: one change per edit, always an edit summary in Ukrainian, never a cosmetic-only mass edit (those get flagged as edit-count padding immediately).

Target: ~30–50 edits, **zero reverts**. A revert in this phase costs more than 50 edits gain.

### Newcomer tasks as a ready-made Phase 1 queue

Ukrainian Wikipedia's own GrowthExperiments "Suggested edits" (Пропоновані редагування) tiers a
maintenance backlog into Легкі / Середні / Важкі — see `references/newcomer-tasks.md` for the
full mapping and per-type scope contract. Легкі (`copyedit`) and Середні (`references`, `update`)
are lower-risk, community-endorsed work for this phase, but they are not zero-revert-risk:
sourcing and fabrication risks still require verification. Pick candidates
with `./scripts/wiki.sh tasks <type>` and stay strictly inside the assigned scope. Важкі
(`expand`) is not Phase 1 work — it belongs in Phase 2 stream A/B, once autoconfirmed.

## Phase 2 — the volume engine (weeks 2–8)

Four streams, run in parallel, roughly in this priority order. Value per unit of effort, highest first:

### A. Translation en→uk — highest value

The single best use of an LLM assistant. English Wikipedia has mature, well-sourced articles on tens of thousands of topics that ukwiki lacks entirely. A translated article is a large, defensible, high-visibility contribution.

- Pick from **your own domains first** — you can judge the sources, and domain knowledge is what makes translations survive.
- Prefer en articles that are already well-referenced (B-class or better). A poorly sourced English article translates into a poorly sourced Ukrainian one, which gets tagged.
- **Verify the sources yourself.** Do not carry over English refs blind — dead links and misattributed claims transfer with them.
- Always add `{{Перекладена стаття}}` with the source revision id. Omitting it is a licence violation and an easy revert reason.
- Prefer topics with existing Ukrainian-language coverage available for extra sourcing.

Realistic rate: 1–2 solid articles per evening. Each is worth more than 100 gnome edits.

### B. Sourcing existing uk articles — best trust-building

`Категорія:Статті без джерел` has 181 subcategories by year/month. `Категорія:Незавершені статті` has ~4 450 pages. This is a bottomless, uncontested backlog, and fixing it is unambiguously welcomed.

Workflow: pick an article you can actually source, find 2–4 real sources, add inline refs to specific claims, remove the `{{Без джерел}}` banner in the same edit, summary explains what you sourced. That last step — removing the banner you earned the right to remove — is what patrollers notice positively.

### C. New articles in your domains — highest risk, highest reward

Photography, software/AI, Garmin/wearables, Ukrainian tech people and companies.

The failure mode here is **ВП:ЗН**. Ukrainian Wikipedia deletes non-notable company and person articles routinely. Before drafting: does the subject have significant coverage in multiple independent reliable sources? If the only sources are the company's own site, press releases, and funding-round announcements, the answer is no — do not draft it. Especially avoid anything you have a conflict of interest with; if you do write it, declare the COI on the talk page.

Draft in `Користувач:Ім'я/Чернетка` first for anything borderline.

### D. Gnoming and backlogs — filler, not a strategy

Typos, dead links, orphan articles, wikification. Fine as background work between the above. Do **not** make this the bulk of the account — a contribution history that is 90% minor edits is the pattern that gets an account labelled as padding. Keep it under roughly a third of your edits.

## Phase 3 — compounding (month 3+)

- Aim for *автопатрульований* status — your edits stop needing review, which removes friction permanently.
- Participate in a `Вікіпедія:Кнайпа` discussion or a thematic week. Social standing converts directly into edits that stick.
- Move up quality tiers: take one of your translations to "добра стаття" standard. One good article outweighs a thousand typo fixes in community standing.

## Ranked target selection

When choosing what to edit next, score candidates on:

1. **Do I have sources?** No sources reachable → skip, regardless of how appealing the topic is.
2. **Does it already exist in uk?** Check before translating. Duplicate articles get merged and the work is lost.
3. **Notability defensible under ВП:ЗН?** If shaky, it is a section in an existing article, not a new article.
4. **Is it in my domain?** Domain knowledge is the difference between a translation that survives and one that gets tagged.
5. **Size of the gap.** A one-line uk stub of a rich en article is the highest-leverage target of all: high value, zero notability risk (the article already exists and was accepted).

Point 5 is the sweet spot and is systematically underused. Expanding accepted stubs = translation-scale value with sourcing-stream risk.

## Hard limits — do not cross

- No automated saving without ВП:БОТ approval.
- No mass cosmetic edits.
- No undisclosed AI content.
- No unsourced biographical claims about living people — that is where blocks come fastest.
- Never edit-war. If reverted once, take it to the talk page. Always.
- If an edit is challenged: engage in Ukrainian, politely, with sources. One good talk-page resolution builds more standing than a week of edits.

## What "good week" looks like at steady state

2 translated or substantially expanded articles, 10–15 sourcing edits clearing maintenance banners, some gnoming, zero reverts, one talk-page interaction. That is sustainable, unflaggable, and compounds.
