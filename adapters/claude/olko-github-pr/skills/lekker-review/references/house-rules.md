# House rules (customize for your org)

This file is a template. lekker-review reads it as `PROJECT_RULES` and feeds
it to every review agent. Replace the example rules below with your own
team's non-negotiable conventions: the kind of thing that should always be a
**Critical** finding regardless of review depth, not a matter of taste.

A hard rule in this file should be:
- **Unambiguous**: a reviewer agent can check it mechanically against a diff.
- **Non-negotiable**: violating it is always wrong, not "usually" wrong.
- **Cheap to verify**: the review agent shouldn't need deep domain judgment.

If you have no hard rules yet, leave this file mostly empty (just the Stack
context section below) and let the 5 specialist agents rely on their own
judgment plus the repo's own CLAUDE.md / linter config.

---

## Example hard rules (replace with your own)

### EXAMPLE-1: Type safety (TypeScript projects)
- No type casts (`as X`, `<X>expr`) outside test files.
- No `any` outside test files; even in tests, a blatantly untyped `any[]` on a
  known-shaped list should still be flagged.

### EXAMPLE-2: No generated files hand-edited
- Files under a `generated/` directory (codegen output, ORM types, GraphQL
  types) must never be hand-edited in a diff: they should be regenerated
  from source and the regen step re-run.

### EXAMPLE-3: Pagination must be complete
- Any paginated API call (GraphQL `nodes` connections, REST cursor pagination)
  must fetch every page, not just the first, unless a comment explains why a
  partial fetch is intentional.

### EXAMPLE-4: PR title must reference its ticket
- PR title must start with the ticket ID in brackets (e.g. `[PROJ-123]`),
  covering every ticket referenced in the PR's commit history.
- Treat a missing/incomplete prefix as **blocking**: surface a prominent
  `⛔ CANNOT MERGE` warning and the recommended title. This is a process rule,
  not a code-quality signal, so it should not affect a confidence score.

---

## Repo placement check (multi-repo projects only)

If your org splits related concerns across sibling repos (e.g. a "backend
sync" repo and a separate "storefront/app" repo), add your own repo taxonomy
table here so the review agent can flag code landing in the wrong repo:

```
| Repo pattern      | Purpose                                |
|--------------------|-----------------------------------------|
| `<pattern-a>`      | <what belongs here>                     |
| `<pattern-b>`      | <what belongs here>                     |
```

Note any exceptions (a repo that looks like pattern A but is actually a full
app, a legacy folder that shouldn't be used for new code, etc.): placement
checks are only useful when they account for the real exceptions in your repo
layout, not the naming convention alone.

---

## Stack context (fill in for your project)

Give the review agents a one-paragraph map of your stack so they don't have
to rediscover it from the diff every time:

- **Backend:** <languages, frameworks, ORM, database>
- **Frontend:** <framework, UI library, build tool>
- **External APIs:** <third-party integrations worth knowing about, especially
  ones with quirks: rate limits, OAuth flows, unusual pagination>
- **Infra:** <how the app runs locally and in CI>
- **Type/codegen pipeline:** <any source → generated-type steps that need to
  stay in sync: flag stale generated output as a finding>
