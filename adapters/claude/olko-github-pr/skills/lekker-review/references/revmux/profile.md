# Project profile

This file is handed to revmux as `{{PROFILE}}` for the lekker-medium and
lekker-deep review profiles. It ships with generic default conventions only.
Put your team's own hard rules (always Critical) in `references/house-rules.md`
and, if you use revmux, add them to the top of this file as well, each with an
ID such as `TS-1` so findings can cite it. Where this file disagrees with a
reviewer's general taste, this file wins.

---

# Default conventions (styling, naming, comments, tests, hygiene)

These are default house-style conventions. A review that misses them lets the
same nits come back from the human reviewer.

Severity ceiling: everything here is **idiomatic** unless a row says otherwise.
Cite a precedent from the codebase where the row asks for one, and never
inflate a style deviation into Critical.

---

## 1. Naming matrix

Flag a name the diff INTRODUCES that breaks a row. Renaming is cheap in the
diff, expensive later - but a rename is still a cost, so leave conforming
names alone.

### Values

| Kind | Convention | Example |
|---|---|---|
| boolean | `is` prefix, no negatives (`has`/`can`/`should` for possession/permission/policy) | `isFrozen` |
| array | plural noun (value plural, type stays singular) | `variantIds` |
| keyed lookup | `…ById` suffix | `toneByStatus` |
| id | `Id` / `Ids` suffix | `shipmentId` |
| timestamp | `At` suffix | `scheduledAt` |
| duration | unit suffix | `timeoutMs` |
| count | `Count` suffix | `lineCount` |
| casing | camelCase values · PascalCase types/components · `CONSTANT_CASE` constants | |

### Verbs - one per job, chosen by cost + purity

`get` cheap/sync · `fetch` async I/O · `create` new persisted entity ·
`build` assembles in memory (pure) · `derive` pure value from existing state ·
`parse` raw → typed · `format` value → display string · `update` change a
persisted entity · `validate` returns validity · `assert` throws · `ensure`
idempotently makes state hold.

A `getX` that does network I/O is a finding (`fetchX`). A `createX` that
mutates an existing row is a finding (`updateX`).

### Effect affixes - put the surprise in the name

