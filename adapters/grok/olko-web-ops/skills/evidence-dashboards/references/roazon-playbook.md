# Roazon and catalog operations playbook

Use this when the target is Roazon or a similar scrape/import/publication pipeline. These are investigation questions, not assertions that specific metrics or endpoints exist. Discover the actual architecture and available signals first.

## The central distinction

Workflow completion, scraping, importing, and publication are different events. A successful run may retain a last-known-good catalog while a required source is unavailable. Show freshness of the data customers can actually read, together with coverage and the upstream reason for a delay.

Do not mark a market current merely because another market or source completed. Do not replace missing data with zero products. Do not infer complete coverage from an artifact receipt or successful task alone.

## Candidate views

### Catalog evidence

Question: Is the published catalog current and complete for the intended market/source set?

Prefer a ranked freshness view by market and source, a publication timeline, and a concise exceptions table. Separate last successful scrape, completed import, publication time, and observed customer-visible version when those signals exist. Show expected versus completed source coverage only when an authoritative expected set exists.

A useful exception row contains market/source, published-data age, latest upstream outcome, retained/fresh state, and a link to the relevant run or artifact. Choose thresholds from actual freshness requirements.

### Pipeline flow

Question: Where is work delayed or failing?

Use queue depth and oldest-message age together; a small queue may still contain very old work. Show throughput, retries, dead-letter work, processing duration, and stage lag where measured. Distinguish queued, in-flight, retried, and terminal failures to avoid double counting.

Compare stages only for the same cohort or clearly label them as independent activity totals. A queue drain does not establish successful publication. A retry count does not necessarily equal distinct failed items.

### Customer-facing service

Question: Is the service delivering useful responses?

Use request rates, error rates with denominators, latency quantiles with sample context, and availability if telemetry supports them. Separate health probes from customer traffic. Connect visible service health to catalog freshness without implying that HTTP success proves data freshness.

### Recent changes and investigation

Question: What changed before the observed condition?

Use deployment/run annotations when their times and identities are authoritative. Link to existing logs, run details, or artifacts with scoped filters. Temporal proximity is a lead for investigation, not evidence of causation.

## Scope control

Begin with one coherent overview. Split catalog, pipeline, and service views only when the available evidence and investigation workflow justify it. Keep stable links and existing useful dashboards.

For unavailable signals, write a gap entry: operational question, missing evidence, current substitute and its limits, smallest useful instrumentation, and proposed owner. Keep that proposal separate from the authorized dashboard implementation.

Never bake a NAS address, SSH account, token, Grafana organization, or current deployment version into this reusable skill. Resolve those from the target environment and current configuration.
