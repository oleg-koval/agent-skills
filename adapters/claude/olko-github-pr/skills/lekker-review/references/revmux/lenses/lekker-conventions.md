---
description: deviations from Teifi's own codebase conventions — the "strong teammate" non-blocking lens
---
## Lens: lekker-conventions

Review the change for deviations from Teifi's established codebase
conventions and idioms. This is the "strong teammate" lens: the suggestions a
senior Teifi engineer leaves — non-blocking, but they make the code match how
the rest of the codebase is written. Look beyond the diff only for
convention-specific precedent and reuse searches. Other lenses may inspect the
runtime context they need for their own cross-file checks.

Read `{{PROFILE}}` now, before forming any opinion — it carries the Teifi
conventions text. Its §1 (naming matrix), §2 (comment policy), §5 (commit
hygiene) and §6 (generated code) are yours — they are the house style, so a
deviation needs NO codebase precedent beyond that file (the file IS the
precedent; cite the section, e.g. "teifi-conventions §1 verbs").
Everything else in this lens still requires a cited precedent from the code.

Axes to cover:
- Naming (teifi-conventions §1): every symbol the diff INTRODUCES against the
  matrix — boolean without `is`/`has`, async I/O named `get`, a row lock or a
  throw-on-miss or a cache read absent from the name (`…ForUpdate`,
  `…OrThrow`, `…Cached`), a collidable component without its domain prefix, a
  bare generic noun (`line`, `node`, `row`) where the domain has two variants in
  scope. NEVER flag a boundary name (DB column, GraphQL/oRPC field, enum value,
  route string, wire key) — renaming it breaks callers outside the diff.
- Comments (teifi-conventions §2): one finding per over-commenting offender the
  diff ADDED, with the deletion as the fix. Never a vague "too many comments",
  never a pre-existing comment, never a lint/type pragma or a genuine
  non-obvious "why".
- Generated code (teifi-conventions §6): a changed `.sql` / `.graphql` /
  `.json` schema / `prisma/schema.prisma` whose generated artifact is absent
  from the diff (or the reverse) — major. Raise NO naming, comment, or
  complexity finding inside a `generated/` directory. A hand-rolled `fetch` to
  the Shopify Admin GraphQL endpoint instead of the genql client — major.
- Commits (teifi-conventions §5): non-conventional or vague commit subjects, and
  any Claude Code / assistant mention in the commit or PR text.
- Type-system idioms:
  * A hand-written interface/type that duplicates an existing Zod schema —
    should be `z.infer<typeof zSchema>` so the schema stays the single source
    of truth. (Grep for a matching z-schema in the same feature folder.)
  * Raw `string` used for a Shopify GID or an entity id where a branded
    `ID<'Customer'>` (or similar) type exists and is used elsewhere.
  * A union typed as `as readonly string[]` / a hand-rolled `is...` guard where
    a `z.enum([...])` + `z.infer` would give validation, narrowing, and the
    options array in one declaration.
  * An unnecessary `satisfies` / redundant type annotation the compiler already
    infers.
  * A GID validated/parsed inline where a shared helper exists (e.g.
    `zNamespacedGid`). Grep the shared libs and the repo before asserting.
- Reuse (search the worktree AND sibling Teifi repos before flagging):
  * Inline fetch/client logic that should reuse — or be promoted into — a
    shared client (e.g. a company-switcher client) that already exists or that
    the codebase clearly wants.
  * A util/helper that already exists elsewhere being re-implemented inline.
  * A symbol defined locally that is (or should be) exported from a shared
    module — "are we not exporting this somewhere?"
- Consistency:
  * Cache-key / composite-key separators that disagree with the repo's
    prevailing choice (e.g. `:` vs `::`). Grep existing key-building code to
    find the prevailing pattern, then flag the deviation.
  * Ad-hoc error throwing where the repo has an idiom (e.g. `throw new
    HttpError('...', 403)` instead of a bare string / generic Error).
  * Naming/casing that breaks the convention used by sibling files.

MANDATORY SWEEP — do this FIRST, before forming any opinion:

The axes above are symptom-driven: they only fire once you already suspect a
duplication. That is how a re-implemented helper slips through — nobody thinks to
look. So run these enumerations mechanically, whether or not anything looks wrong.

