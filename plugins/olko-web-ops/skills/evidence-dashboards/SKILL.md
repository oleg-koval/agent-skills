---
name: evidence-dashboards
description: Design, implement, and verify evidence-focused Grafana dashboards with Tufte-inspired charts, honest data semantics, and reproducible provisioning. Use for operational dashboard redesigns, clearer monitoring, or Roazon-style catalog freshness and pipeline visibility.
license: MIT
compatibility: Agent Skills compatible tools with repository access. Live verification requires authorized Grafana access and browser automation; use the project's existing tooling.
metadata:
  author: Oleg Koval
  tags:
    - grafana
    - observability
    - data-visualization
    - dashboard-design
    - operations
---

# Evidence Dashboards

Build operational dashboards that make the evidence legible: what happened, how much, over which period, with what coverage, and what needs attention. Deliver working charts backed by real queries and reproducible source.

## When to use

Activate for requests such as “redesign our Grafana dashboards”, “make the charts Tufte-style”, “show catalog freshness”, or “replace the wall of stats with useful evidence”. Use the workflow for new dashboards or an existing dashboard repair and redesign.

For a design-only request, deliver the specification and identify unverified assumptions. For implementation, finish the authorized source and verification work. This skill does not independently authorize production changes, new instrumentation, credential changes, external messages, or publishing.

## Working principles

- Start with an operator's decision; choose a chart only after defining its evidence.
- Prefer trends, comparisons, distributions, and exceptions over decorative summaries.
- Make missing, stale, partial, failed, and genuine zero observations distinguishable.
- Keep the source, time window, unit, denominator, and aggregation explicit.
- Preserve useful detail without making the reader decode an interface.
- Use existing telemetry honestly; record gaps rather than manufacture evidence.

## Workflow

### 1. Establish the actual system

Read applicable repository instructions. Inspect Git status, remotes, current branch, default-branch source, and deployment provenance. Preserve unrelated work and use an isolated worktree when appropriate.

Find dashboard definitions, generators, datasource provisioning, deployment scripts, checks, and existing HTTP tooling. Verify the intended Grafana instance, organization, folder, datasource UID, and plugin versions; do not infer these from a familiar hostname or an old checkout.

Use existing project scripts first, then CLI, MCP, or SDK. Follow the repository's HTTP policy. Repeated HTTP inspection belongs in reusable tooling with bounded retries and persisted, access-controlled raw responses. Redact credentials and sensitive customer data; never store authorization headers or cookies in artifacts.

Record a compact baseline: dashboard URLs and UIDs, source revision, visible faults, query failures, current layout screenshots, and the requested delivery boundary.

### 2. Define the evidence before the layout

Name the actor and three to five decisions the dashboard must support. For each proposed panel, complete the panel contract in [the specification template](references/specification.md).

Inspect actual query results and producer code. Identify event counters, gauges, snapshots, histograms, and retained history; record cadence and known coverage. Confirm whether records belong to comparable populations before deriving rates or funnels.

For Roazon or a catalog ingestion system, load [the catalog operations playbook](references/roazon-playbook.md). For all projects, load [the visual and semantic standard](references/design-standard.md).

Drop panels that cannot answer a useful question. Classify missing instrumentation separately from dashboard defects. Do not silently expand a redesign into an observability-platform rebuild.

### 3. Compose the visual argument

Arrange content in reading order:

1. Identity, scope, selected period, and source freshness.
2. A small number of current conditions requiring a decision.
3. The principal historical evidence, with context or comparable series.
4. Ranked exceptions or stage diagnostics that explain where to investigate.
5. Coverage, definitions, and links to existing operational detail.

Use the Grafana grid and native typography. Start with a dominant trend and supporting aligned comparisons; add separate dashboards only when actors or time scales differ materially. Keep the main view understandable at an ordinary laptop viewport without shrinking labels.

Apply the reference standard for scales, color, missing data, and density. Explain the proposed structure briefly and proceed with routine design choices inside the authorized scope.

### 4. Implement reproducibly

Edit canonical source, then regenerate outputs using repository commands. Preserve stable dashboard UIDs and useful deep links. Keep datasource secrets in the existing protected configuration boundary; dashboards contain identifiers, never bearer credentials.

Use supported native panels and installed plugins. Verify unfamiliar or version-sensitive options against official documentation. Prefer a maintainable query or transform to elaborate reshaping. Inspect the actual frame fields after transformations: category labels and null values can disappear even when requests return HTTP 200.

Connect every time-dependent query to the visible controls. If an API only supports trailing-day windows, expose those supported choices and ensure the chart displays the same range. Explicitly label snapshots as current even when historical controls are visible.

Add focused checks for meaningful invariants: generated output freshness, stable IDs, non-overlapping grid, variable propagation, units, and unavailable-versus-zero behavior. Do not add tests that merely restate every JSON property.

### 5. Verify data and appearance

Run applicable generation, validation, and repository checks. Execute every panel query through its real datasource path. Inspect frame contents and transformations, not just transport success.

Exercise representative data states: sparse history, a reported zero, null/unavailable, no rows, stale source, partial boundary periods, and a failed query. Use isolated fixtures where production cannot safely produce those states; label fixture evidence separately from live evidence.

Verify at least two supported time windows, and scoped filters where present. Confirm the query interval, returned timestamps, displayed axis, timezone, and refresh cadence agree. Check inclusive boundaries and cumulative versus per-period interpretation.

Use a real browser with an appropriate authorized user. Inspect light and dark themes at laptop and desktop widths. Check labels, units, ticks, tooltips, legends, clipping, empty/error states, navigation, and browser/network errors. Save sanitized screenshots and query evidence. API-only verification is not visual acceptance.

### 6. Deploy within scope and prove the result

When deployment is authorized, back up the targeted live definitions and provisioning before writing. Record the rollback location and method. Change only the relevant files or resources; avoid unrelated datasource changes and service restarts.

Apply through the existing deployment workflow. Confirm the live definitions match the intended generated source, provisioned ownership is correct, every panel query succeeds, and the rendered result still passes. If verification fails, repair the scoped change or restore the backup; report the actual resulting state.

If live access or authority is unavailable, complete reviewable local work and report the exact remaining gate. Do not claim deployment or visual acceptance from source tests.

## Acceptance and handoff

The result is ready only when the requested boundary is evidenced:

- Every panel has a decision, valid source, explicit scope, and honest interpretation.
- Trends, comparisons, and exception views use appropriate scales and units.
- Zero, missing, stale, and partial data retain their meanings.
- Controls alter both the requested data and the visible range as intended.
- Source generation and applicable checks pass on the final artifact.
- Required browser and live checks are recorded, or clearly marked unavailable.
- Authorized deployment has a backup, verified live state, and rollback instructions.

Report dashboard links, changed source, exact verification, screenshots, telemetry gaps, and rollback evidence. Keep local correctness, pushed source, CI, deployment, and human acceptance separate. Follow the host's delivery receipt and review requirements; this skill does not replace them.
