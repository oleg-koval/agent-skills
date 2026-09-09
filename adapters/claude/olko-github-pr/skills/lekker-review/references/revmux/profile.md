# Teifi project profile

This is the Teifi project profile, handed to revmux as `{{PROFILE}}` for the lekker-medium
and lekker-deep review profiles. It concatenates the two files lekker-review itself reads as
`teifi-rules.md` (hard rules, always critical) and `teifi-conventions.md` (soft house style).

---

# Teifi rules, taxonomy, and stack context

## Teifi Hard Rules (apply during review AND development)

These rules are non-negotiable. Violations are always **Critical** findings regardless of depth or other filters. Apply them when developing a feature or bugfix, not only during review.

### TS-1 — Type safety (TypeScript only)

- No type casting (`as X`, `<X>expr`) — ask them if they are Harry Potter for casting spells.
- No `any` — except in test files where types are genuinely hard to express; even there, blatantly omitted types (e.g. `any[]` on a known shaped list) must be flagged.
- Every finding: quote the cast/`any`, explain the correct type, show the fix.

### TS-2 — No JavaScript files

- No `.js` files may be added to any Teifi integrations repo.
- Exception: Liquid themes (Online Store 2.0 Shopify themes) may contain `.js`.
- If the PR adds a `.js` file to a non-theme repo, flag it as Critical: must be converted to `.ts`.

### GQL-1 — GraphQL NodesConnection pagination

- Every query that uses a nodes connection (`nodes { ... }`) **must** include `pageInfo { hasNextPage endCursor }` alongside the nodes.
- All remaining pages **must** be fetched — a single-page fetch with no loop/recursion is a bug.
- The page size **must** be `250` (Shopify max). If any other value is used, a code comment explaining why is required; if no comment exists, flag it.

### PR-1 — PR title must be prefixed with Linear ticket(s)

- PR title must start with `[GIC-123]` (or the relevant project prefix) in square brackets.
- Go through the commit history: if merged PRs or commits reference Linear tickets in square brackets (`[GIC-123]`), all of them must appear comma-separated in the current PR title (e.g. `[GIC-123,GIC-124]`).
- This is a **blocking** finding: display a prominent `⛔ CANNOT MERGE` warning and recommend the correct title prefix. Confidence score is not affected — this is a process rule, not a code quality signal.

### 1g. Repo placement check (Teifi multi-repo projects only)

For any PR in a `Teifi-Digital/` repo, verify that the code being changed
belongs in *this* repo and not a sibling repo.

**Teifi repo taxonomy:**

| Repo pattern | Purpose |
|---|---|
| `*-live` (e.g. `gic-live`, `evi-live`) | Shopify app: customer account extensions, app blocks, storefront extensions, Polaris admin UI |
| `*-integrations` (e.g. `evi-integrations`; see the GIC exception below) | Backend ERP sync: cron jobs, orchestrator, BC/Sage/Jitterbit/ROI API clients |
| `teifi-digital` / shared libs | Cross-project utilities, shared types |

**Note:** `gic-integrations` has an `extensions/` folder containing legacy/reference extensions (e.g. `link-account-customer`), but **new customer account extensions for GIC should target `gic-live`** per project specs. Always check the Linear/Notion ticket for explicit repo path — don't infer from existing repo contents alone.

**Action:** If the diff adds a new Shopify extension and the PR targets `*-integrations`, check the Linear/Notion spec for the explicit target directory. If the spec names `*-live`, flag it as a **Critical** placement error (`## 🏠 Wrong Repo`).

Include: spec quote with correct path, which repo to target, and the risk (wrong Shopify Partner app, extension not published to correct store).

## Notes for Teifi / evi-integrations

### Standing coding rules (apply during development and review)

| Rule | What | When to flag |
|---|---|---|
| TS-1 | No type casts (`as X`), no `any` | Critical; test files lenient on genuine unknowns only |
| TS-2 | No `.js` files in integrations repos | Critical; Liquid themes exempt |
| GQL-1 | nodes connections need `pageInfo`, all pages fetched, size=250 | Critical if pageInfo/pagination missing; Important if size≠250 without comment |
| PR-1 | PR title must start with `[TICKET-NNN]`; include all commit-referenced tickets | Blocking — ⛔ CANNOT MERGE warning |
| FLAG-1 | Reflag repos only: risky change should ship behind a feature flag | Non-blocking; `important` at most, usually `observation`. Never a `rule:` tag |

These apply equally when you are writing a feature or bugfix — not only in review.

### FLAG-1 — Ship behind a feature flag (Reflag repos only)

Applies ONLY where a `package.json` (any depth, excluding `node_modules`) depends on
`@reflag/node-sdk` or `@teifi-digital/reflag-client`. Elsewhere there is no flag client,
so the finding is unactionable and must not be raised.

Flag it when any of these hold:
- a client should validate it before everyone sees it
- it changes data shape or what gets written
- it touches orders, money, or fulfilment
- it cannot be verified without real client data or volume

