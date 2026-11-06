# Visual and semantic standard

Use these as practical defaults, not rigid styling rules. Honor the installed Grafana version and the operator's task.

## Visual grammar

| Evidence | Preferred form | Required context |
|---|---|---|
| Change over time | Thin line with points for sparse events | Unit, interval, timezone, gaps |
| Comparable categories | Aligned horizontal bars, directly labeled | Common unit and scale, ordering |
| Comparable entities over time | Small multiples | Shared axes and observation window |
| Distribution | Histogram, heatmap, or measured quantiles | Buckets, population, sample count |
| Current exception | Compact table sorted by severity or age | Entity, measured value, threshold, observation time |
| Current condition | Restrained stat with contextual trend where available | NOW label, freshness, threshold provenance |
| Sequential processing | Stage comparison plus delays/backlog | Stage definitions and cohort compatibility |

Avoid gauges without a meaningful bound, doughnuts for precise comparisons, gratuitous icons, gradients, 3D effects, repeated decorative headings, and walls of equally prominent stats. Use tables when exact values or heterogeneous states matter more than shape.

## Layout and typography

Use a clear title and short subtitle for scope. Keep panel titles concrete: “Published catalog age by market” is stronger than “Health”. Place related evidence next to each other and align plot edges. Use whitespace for grouping, restrained separators, and transparent panels where the theme supports them.

Aim for one principal question per panel. Keep descriptions concise; put definitions in tooltips or a small methodology panel. Do not expose implementation internals unless the operator needs them to choose an action.

Do not prescribe a fixed panel count or hide useful exceptions solely to fit one screen. A dense overview should still allow readable labels and a clear investigation path.

## Color and accessibility

Use neutral tones for context, one consistent accent for the principal series, and restrained warning/error colors for justified conditions. Preserve series identity across panels and themes. Encode status in text or shape as well as color. Validate contrast in both themes; avoid hard-coded white backgrounds or near-black labels.

Thresholds must come from a documented SLO, business rule, or explicit operator decision. If no threshold exists, show the measurement and its age rather than invent a green state.

## Scales and comparisons

- Start quantitative bars at zero. Never truncate bars to exaggerate differences.
- Use consistent scales for small multiples and related comparisons. State independent scales explicitly when they are necessary.
- Do not use dual axes unless the relationship is essential and unmistakably labeled; separate panels are usually clearer.
- Distinguish counts, rates, ratios, latency, and elapsed age. Show the denominator for percentages and the sample count for quantiles where available.
- Use integer ticks for small event counts and sensible precision for durations.
- Do not stack unrelated populations. Preserve additive semantics for stacked series.
- Avoid smoothing sparse events or joining gaps when that would imply observations.
- Use log scales only for a defensible analytical need and label them conspicuously.

## Time and completeness

Choose UTC or the documented business timezone and display it. Distinguish event time, ingestion time, last successful publication, and observation time. “Refreshed now” does not prove the underlying data is current.

Label partial first/last buckets. Do not compare a partial current day with a full previous day without making exposure clear. Align comparison periods by duration, bucket resolution, and population. Handle counter resets and daylight-saving boundaries according to the source semantics.

Treat the following states separately:

| State | Representation |
|---|---|
| Observed zero | Numeric 0 with normal source coverage |
| Missing observation | Gap or unavailable label |
| Stale source | Last observed value plus age and stale indicator |
| Partial coverage | Observed value plus explicit coverage qualification |
| Failed query | Visible error state, not a cached green number |
| No matching records | Empty-state explanation tied to filters |

Never apply blanket null-to-zero transformations. A missing denominator or a zero denominator does not imply a 0% rate. Do not subtract independent stage totals and call the difference “drop-off” without a shared cohort.

## Query cost and maintainability

Use appropriate resolution and bounded windows. Avoid per-entity request explosions, uncontrolled label cardinality, and unnecessary repeated queries. Reuse compatible query results when the tooling permits it. Preserve enough detail to diagnose outliers without placing customer identifiers or sensitive payloads in public artifacts.

A successful HTTP response can still contain empty frames, null labels, stale values, or an embedded query error. Verify the rendered interpretation against source values.
