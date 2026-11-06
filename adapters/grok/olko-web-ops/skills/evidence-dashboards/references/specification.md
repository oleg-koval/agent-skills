# Dashboard specification and evidence record

Create a concise task artifact using this template. Include only relevant sections; do not copy sensitive raw payloads into the document.

## Task binding

- Operator and decisions:
- Repository / worktree / source revision:
- Delivery boundary: specification / local implementation / pushed source / live deployment
- Target Grafana instance, organization, folder, and discovered version:
- Existing dashboards and stable UIDs:
- Baseline faults and screenshots:

## Panel contract

Complete before implementing each panel.

| Field | Required answer |
|---|---|
| Question | What decision does the operator make? |
| Evidence | Exact observed metric, source, or query definition |
| Population | Market, source, entity set, exclusions, denominator |
| Measurement | Event counter, gauge, snapshot, histogram, or derived value |
| Time | Event/observation timestamp, timezone, window, bucket, cadence |
| Semantics | Unit, aggregation, reset handling, partial periods |
| Completeness | Expected coverage, missingness, freshness rule |
| Presentation | Chart type, series identity, scale, ordering, labels |
| Interaction | Variables, range control, links, drill-down |
| Failure | Zero, null, no records, stale data, query error |
| Cost | Window limits, cardinality, query frequency |
| Acceptance | Concrete result and evidence location |

## Verification matrix

| Check | Expected result | Actual result | Evidence |
|---|---|---|---|
| Generated source | Reproducible and current | | |
| Panel queries | Valid frames and meaningful values | | |
| Time controls | Query and displayed interval agree | | |
| Scoped filters | Intended population only | | |
| Sparse/zero/null/error | Semantics remain distinct | | |
| Partial/stale data | Coverage and age visible | | |
| Light/dark browser | Readable, no clipping or errors | | |
| Laptop/desktop | Main questions remain legible | | |
| Live definition | Matches intended deployed source | | |

Use PASS, FAIL, UNAVAILABLE, or NOT_APPLICABLE. Distinguish fixture results from production observations. Record exact commands and source revisions where available.

## Delivery and rollback

- Changed source and generated files:
- Tests and build:
- Pushed commit, branch, PR, and CI if in scope:
- Deployment method and actual live verification:
- Backup location and exact restore method:
- Dashboard links and sanitized screenshots:
- Telemetry gaps and limitations:
- Human acceptance, if performed:
- Smallest remaining action:
