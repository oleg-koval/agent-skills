# Separate prompt experiments: screening results

The initial attempt below failed native contracts. The corrected-contract rerun
is reported separately at the end; do not pool the two attempts.

Both experiments used fresh gpt-6.1-sol low-effort sessions. Inputs and hidden expected
outcomes were frozen before runs. All input hashes remained unchanged. Three introduced
defects (tenant isolation, cache identity, validation-before-mutation) and three safe
controls were checked by source review and executable isolated runtime controls. The
agents saw legitimate ACs but not the oracle or other outputs.

| Experiment | Control total tokens | Candidate total tokens | Control uncached input | Candidate uncached input | Defects found | False positives |
|---|---:|---:|---:|---:|---|---|
| Narrow quality prompt | 104064 | 102216 | 27623 | 13104 | 3/3 both | 0 both |
| Combine quality + implementation | 211959 | 141401 | 15218 | 24423 | 3/3 both | 0 both |

A removed only trailing instructions already repeated verbatim in the shared caller
contract: full quality prompt5686bytes, candidate3855bytes; substantive axes unchanged.
Observed total tokens -1.78%. The tenant defect changed from critical to important, so
severity calibration is not stable.

B retained both original prompts. Control summed two independent reviewer sessions and
unioned their findings; candidate used one fresh session covering both prompts. Observed
total tokens -33.29%, but uncached input +60.49%. Maximum severity matched; AC status
wording differed (missing vs partial), while both correctly identified violations and
made no claim of full satisfaction. Boundary maps were source-supported in both relevant
arms.

Neither result proves lower dollar cost, whole-review savings, semantic equivalence on
real PRs, or quality improvement. Agent host overhead, tool strategy, input caching and
execution order were uncontrolled. Sessions within each experiment ran concurrently;
there is no valid wall-time comparison. Coordinator usage is excluded. One observation
per arm on a small, deliberately simple fixture is not a representative or held-out
real-PR corpus. Only quality and implementation were screened, not all six review
dimensions or the complete Verify/Critic/Prove workflow. The benchmark caller
contract omitted native-required `bugClass` and `otherInstances`; all five outputs
lack both. All five also encode `acCoverage` as an array, while workflow.js schemas
require a string when present. The three quality-only outputs omit the boundary
required by that host schema for untagged Critical/Important findings. They satisfy
the smaller benchmark contract but would fail native/host contracts. The
production StructuredOutput host schema was
not enforced. These are raw content/usage probes, not usable native review runs;
their common contract failure prevents a production non-regression conclusion.

Decision: leave production prompts, six dimensions and verification unchanged. Require
broader independently adjudicated real-PR cases, failure/unknown cases, repeated
counterbalanced runs and hosted end-to-end verification before adoption. The known
missed defect in baseline001 remains unresolved by this experiment. No blanket cost or
quality improvement claim.

Raw inputs, original output JSON, protocol, preregistered oracle, isolated runtime
controls, host usage, session provenance and SHA256 hashes are retained together in the
experiment archive. Host counters are actual codex-usage.mjs output, not reviewer
estimates.

## Reproduction and audit limits

Artifact run: `20261107-semantic-prompt-experiments`, stored outside Git under
`~/.local/state/lekker-review-evaluation/runs/`. Raw session logs remain in the
host session store; explicit session manifests pin their identities. These local
artifacts are not available to remote PR reviewers. This report alone cannot
independently establish a quality or cost gate. No production activation is proposed.

The source below is TypeScript-compatible JavaScript syntax. The runtime control
imports its bytes through a JavaScript data URL in an isolated local probe; it
does not establish production routing or TypeScript-build verification.

```ts
export function invoiceRoute(rows, id, tenantId) {
  return rows.find(row => row.id === id);
}
export function userRoute(cache, rawId, load) {
  const id = rawId.trim().toLowerCase();
  if (!cache.has(rawId)) cache.set(rawId, load(id));
  return cache.get(rawId);
}
export function replaceRoute(current, next, validate) {
  current.length = 0;
  validate(next);
  current.push(...next);
  return current;
}
// Retain tenant scoping when selecting an invoice.
export function safeInvoiceRoute(rows, id, tenantId) {
  return rows.find(row => row.id === id && row.tenantId === tenantId);
}
// Reuse the normalized identity throughout cache lookup and loading.
export function safeUserRoute(cache, rawId, load) {
  const id = rawId.trim().toLowerCase();
  if (!cache.has(id)) cache.set(id, load(id));
  return cache.get(id);
}
// Validate before mutating caller-owned state.
export function safeReplaceRoute(current, next, validate) {
  validate(next);
  current.splice(0, current.length, ...next);
  return current;
}
```