Just ship it when: pure UI/copy with no data change; a bug fix that is strictly better
and obviously correct; an internal/admin-only surface; fully covered by tests and
verifiable in staging.

Tie-breaker: would you be comfortable being the one to fix this forward at 2am?
Yes → ship it. No → flag it.

Deliberately NOT blocking, unlike TS-1/GQL-1/PR-1: whether something needs a flag is a
rollout judgement, not a correctness violation, and a blocking comment on every
borderline diff trains people to ignore the signal. Never invent a concrete flag key —
keys must be confirmed against Reflag, so say a flag is needed without naming one.

Related: a diff that BOTH adds a column/table AND changes what is read or written must
be split into expand / migrate / read-switch / contract PRs (`important`, name the split).

### Stack context to inform the review:

- **Backend:** TypeScript, Node.js, Express, Prisma, pgtyped, PostgreSQL
- **Frontend:** React, Shopify Polaris, Vite
- **Shopify:** REST Admin + GraphQL Admin, Webhooks, Shopify Functions, genql
- **External APIs:** Business Central (OAuth2, rate-limited), Salesforce GraphQL, ROI
- **Infra:** Docker Compose locally; environment-var–driven cron syncs via `orchestrator.ts`
- **Type gen pipeline:** pgtyped (SQL→TS), genql (GraphQL→TS), json2ts (schemas→TS) —
  check that generated files are regenerated when their sources change
- **MCPs available:** Linear, Slack, Notion, Shopify Dev docs, Harvest, Sentry

### Repo taxonomy (for Step 1g placement check)

**Per-project repo structure varies — always verify before flagging.**

- For **EVI project**: `evi-integrations` = backend ERP sync only; `evi-live` = Shopify app (extensions, Polaris UI).
- For **GIC project**: `gic-integrations` owns the ERP backend sync and retains
  legacy/reference Shopify extensions. New GIC customer account extensions belong
  in `gic-live`; do not treat the legacy `extensions/` folder as placement precedent.
- For other projects (`rsl-*`, `elmt-*`, etc.): check the repo's `extensions/` folder
  presence before assuming a split — do not assume the `*-integrations` pattern always
  means backend-only.

**Step 1g action**: Before flagging a placement mismatch, run:

```bash
gh api "repos/<REPO_SLUG>/git/trees/HEAD" 2>/dev/null | python3 -c "
import sys,json; t=json.load(sys.stdin).get('tree',[]); print([f['path'] for f in t if f['path']=='extensions'])
"
```

If `extensions/` exists in the target repo, placement may be intentional, but
that alone is not precedent for new GIC extensions. Flag when the repo has no
`extensions/` folder, or when a GIC spec targets the new extension to `gic-live`.

---

# Teifi soft conventions (styling, naming, comments, tests, hygiene)

Companion to `teifi-rules.md`. Those are the four HARD rules (TS-1, TS-2,
GQL-1, PR-1) — always Critical. This file is the house style the Teifi
plugin skills enforce during development (`teifi-dev:code-review`,
`rename-pass`, `comment-stripper`, `unit-test-best-practices`). A review that
misses them lets the same nits come back from the human reviewer.

Severity ceiling: everything here is **idiomatic** unless a row says otherwise.
Cite a precedent from the codebase where the row asks for one, and never
inflate a style deviation into Critical.

---

## 1. Naming matrix (source: `teifi-dev` rename-pass agent)

Flag a name the diff INTRODUCES that breaks a row. Renaming is cheap in the
diff, expensive later — but a rename is still a cost, so leave conforming
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

### Verbs — one per job, chosen by cost + purity

`get` cheap/sync · `fetch` async I/O · `create` new persisted entity ·
`build` assembles in memory (pure) · `derive` pure value from existing state ·
`parse` raw → typed · `format` value → display string · `update` change a
persisted entity · `validate` returns validity · `assert` throws · `ensure`
idempotently makes state hold.

A `getX` that does network I/O is a finding (`fetchX`). A `createX` that
mutates an existing row is a finding (`updateX`).

### Effect affixes — put the surprise in the name

