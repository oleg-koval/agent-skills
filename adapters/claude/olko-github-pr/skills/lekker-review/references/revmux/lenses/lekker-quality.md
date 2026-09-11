---
description: quality, security and data-integrity issues - Teifi's TS-1/TS-2 hard rules included
---
## Lens: lekker-quality

Review the change for quality, security, and data-integrity issues.

Axes to cover:
- Data Integrity: missing transactions on multi-step writes, optimistic
  concurrency without locking, partial-failure with no rollback, silent data
  loss in batch loops.
- Security: SQL/command injection, auth bypass, missing permission checks,
  IDOR, secrets in logs, webhook signature not verified.
  When the diff touches a controller, a route, or an auth decorator, do NOT hand-roll the
  decorator grep. Use the `route-auth-map` skill, which already does exactly this and prints
  method/path/controller/guards plus an explicit unguarded-endpoint section. If the Skill tool
  is unavailable to you, read `~/.claude/skills/route-auth-map/SKILL.md` and follow its steps.
  Compare the map before and after the diff: a route that gains a handler but no guard, or
  loses `@Authenticated`/`@Permission`, is critical.
- Error Handling: unhandled promise rejections, empty catch blocks, missing
  retries on transient failures, no dead-letter for failed jobs.
- Catch-block exit paths: when the diff adds or edits a branch inside a `catch`,
  enumerate EVERY way control leaves that block - each early return, each
  rethrow, and the fall-through - and say what the client sees on each. A new
  branch that changes what gets logged or reported, while leaving a rethrow or
  fall-through reachable for the same condition, is a finding: the error is now
  silent AND still escapes. Do not accept "it reports correctly" as covering the
  block; the report and the control flow are separate claims.
- Schema/Migration: NOT NULL without default, rename without two-step,
  pgtyped queries invalidated, Prisma client out of sync.
- Naming/Typos: wrong casing convention, mixed conventions in same scope,
  misspelled identifiers (these are bugs-in-waiting).
- Derived-value consistency: when the diff introduces a transform of some input
  (normalise, trim, lowercase, parse, clamp, default), grep EVERY other use of
  that raw input in the same scope and check they all go through the transform.
  Half-applied transforms are a classic near-miss: the value is normalised at the
  call site but the raw one is still used in a React dependency array, a cache
  key, a log line, an equality check, or a second call site. Two spellings of the
  "same" value then disagree. Enumerate the uses; do not eyeball the hunk.

  ```bash
  grep -n "<rawIdentifier>" <file>     # every use, then confirm each is intended
  ```

- Env vars: dead vars, renamed without migration, wrong fallback operator
  (?? vs ||), type mismatch, leaked in logs.
- TypeScript type safety (TS-1): flag every type cast (`as X`, `<X>expr`)
  and every use of `any`. Test files: only flag blatantly omitted types
  (e.g. `any[]` on a clearly-typed list). All others: critical. Quote the
  cast, explain the correct type, show the fix. Ask if they're Harry Potter.
  Title the finding `[TS-1] ...`.
- No JavaScript files (TS-2): if the diff adds any `.js` file to a non-Liquid
  theme repo, flag as critical - must be `.ts`. Title the finding `[TS-2] ...`.
- Dependency changes. Skip this axis entirely unless the diff touches
  `package.json`, a lockfile, or a vendored dependency. Where it applies:
  (a) A version bump is a behaviour change nobody in this PR wrote. If neither
      the PR body nor a commit message cites the changelog or migration notes,
      that is major: semver is a promise the maintainer may not have kept,
      and a "patch" can carry a behavioural change.
  (b) A bulk bump of several unrelated packages in one PR is major. When
      it breaks the build you have lost which package did it. The fix is to
      split it per package, or per genuinely related group.
  (c) A `package.json` dependency change with no matching lockfile change in the
      same diff, or a lockfile change with no `package.json` change and no
      explanation, is critical: the lockfile is what actually ships.
  (d) A new direct dependency that duplicates something already in the stack is
      major. Name the existing thing that already solves it.
  Raise NO naming, comment, complexity, or TS-1 finding inside a lockfile or a
  `node_modules` path.

TS-1 and TS-2 are Teifi hard rules: their text is defined in full in `{{PROFILE}}`
(read it there before applying either). A finding for one of them MUST have its
title start with the bracketed tag, e.g. `[TS-1] ...` or `[TS-2] ...`, so the
caller can recognize it as a policy violation rather than an ordinary finding.

CI status, Sentry signals, and existing reviews may be present in `{{CONTEXT}}` -
read what is there before forming an opinion, and skip anything that is absent
rather than treating its absence as a finding.

Rules:
- Every finding must trace to a `+` line in the diff.
- Report file:line - description. No positive observations.
- Quote the verbatim offending line(s) from the diff - never paraphrased, never
  reconstructed from memory - and give a concrete drop-in fix, or when the fix
  is architectural, a minimal skeleton plus one sentence on what else must change.
- A finding you cannot quote and cannot fix is a finding you have not proven -
  drop it instead of reporting it as a minor observation with no evidence.