1. **Sibling sweep for every file the diff ADDS.** For each added file, list its
   directory and read the exports of its neighbours. A helper that solves the same
   problem is usually sitting in the same folder.

   ```bash
   REVIEW_CONFIG="{{CONTEXT}}/worktree.json"
   WORKTREE="$(jq -er '.worktreePath | select(type == "string" and length > 0)' "$REVIEW_CONFIG")"
   BASE_REV="$(jq -er '(.mergeBase // .baseRef) | select(type == "string" and length > 0)' "$REVIEW_CONFIG")"
   REPO_ROOT="$(jq -er '.repoRoot | select(type == "string" and length > 0)' "$REVIEW_CONFIG")"
   SIBLING_ROOT="$(dirname "$REPO_ROOT")"

   git -C "$WORKTREE" diff --name-status "$BASE_REV"...HEAD | awk '$1=="A"{print $2}' |
     while IFS= read -r added_file; do
       added_dir="$WORKTREE/$(dirname "$added_file")"
       ls -la "$added_dir"                         # what already lives beside it
       grep -rn "^export " "$added_dir"/*.ts "$added_dir"/*.tsx 2>/dev/null |
         grep -v -F -- "$added_file"
     done
   grep -rn "^export " "$SIBLING_ROOT" --include='*.ts' --include='*.tsx' \
     --exclude-dir=node_modules 2>/dev/null
   ```

   A new `foo/bar-thing.ts` next to an existing `foo/thing.ts` is a finding waiting
   to happen. Read the neighbour, do not just note its name.

2. **New-symbol sweep.** For every function/const the diff exports, search the repo
   for something that already does that job, by BEHAVIOUR not just by name. Names
   rarely match; behaviour does.

   ```bash
   git -C "$WORKTREE" diff --unified=0 "$BASE_REV"...HEAD | \
     grep '^+' | grep -E 'export (function|const) '             # collect new symbols
   # then for each, search by what it does, e.g. a locale normaliser:
   grep -rln "toLowerCase()\|normalize\|isoCode\|split('-')" "$WORKTREE" \
     --include='*.ts' --include='*.tsx'
   ```

   Pick 2 or 3 behavioural keywords from the new function's body and grep those.
   Reviewing the diff alone cannot catch this.

3. **State what you swept.** In your output, name the directories you listed and the
   behavioural greps you ran, even when they found nothing. A sweep that is not
   reported did not happen, and the next reviewer cannot tell "no duplication exists"
   from "nobody looked".

HARD RULES:
- Only raise a finding when the better pattern PROVABLY ALREADY EXISTS. Cite it:
  the file:line where the helper/type/convention lives, or the sibling file that
  does it the idiomatic way. If you cannot find a concrete precedent, DROP the
  finding — "this would be nicer as X" on taste alone is not allowed.
- Every finding must still trace to a `+` line in the diff (the deviation must
  be code this change added/changed). The supporting precedent may live outside the
  diff; the deviation may not.
- These are suggestions, not blockers. Do not inflate severity. Report each as
  `file:line — <deviation> (precedent: <file:line of the existing pattern>)`.
- ONE EXCEPTION to non-blocking: if the re-implementation DIVERGES in behaviour
  from the helper it duplicates, that is not a style nit, it is two spellings of
  the same value that disagree, and it belongs on lekker-quality's severity
  scale rather than this lens's. Diff the two implementations before deciding:
  same inputs, same outputs? If a real input produces different results, say so
  explicitly and give the input.

To find precedents, you may run:

```bash
grep -rn "<symbol or pattern>" "$WORKTREE" --include='*.ts' --include='*.tsx'
find "$SIBLING_ROOT" \( -name "*.ts" -o -name "*.tsx" \) ! -path "*/node_modules/*" \
  | xargs grep -l "<symbol>" 2>/dev/null | head
```

Always include *.tsx. Extension and frontend code lives in .tsx, so a search that
omits it silently reports "no precedent exists" for whole directories.

A mined record of what other bots (Greptile / Gemini / CodeRabbit) have
commented on in this repo may be present under `{{CONTEXT}}`. Use it as a prior,
not as a checklist: a high count means "frequently raised here", not "correct" —
never raise a finding because a bot once said it, only because it is true here.

Rules:
- Report file:line — description with a precedent citation. No positive
  observations. No taste-only suggestions.
- Quote the verbatim offending line(s) — never paraphrased, never reconstructed
  from memory — and give a concrete drop-in fix, or when the fix is
  architectural, a minimal skeleton plus one sentence on what else must change.
- A finding you cannot quote and cannot fix is a finding you have not proven —
  drop it instead.
