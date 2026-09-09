---
description: correctness, scalability and integration issues — Acme's GQL-1 hard rule included
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
- Integration Contracts: unsupported external API assumptions, webhook
  idempotency, external API pagination not handled.
- GraphQL pagination: when the consumer requires a complete result, verify that
  the query exposes continuation metadata and the caller follows it. Check
  page-size limits against the target API's contract.
- Feature flags: when the repository has a rollout mechanism and a changed
  path introduces a risky write or changes externally visible behavior, check
  for a guard or a documented rollback plan. Trace the actual write through
  its callers and configuration before reporting an omission. Refer to the
  repository's own guidance for exemptions and avoid proposing invented flag keys.
  Rollout advice on its own is noncritical. Reserve hard-rule tags for proven
  violations of configured project rules.


Start the finding title with the bracketed rule ID when it violates a configured hard rule in `{{PROFILE}}`.

Rules:
- Every finding must trace to a `+` line in the diff, with one exception: an
  unmet AC whose defect lives in code the diff did not touch. Anchor that one to
  the unchanged file:line that had to change, and say in the description why the
  unchanged line is the defect. That line may be an unchanged one — do not drop
  an unmet AC for lack of a quotable added line.
- Report file:line — description. No positive observations.
- Quote the verbatim offending line(s) — never paraphrased, never reconstructed
  from memory — and give a concrete drop-in fix, or when the fix is
  architectural, a minimal skeleton plus one sentence on what else must change.
- A finding you cannot quote and cannot fix is a finding you have not proven —
  drop it instead.
