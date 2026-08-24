# Restructure agent-skills to the cc-thingz shape

Date: 2026-08-24
Status: approved design, not yet implemented
Reference: https://github.com/umputun/cc-thingz

## Goal

Reorganize `oleg-koval/agent-skills` to match the structure and tooling of
`umputun/cc-thingz`, while keeping the multi-agent distribution that cc-thingz
does not have. Skills must remain available to Codex, Cursor, Windsurf, Kiro and
Grok, not only Claude Code.

Approach chosen: full layout mirror, with catalog-driven generation retained on
top. Breaking changes to plugin and invocation names are accepted; a one-time
reinstall follows.

## Why

Today the repo is one monolithic plugin holding 48 skills under
`packages/{category}/`, where 42 of the 48 sit in a single `software-development`
category. Grouping is lopsided and maps to nothing installable.

The catalog has a genuine integrity defect: `catalog/skills.json` holds 49
entries for 48 unique skills, because `pr-finalize-complete` is registered
twice. Nothing in the current tooling detects a duplicate registration.

Adapters are generated per skill: 48 skills times 7 targets, where the `cursor`,
`claude` and `grok` adapters each hold a full duplicate copy of `SKILL.md`
alongside a near-identical `plugin.json`. Several hundred generated files do the
work of a few dozen.

cc-thingz solves the grouping problem with several small, self-contained,
independently installable plugins, and has validation tooling this repo lacks
(frontmatter validator with embedded self-tests, shellcheck, bash test suite).

## Section 1 - Plugin decomposition

Eleven plugins, 48 skills - the full catalog, every skill placed. Plugin names
carry the `olko-` prefix, so typing `olko` lists all of them. Skill `name:`
frontmatter stays unprefixed because the plugin already supplies the namespace.

| Plugin | Skills |
|---|---|
| `olko-github-pr` | pr-finalize, pr-finalize-complete, pr-to-green, pr-description-writer, qodoloop, coderabbitloop, codexloop, geminiloop, ci-fix-loop, dependabot-triage, lekker-review |
| `olko-git-tools` | git-commit, gh-cli, branch-cleanup |
| `olko-release` | semantic-release-beta, open-source-publisher, release-day, changelog-generator, store-listing-copy |
| `olko-product` | product-builder, mvp-oneshot, starter-rules, viral-launch |
| `olko-skill-meta` | add-to-my-skills, skill-budget-audit, promptctl, ai-tools-setup, relay, shared-knowledge-artifact |
| `olko-reflection` | self-critique, review-past-performance, retro-analysis, crash-course, wrap-up |
| `olko-obsidian` | obsidian-pr-sync, obsidian-task-rollover, morning-routine |
| `olko-apple-kit` | apple-store-submit, macos-menubar-app |
| `olko-garmin-kit` | garmin-watchface |
| `olko-creative` | gallery, fill-music-player, vinted-listing, wikipedia-uk-editor |
| `olko-web-ops` | cloudflare-block-countries, search-console-indexing-audit, docs-index-keeper, website-analytics-bootstrap |

Placement notes:

- `changelog-generator` sits in `olko-release`, not `olko-git-tools`: its output
  is release notes and it is the direct upstream of `store-listing-copy`.
- `store-listing-copy` sits in `olko-release` rather than either platform kit. It
  takes a platform flag (`ios` / `android` / `garmin` / `all`), turns a changelog
  into listing text, and submits nothing. Both kits consume its output; neither
  owns it.
- `olko-garmin-kit` holding a single skill is intentional and matches cc-thingz,
  where `release-tools` and `skill-eval` hold 2 and 0 skills.
- No Android or Google Play kit: there are no Play-specific skills to put in one.

Invocation changes from `olko-agent-skills:git-commit` to
`olko-git-tools:git-commit`.

## Section 2 - Directory layout

```
agent-skills/
  .claude-plugin/marketplace.json      GENERATED - 11 plugin entries
  .github/
    scripts/check-frontmatter.mjs      validator, supports --test
    workflows/{ci.yml, ci-release.yml, automerge.yml, prevent-unknown-contributors.yml}
  .windsurf/rules/*.md                 GENERATED - tool-mandated root path
  .kiro/steering/*.md                  GENERATED - tool-mandated root path
  .github/prompts/*.prompt.md          GENERATED - Copilot, tool-mandated root path
  CLAUDE.md, README.md, CHANGELOG.md, LICENSE
  catalog/skills.json                  SOURCE OF TRUTH
  docs/
    skill-anatomy.md
    backlog/*.md                       one file per known defect or idea
    plans/completed/*.md
    superpowers/specs/*.md
  plugins/
    olko-github-pr/
      .claude-plugin/plugin.json       GENERATED
      skills/<skill>/SKILL.md          CANONICAL, the only copy
      agents/*.md                      optional
      commands/*.md                    optional
      hooks/hooks.json                 optional
      references/*.md                  optional
      scripts/*.sh                     optional
    ... 10 more
  adapters/                            GENERATED, per plugin not per skill
    cursor/<plugin>/...
    grok/<plugin>/...
    claude/<plugin>/...
    codex/...
  scripts/{build-adapters, validate, install-codex-symlinks, sync-from-sources}
  tests/test-*.sh
  package.json, release.config.cjs
```