`…OrThrow` · `…OrDefault` · `upsert` · `…ForUpdate` (row lock) ·
`…SkipLocked` · `try…` (returns result, doesn't throw) · `with…`
(acquire→run→release) · `…Sync` · `…Cached` · `unsafe…`.

A function that takes a row lock, throws on miss, or returns a cached value
without saying so in its name is a finding - that surprise is exactly what the
next caller will miss.

### React & types

- React: `use` hook · `handle` (impl) / `on` (prop) · `Props` type · `with` HOC
  · components PascalCase and **domain-prefixed when collidable**
  (`AdjustmentStatusBadge`, not `StatusBadge`).
- Types: `Input` / `Output` · `Result` (ok/err) · `Schema` (Zod) ·
  `Brand<string,'X'>` for ids · PascalCase noun, no `I-` prefix, never
  pluralize a type.

### Bare generic nouns

`line`, `item`, `node`, `record`, `entry`, `group`, `row`, `value`, `key` are
findings when the surrounding domain has two or more qualified variants in
scope (arrival line vs receipt line; source node vs target node). Qualify with
the domain role - variables, params, fields, type aliases, **type params**
(`TLine` → `TReceiptLine`), and the functions built on the noun.

### NEVER flag a rename at a boundary

DB table/column names (and any `Row`/`Dto` mirroring them), GraphQL / oRPC /
OpenAPI contract fields, enum string values, route strings, wire/JSON keys.
Something outside the diff reads them. The app-layer alias may be renamed
(`createdAt @map("created_at")`); the boundary name may not. A "rename this
column" finding is a false positive - say the boundary name is bad and leave
it to a human if it matters.

---

## 2. Comment policy

**Default: a comment should not exist.** It earns its place only by saying
something the code *cannot*, and then in as few words as possible. Flag each
offending comment the diff ADDED as its own `idiomatic` finding with the
deletion as the `fix` - never a vague "too many comments". Pre-existing
comments are out of scope.

Flag a comment that:

- restates the next line (`// increment counter` over `counter += 1`);
- narrates a step or captions a block ("first we fetch, then we map…");
- **narrates a whole function or type** - JSDoc restating a well-named
  signature, its params, or its return shape. A doc comment earns its place
  only for a non-obvious *contract*;
- explains obvious syntax or a well-known API;
- repeats a rationale stated elsewhere in the diff (keep ONE canonical place);
- is changelog/AI noise - ticket IDs (`PROJ-123`), person names, multi-paragraph
  "why we chose X" essays. A single `@see PROJ-123` JSDoc tag is fine;
- **references what the reader cannot see** - a removed line or a prior
  approach ("no longer using the old Y"). Source shows what the code *is*;
- **documents invisible coupling** - "ordered this way because some other code
  does X". The fix is clearer structure, not a comment enshrining it;
- **says what a name or type could say** - then the code should carry it (this
  is a naming finding per §1, not a comment to keep).

KEEP (do not flag): an external-system quirk, an ordering/concurrency
constraint, a bug workaround, a footgun, a "looks wrong but is correct
because…" causal chain, a directive, a license header, and every lint/type
pragma (`eslint-disable`, `@ts-expect-error`, `prettier-ignore`).

Heuristic: a comment about as long as the code it sits on, naming no real
gotcha, is noise. Code is type-checked; prose is not.

---

## 3. Hygiene & debug artifacts - severity is fixed, do not soften

Scan `+` lines only (added by this diff; pre-existing occurrences are out of
scope).

| Artifact | Severity |
|---|---|
| `console.log(` / `console.debug(` added to non-CLI production code | important |
| `debugger;` | critical |
| `.only` on a test (`it.only`, `describe.only`, `fit(`, `fdescribe(`) - silently skips the rest of the suite | critical |
| new `TODO:` / `FIXME:` / `HACK:` / `XXX:` with no ticket reference | idiomatic |
| commented-out code block > 3 lines | idiomatic |
| hardcoded URL / endpoint that belongs in an env var | important |
| hardcoded magic number that should be a named constant | idiomatic |
| unreachable code after `return`/`throw` | important |

`console.error`/`console.warn` on a real error path is not a finding unless the
repo has a logger idiom - then cite it.

---

## 4. Test conventions

These are on top of the mutation/mock analysis the test-quality agent already
does. Each is an `idiomatic` finding with the corrected code as the `fix`.

- **Placement:** tests live in `__tests__/` **next to** the source file.
  `.test.ts` for pure logic, `.test.tsx` when JSX is needed. A test parked in a
  top-level `test/` dir or beside the source without `__tests__/` is a finding.
- **Names read as English sentences:** `'returns false when name is null'`, not
  `'should return false'`.
- **`describe` nesting max 2 levels;** flat `it()` blocks are fine for small
  functions. Grouping that adds no clarity is a finding.
- **`afterEach(cleanup)`** in every RTL test file.
- **`new QueryClient({ defaultOptions: { queries: { retry: false } } })`** in
  every hook/component test wrapper. Missing `retry: false` silently hangs the
  test on a failing query - flag it as `important`, not idiomatic.
- **Query priority:** `getByRole` → `getByLabelText` → `getByText` →
  `getByTestId` (last resort only). A `getByTestId` where a role query works is
  a finding.
- **Mock paths are RELATIVE, never the `@lib/common` alias.** The alias
  resolves only from `web/`; inside `common/` it is silently ignored and the
  mock has no effect - the test then passes against the real module. Flag any
  `vi.mock('@lib/common/…')` inside `common/` as `important`.
- **Mock at the module boundary,** not `vi.spyOn(mod, '_internal')`.
- **Zod schemas:** test via `safeParse` and assert `result.success`, not
  try/catch around `parse`.
- **Matrix tests:** when behaviour depends on 3+ independent boolean/enum
  inputs, drive `it.each` from a typed matrix, tag each row with the AC it
  verifies, and include the exhaustiveness assertion
  (`expect(matrix).toHaveLength(N * M * K)`). A hand-picked subset of a
  combinatorial space is a coverage-gap finding.
- **Comment the non-obvious scenario:** a test capturing a past bug explains
  *why* (this is a sanctioned comment - never flag it under §2).

---

## 5. Commit & PR hygiene

Beyond PR-1 (hard rule). All `idiomatic` - a squash fixes them and they never
block.

- Conventional commits: `<type>(<scope>): <description>` with type in
  `feat|fix|refactor|test|docs|chore|style|perf|build|ci`; description
  lowercase, imperative, no trailing period.
- Vague subjects (`fix`, `update`, `wip`, `changes`, `stuff`) - flag, recommend
  a rewrite.
- Many WIP commits - recommend a squash before merge, in one line, once.
- Never mention Claude Code / the assistant in commit or PR text; a
  `Co-Authored-By: Claude` trailer or "Generated with Claude Code" footer in
  the commit log is a finding.

---

## 6. Generated code - check the source, not the artifact

When a source file changes and the artifact generated from it does not (or
vice versa), that is an `important` finding: for example a changed `.sql`,
`.graphql`, JSON schema or ORM schema without its regenerated output, or a
migration missing for a schema change.

Never review the *content* of a generated file as if it were hand-written - no
naming, comment, or complexity findings inside `generated/`. Review the source.
