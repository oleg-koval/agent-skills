# Evidence projection ablation: preregistration draft

This is a future experiment design only. Do not run it as part of implementation.
The four-case 2026-11-08 screen failed promotion and its cases are now known
development fixtures. Freeze a new holdout before any model call.

## Arms and scope

- Baseline: the assigned dimension reviewer receives the full immutable evidence
  bundle and the same review inputs as today.
- Projection: that reviewer receives the deterministic, hash-verified packet
  for its assigned dimension. A whole-diff safety pass receives the same full
  diff in both arms; its reviewer count, prompt, proof policy, and routing stay
  fixed. Omitted packet context is never marked reviewed.
- Use the same pinned model, effort, tools, prompts, timeout, and retry policy in
  both arms. Run one case-arm at a time; alternate arm order within each pair.

## Corpus and procedure

Freeze at least 30 independent PR-level pairs from at least three repositories,
covering three or more defect families. Prefer real bug-introducing commits and
their repairs; include safe controls and near-boundary changes with explicit
contracts. Keep root causes and repositories disjoint from packet-development
fixtures. Record base/head SHAs, contracts, valid-input assumptions, expected
findings, and immutable source hashes before unblinding. Adjudicators see claims
and evidence without the arm label.

Run three paired repetitions per PR with counterbalanced order and no retries.
The PR is the sampling unit; repetitions are nested observations, not new PRs.
Record every reviewer, coordinator, and verification session once from explicit
saved manifests, plus measured setup/adjudication minutes. Preserve cached,
uncached, total input, and output tokens separately. Record elapsed observations
separately; do not sum overlapping durations or convert token sums to currency.
The primary all-in cost uses invoice-backed provider charges plus a frozen
hourly rate for measured setup, coordination, adjudication, and verification.
Freeze provider rates, currency, and labor rate before collection. If charges or
labor measurements are unavailable, report the resource vector and leave the
cost endpoint unavailable; do not promote on token totals alone.

## Analysis and stop rules

Before collection, freeze the smallest worthwhile all-in cost reduction, the
defect-recall non-inferiority margin, a hard review-cost ceiling, and the
maximum sample size. Report paired PR-level differences and 95% cluster
bootstrap intervals, resampling PRs while keeping their repetitions together.
Include false alarms, duplicate claims, unavailable evidence, packet bytes, all
review/coordinator/verification usage, and manual time. Byte reduction is a
mechanism check, not the efficiency endpoint.

Stop immediately on cross-tenant/data exposure, a missed critical defect, stale
provenance accepted as available, or budget exhaustion. Otherwise evaluate at
30 pairs; add only the predeclared next batch when intervals are too wide, up to
the frozen maximum. Promote only if the cost interval clears the worthwhile
effect and the recall interval stays within its safety margin. Otherwise retain
shadow mode and report the result as inconclusive or failed.

No sample-size or quality claim is supported by the existing four-case screen.
The coordinator must approve the frozen corpus, thresholds, and spend ceiling
before this experiment is launched.