Decisions:

1. **Adapters are per plugin, not per skill**, and move out of the skill
   directories into a root `adapters/` tree keyed by target then plugin. This
   removes the duplicated `SKILL.md` copies; the file under
   `plugins/*/skills/*/SKILL.md` is the single source.

2. **Three adapter targets stay at repo root.** Windsurf discovers rules only
   at `.windsurf/rules/`, Kiro only at `.kiro/steering/`, and Copilot only at
   `.github/prompts/*.prompt.md`. Those three are generated in place. `cursor`,
   `grok`, `claude` and `codex` are distribution manifests rather than
   tool-discovered paths, so they live under `adapters/`. All seven targets are
   generated from the catalog and covered by the diff-clean gate.

3. **`catalog/skills.json` gains a plugin layer.** Flat `packages[]` with a
   `category` field becomes `plugins[]` with nested skills plus plugin metadata.
   One file then generates all eleven `plugin.json`s, `marketplace.json` and every
   adapter target. Nothing is hand-authored, which is what removes the drift.

4. **CI asserts generation is clean**: run the generator, then
   `git diff --exit-code`. A stale generated file fails the build. This makes
   drift structurally impossible rather than merely currently-fixed.

5. **Generated adapters stay committed**, not gitignored, because npm consumers
   and plain clones need the files present with no build step. The cost is
   generated files appearing in diffs. cc-thingz avoids this by generating
   nothing at all, which is not available here.

6. **Codex keeps its flat `olko:<skill>` symlink scheme.** Codex has no plugin
   concept, so adding one there would create churn with no benefit, and existing
   symlinks keep working.

## Section 3 - Tooling

cc-thingz runs its whole toolchain as one CI job. That shape is kept, ported to
Node because this repo is Node >= 22 with no Python dependency and adding a
Python runtime solely for a validator would be a regression.

**`.github/scripts/check-frontmatter.mjs`** - walks every `.md`, parses YAML
frontmatter, fails on malformed YAML. Covers the same edge cases cc-thingz
unit-tests: `---` at EOF with no trailing newline, tab-indented YAML, and body
text containing `---` that is not frontmatter. `--test` runs its own assertions
inside the script, no test framework, following cc-thingz's pattern.

**Schema validation beyond cc-thingz.** cc-thingz only checks that YAML parses.
This repo also needs field-level checks because the fan-out depends on them:

- `name` matches the containing directory name
- `description` present and non-empty
- `allowed-tools` names only real tools
- `metadata.targets` values are known adapter names
- every skill on disk appears in the catalog, and every catalog entry exists on
  disk

A duplicate-`name` check belongs here too: it is what would have caught the
double registration of `pr-finalize-complete`, which the README badge then
propagated as a wrong public skill count (49 instead of 48).

**`shellcheck`** over every `.sh`, including new `plugins/*/scripts/`.

**`tests/test-*.sh`** - bash tests per cc-thingz convention: the generator
produces the expected tree, regeneration is idempotent, the codex symlink
installer is safe to re-run, catalog and disk agree.

**Generation gate** - `build-adapters` followed by `git diff --exit-code`.

**CI split:**

- `ci.yml` on all pushes and PRs: frontmatter, schema, shellcheck, bash tests,
  generation-clean. Fast, needs no secrets.
- `ci-release.yml` on main and beta only: the existing semantic-release pipeline,
  unchanged, gated on `ci.yml`.

`automerge.yml` and `prevent-unknown-contributors.yml` are unchanged.

**npm scripts:** `build` (adapters), `test` (validators plus bash tests),
`validate` (schema only, for the fast local loop), and the existing
`semantic-release` and `release:dry-run`.

Deliberately not ported: cc-thingz's grep lint banning legacy `hg` subcommands.
It is specific to their Mercurial compatibility concern and has no analogue here.

## Section 4 - Repo-specific parts with no cc-thingz equivalent

- **`collections/` is deleted.** Its ten category bundles group skills for
  discovery, which the eleven plugins now do better because a plugin is
  installable and a collection is not. Keeping both means two grouping systems to
  synchronize. Category names that do not survive as plugins are already captured
  by skill `tags`.

- **`completed/PLAN.md` moves to `docs/plans/completed/`**, adopting the
  cc-thingz convention; the stray file becomes the first entry in a real
  directory.