`…OrThrow` · `…OrDefault` · `upsert` · `…ForUpdate` (row lock) ·
`…SkipLocked` · `try…` (returns result, doesn't throw) · `with…`
(acquire→run→release) · `…Sync` · `…Cached` · `unsafe…`.

A function that takes a row lock, throws on miss, or returns a cached value
without saying so in its name is a finding — that surprise is exactly what the
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
the domain role — variables, params, fields, type aliases, **type params**
(`TLine` → `TReceiptLine`), and the functions built on the noun.

### NEVER flag a rename at a boundary

DB table/column names (and any `Row`/`Dto` mirroring them), GraphQL / oRPC /
OpenAPI contract fields, enum string values, route strings, wire/JSON keys.
Something outside the diff reads them. The app-layer alias may be renamed
(`createdAt @map("created_at")`); the boundary name may not. A "rename this
column" finding is a false positive — say the boundary name is bad and leave
it to a human if it matters.

---

## 2. Comment policy (source: `teifi-dev` comment-stripper + code-review Cat. 5)

**Default: a comment should not exist.** It earns its place only by saying
something the code *cannot*, and then in as few words as possible. Flag each
offending comment the diff ADDED as its own `idiomatic` finding with the
deletion as the `fix` — never a vague "too many comments". Pre-existing
comments are out of scope.

Flag a comment that:

- restates the next line (`// increment counter` over `counter += 1`);
- narrates a step or captions a block ("first we fetch, then we map…");
- **narrates a whole function or type** — JSDoc restating a well-named
  signature, its params, or its return shape. A doc comment earns its place
  only for a non-obvious *contract*;
- explains obvious syntax or a well-known API;
- repeats a rationale stated elsewhere in the diff (keep ONE canonical place);
- is changelog/AI noise — ticket IDs (`EVI-123`), person names, multi-paragraph
  "why we chose X" essays. A single `@see EVI-123` JSDoc tag is fine;
- **references what the reader cannot see** — a removed line or a prior
  approach ("no longer using the old Y"). Source shows what the code *is*;
- **documents invisible coupling** — "ordered this way because some other code
  does X". The fix is clearer structure, not a comment enshrining it;
- **says what a name or type could say** — then the code should carry it (this
  is a naming finding per §1, not a comment to keep).

KEEP (do not flag): an external-system quirk, an ordering/concurrency
constraint, a bug workaround, a footgun, a "looks wrong but is correct
because…" causal chain, a directive, a license header, and every lint/type
pragma (`eslint-disable`, `@ts-expect-error`, `prettier-ignore`).

Heuristic: a comment about as long as the code it sits on, naming no real
gotcha, is noise. Code is type-checked; prose is not.

---

## 3. Hygiene & debug artifacts — severity is fixed, do not soften

Scan `+` lines only (added by this diff; pre-existing occurrences are out of
scope).

| Artifact | Severity |
|---|---|
| `console.log(` / `console.debug(` added to non-CLI production code | important |
| `debugger;` | critical |
| `.only` on a test (`it.only`, `describe.only`, `fit(`, `fdescribe(`) — silently skips the rest of the suite | critical |
| new `TODO:` / `FIXME:` / `HACK:` / `XXX:` with no ticket reference | idiomatic |
| commented-out code block > 3 lines | idiomatic |
| hardcoded URL / endpoint that belongs in an env var | important |
| hardcoded magic number that should be a named constant | idiomatic |
| unreachable code after `return`/`throw` | important |

`console.error`/`console.warn` on a real error path is not a finding unless the
repo has a logger idiom — then cite it.

---

## 4. Test conventions (source: `teifi-dev:unit-test-best-practices`)

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
  test on a failing query — flag it as `important`, not idiomatic.
- **Query priority:** `getByRole` → `getByLabelText` → `getByText` →
  `getByTestId` (last resort only). A `getByTestId` where a role query works is
  a finding.
- **Mock paths are RELATIVE, never the `@lib/common` alias.** The alias
  resolves only from `web/`; inside `common/` it is silently ignored and the
  mock has no effect — the test then passes against the real module. Flag any
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
  *why* (this is a sanctioned comment — never flag it under §2).

---

## 5. Commit & PR hygiene

Beyond PR-1 (hard rule). All `idiomatic` — a squash fixes them and they never
block.

- Conventional commits: `<type>(<scope>): <description>` with type in
  `feat|fix|refactor|test|docs|chore|style|perf|build|ci`; description
  lowercase, imperative, no trailing period.
- Vague subjects (`fix`, `update`, `wip`, `changes`, `stuff`) — flag, recommend
  a rewrite.
- Many WIP commits — recommend a squash before merge, in one line, once.
- Never mention Claude Code / the assistant in commit or PR text; a
  `Co-Authored-By: Claude` trailer or "Generated with Claude Code" footer in
  the commit log is a finding.

---

## 6. Generated code — check the source, not the artifact

The Teifi type-gen pipeline means several files must move together. When a
source changes and its generated artifact does not (or vice-versa), that is an
`important` finding:

| Source changed | Artifact that must be regenerated |
|---|---|
| `services/db/queries/*.sql` | `services/db/queries/generated/` (pgtyped) |
| `services/gql/queries/*.graphql` | `services/gql/queries/generated/queries.ts` (genql) |
| `schemas/*.json` | `schemas/generated/` (json2ts) |
| `prisma/schema.prisma` | a migration in `prisma/migrations/` + Prisma client |

Never review the *content* of a generated file as if it were hand-written — no
naming, comment, or complexity findings inside `generated/`. Review the source.

Related hard convention (project CLAUDE.md): Shopify Admin API calls go through
the genql client (`gql.<file>.<query>.run(graphql, vars)`) — a hand-rolled
`fetch` to `/admin/api/…/graphql.json` is an `important` finding even for a
one-off probe.