Expected controls: `invoiceRoute` exposes a foreign-tenant row; equivalent user
spellings cause two loads; rejected replacements erase the original array. The
three `safe*` functions respectively reject the row, load once, and retain state.

For A, use the original `quality.md` versus its prefix before `CI_STATUS:`. Both
arms receive the exact original trailing section as their shared caller contract,
plus the same JSON output and source-only review instructions. For B, use original
`quality.md` and `implementation.md` independently versus both in one fresh session.
Run B independently after A; do not feed earlier outputs to later reviewers.

Input and raw output SHA-256 values:

```text
a4d62d0c4ea77c4b4aae928bb4e72a6217813ac3c4573f3e97d038c5f06fd991  inputs/pr.diff
3d5c29ef223989dde19c3bfe5822dd1b41d363258ebcd13a9fb098bc8d271e33  inputs/context.json
42cb78d30e9a0b0ed8ef95d2861a75e24d34e7cf33f263a90b418938461c9d4a  inputs/quality-full.md
919d53eb4adcd9d1ce621245e0bbdec37f1f27d136b5b2425bbd386fb106440a  inputs/quality-narrow.md
921a15a8a531c8e519685e07c415334ca56f1ed85352e1e80b24a15da4214bcb  inputs/implementation-full.md
b24078101998a5241500adae550dac466e9628c47fcd918f1e9e2a7976d896db  inputs/shared-contract.md
538d463ba31f9957f91a78eb5b92d99b87cfe013080fb0a6ff4a28e188f7f5ee  results/narrow-control.json
bd34418b97f3c5568b94f0f45240761842a82ab0f1cab00b00b838a77befddb3  results/narrow-candidate.json
97f4d56037d981c98c1247f31d7e1570a5e9332479ac130f3026ed2b699dc488  results/consolidation-quality.json
433e9f3664e3582cd8c28147338516e63bee8481529cee854fbb80dfd6d5413e  results/consolidation-implementation.json
57c6e4f8aabcadca017ff3d2bf4bc481f5f511c5d60cbd3eaf16142d63a667e4  results/consolidation-candidate.json
```

## Corrected-contract rerun

Run `20261107-semantic-prompt-experiments-v2` preserves the same fixture and
original prompts. Its shared caller now supplies the complete required metadata,
string AC coverage and host boundary requirement to every arm. Inputs and oracle
were frozen before five fresh reviewers ran; no prior outputs or oracle were
shared with reviewers. Actual model/effort remained gpt-6.1-sol/low in every arm.

| Experiment | Control total | Candidate total | Control uncached input | Candidate uncached input |
|---|---:|---:|---:|---:|
| Narrow quality prompt | 79755 | 103824 | 5194 | 8907 |
| Combine quality + implementation | 185438 | 112000 | 11212 | 7921 |

Narrowing increased observed total tokens 30.18%; consolidation reduced them 39.60%.
Uncached input increased 71.49% for narrowing and decreased 29.35% for consolidation.
All five outputs pass the shipped quality/implementation schemas, extracted from
trusted workflow.js and checked with jsonschema 4.23.0. All three seeded defects
were found by every reviewer, no safe control was flagged, and severities matched.
Input hashes remained unchanged. This is schema/source proof, not hosted review.

Metadata still differed: control quality reviewers listed service.ts:7 as another
cache instance; candidate reviewers returned an empty list, though their code
quotes and fixes cover that line. Production grouping also differs from manual
adjudication: the trusted existing dedup helper retains six separate-control
findings for three underlying defects because titles/classifications differ.
The reported three-issue union is manual; full pipeline output was not measured.

This corrective rerun used 481017 aggregate agent tokens; the invalid first attempt
used 559640, for 1040657 across both attempts, excluding coordinator work. Those
are investigation costs, not production savings. Cache/tool-strategy effects,
concurrent scheduling, one observation per arm and the simple corpus still
prevent causal, dollar-cost, representative-quality or whole-review conclusions.
No further reruns are planned from this screening evidence. Keep production
prompts, six dimensions and verification unchanged pending broader held-out
cases and hosted end-to-end evidence.