- **`docs/backlog/*.md` is adopted.** One file per known defect or idea, named
  for the symptom. A greppable, PR-reviewable tracker beside the code. The repo
  currently has nowhere for "this is known broken" to land, which is part of why
  the manifest drift went unnoticed. Seed entries from this session: the
  `targets: [_source-only]` question on `store-listing-copy`, the stale README
  badge count, and the hardcoded Obsidian vault paths.

- **`sync-from-sources.sh` is retargeted**, not removed. It pulls skill content
  from external repos and must now write to
  `plugins/<plugin>/skills/<skill>/`, which means a synced skill's catalog entry
  must record its plugin. This script and `add-to-my-skills` are how skills
  arrive in the repo, so both need updating or new skills land in the wrong place.

- **`.skillignore` is deleted.** It is currently zero bytes. If an ignore
  mechanism is needed later it should be added with contents.

- **`CLAUDE.md` is added.** cc-thingz has one and this repo does not. The
  non-obvious rules now need stating: the catalog is the source of truth,
  generated files are never hand-edited, adapters are per plugin, new skills go
  through the catalog. Without it the next session hand-edits a `plugin.json` and
  CI rejects it.

- **`userConfig` per plugin**, cc-thingz's typed settings block
  (title/type/description/default), added only where a real knob exists rather
  than to every plugin. Genuine cases: `olko-obsidian` needs the vault path,
  currently hardcoded to `/Users/oleg.koval/obsidian/...` inside the skills, which
  makes them unusable by anyone else; `olko-github-pr` could expose a default base
  branch.

## Section 5 - Migration

Sequenced so the repo is never in a state where the tooling cannot report what is
broken. All work happens on a branch.

**Step 0 - baseline receipt.** Record the `sha256` of every canonical `SKILL.md`
and the full file inventory. This is the evidence that the move relocated content
without altering it. Committed before any move.

**Step 1 - fix the catalog integrity defect.** Remove the duplicate
`pr-finalize-complete` entry so the catalog holds 48 entries for 48 skills, and
confirm disk, catalog and `plugin.json` all agree at 48 before anything moves.
The move is catalog-driven, so a wrong catalog produces a wrong tree.

**Step 2 - restructure the catalog.** Rewrite `catalog/skills.json` to
`plugins[]` with nested skills, plugin metadata and `userConfig`. Nothing moves
yet; this is the map.

**Step 3 - move files with `git mv`.** `packages/{category}/{skill}/` becomes
`plugins/olko-{plugin}/skills/{skill}/`, deleting per-skill `adapters/` trees as
it goes. `git mv` preserves per-skill history, which copy-and-delete would lose.

**Step 4 - rewrite the generator.** `build-adapters.sh` becomes plugin-aware:
eleven `plugin.json`s, `marketplace.json`, the four `adapters/*` targets and the
two root-path targets. Retarget `sync-from-sources.sh` and `add-to-my-skills`.

**Step 5 - validators, tests, CI, docs.** Everything in Section 3, plus
`CLAUDE.md`, seeded `docs/backlog/`, deletion of `collections/` and
`.skillignore`, relocation of `completed/PLAN.md`.

**Step 6 - reinstall and confirm live.** Remove the old `olko-agent-skills`
plugin, add the eleven, and invoke a skill from more than one plugin.

## Verification gates

1. Skill count on disk equals 48 equals unique catalog count equals the sum
   across the eleven `plugin.json`s. One number, four sources, and the catalog
   must contain no duplicate `name`.
2. Every canonical `SKILL.md` hash matches the Step 0 baseline.
3. `npm run build && git diff --exit-code` clean twice consecutively, proving
   idempotent generation.
4. Frontmatter and schema validators pass repo-wide, shellcheck clean,
   `tests/*.sh` green.
5. `git log --follow` on a moved skill still shows pre-migration history.
6. At least one skill actually invoked from a freshly installed plugin. Not "the
   manifest looks correct" - a real invocation.
7. Codex symlinks resolve to real files after `install-codex-symlinks.sh`.

Gate 6 matters most: every other gate can pass on a repo that Claude Code
silently refuses to load.

## Risks

- The eleven-way `git mv` is the irreversible step. It runs on a branch with the
  Step 0 baseline already committed.
- The `olko-obsidian` skills have a home directory hardcoded in them. Moving them
  is safe, but they stay unusable by anyone else until `userConfig` is wired
  through. Tracked as a `docs/backlog/` entry, not in-scope work here.
- Invocation names change for every skill. Any personal automation, cron routine
  or saved prompt referencing `olko-agent-skills:<skill>` breaks and needs
  updating after Step 6.

## Out of scope

- Wiring `userConfig` values through the Obsidian skills' internals.
- Adding agents, commands or hooks to any plugin. The directories are provided by
  the layout; populating them is separate work.
- Any change to skill content. This restructure moves and validates skills; it
  does not edit them.
