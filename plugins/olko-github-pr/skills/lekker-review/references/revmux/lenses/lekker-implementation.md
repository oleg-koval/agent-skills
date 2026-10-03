---
description: correctness, scalability and integration issues - Teifi's GQL-1 hard rule included
---
## Lens: lekker-implementation

Review the change for correctness, scalability, and integration issues.

Axes to cover:
- Business Logic / AC coverage: for each acceptance criterion available in
  `{{CONTEXT}}` (a ticket's AC list, when present), mark met / partial / missing.
  Scope creep is also worth flagging.
  Decide each AC against the code that RUNS, not against the diff. Use the
  worktree (`{{WORKDIR}}`) to follow the AC through its runtime path into files
  the diff never touched, and specifically:
  (a) Find what invokes the new code and on what trigger. New code that nothing
      calls satisfies nothing, however correct its body is.
  (b) For an AC with a timing, cadence or SLA component, name the trigger's real
      frequency (the cron expression, the poll interval, the webhook) and compare
      that number against the AC. A reaper on a daily cron cannot meet a two-hour
      SLA.
  (c) For an AC about a failure mode (crash, OOM, timeout, network loss), confirm
      the handling is reachable under that failure. A killed process never reaches
      a `finally` block, a shutdown hook, or the tail of a long-running function.
  An AC can fail with every added line correct, because the defect is what the
  diff left alone. That is a finding, not an absence of one.
- Binding scoping decisions: when `{{CONTEXT}}` names a resolved flag from the
  ticket's Dev Scoping Session, a diff that contradicts it is major (critical
  when it changes external behaviour or data shape); quote the decision text.
- Scalability: N+1 queries, missing pagination, unbounded in-memory
  collections, missing rate-limit handling, cron jobs without overlap guard,
  missing DB indexes for new query patterns.
- Time/Space Complexity: O(n²) where linear exists, large payloads in memory,
  sort/dedup on large arrays that could be done at DB level.
- Integration Contracts: Shopify API misuse, BC API assumptions, webhook
  idempotency, external API pagination not handled.
- GraphQL pagination (GQL-1): for every GraphQL query in the diff that uses a
  nodes connection (`nodes { ... }`):
  (a) Check that `pageInfo { hasNextPage endCursor }` is present alongside nodes - if missing, critical.
  (b) Check that all pages are fetched (a loop or recursion using endCursor) - a single-page fetch is a bug, critical.
  (c) Check the page size: must be 250 (Shopify max). If any other size is used without a code comment explaining why, flag as major.
  Title any critical finding under this axis `[GQL-1] ...`.
- Feature-flag rollout (Reflag repos ONLY): first check the repo actually uses
  Reflag - a `package.json` (any depth, excluding node_modules) depending on
  `@reflag/node-sdk` or `@teifi-digital/reflag-client`. If it does not, SKIP this
  axis entirely and raise nothing; a repo with no flag client cannot act on the
  finding. Where it does apply, ask whether the change should ship behind a flag:
  (a) a client should validate it before everyone sees it; (b) it changes data
  shape or what gets written; (c) it touches orders, money, or fulfilment; (d) it
  cannot be verified without real client data or volume. Do NOT raise it for pure
  UI/copy with no data change, a bug fix that is strictly better and obviously
  correct, internal/admin-only surfaces, or work fully covered by tests and
  verifiable in staging. Tie-breaker: if you would not be comfortable fixing it
  forward at 2am, it needs a flag. Name which of (a)-(d) applies.
  Severity: major at most, usually minor - this is a rollout judgement call, not
  a defect. NEVER title this with a bracketed hard-rule tag (that would force
  critical and imply a policy violation). Never invent a concrete flag key as
  though it exists: flag keys must be confirmed against Reflag, so say a flag is
  needed without naming one.
  Also raise as a structural concern (severity major) when a diff BOTH adds a
  column/table AND changes what is read or written - the SOP requires splitting
  that into expand / migrate / read-switch / contract PRs. Name the split.

GQL-1's full rule text lives in `{{PROFILE}}` - read it there before applying it.

Rules:
- Every finding must trace to a `+` line in the diff, with one exception: an
  unmet AC whose defect lives in code the diff did not touch. Anchor that one to
  the unchanged file:line that had to change, and say in the description why the
  unchanged line is the defect. That line may be an unchanged one - do not drop
  an unmet AC for lack of a quotable added line.
- Report file:line - description. No positive observations.
- Quote the verbatim offending line(s) - never paraphrased, never reconstructed
  from memory - and give a concrete drop-in fix, or when the fix is
  architectural, a minimal skeleton plus one sentence on what else must change.
- A finding you cannot quote and cannot fix is a finding you have not proven -
  drop it instead.
