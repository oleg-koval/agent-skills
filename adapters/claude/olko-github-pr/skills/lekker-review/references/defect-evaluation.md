# Defect-aware evaluation

The existing `eval-runner.mjs` mode remains a location-based legacy heuristic.
Use `--defects` only for a local, human-approved frozen corpus with reproduced
defect contracts. It reads data files and never executes reviewed PR code.

## Inputs

The manifest records full commit identities, expected runs, and defect contracts:

```json
{
  "schema": 1,
  "defects": [{
    "id": "DEFECT-1",
    "contract": "Supported long run targets must create an archive without ENAMETOOLONG.",
    "reproductionEvidence": "oracle/reproduction.md"
  }],
  "cases": [{
    "id": "case-buggy",
    "headSha": "<40-character commit SHA>",
    "expectedDefects": ["DEFECT-1"],
    "expectedRuns": 1
  }]
}
```

Each results entry carries the completed run identity and the exact findings JSON
bytes as a string. The evaluator hashes the UTF-8 bytes; formatting changes
therefore invalidate the adjudication. Include a row for every expected run.

```json
{"runs":[{"caseId":"case-buggy","runId":"review-001","status":"completed",
  "headSha":"<same full SHA>","findingsBytes":"[{\"file\":\"src/a.js\",\"line\":3,\"severity\":\"important\"}]"}]}
```

Adjudication is separate from the findings and binds the exact run, commit, and
finding bytes. Every finding index needs exactly one verdict, rationale, and
evidence reference. A confirmed verdict also needs a defect ID; use a new ID for
a candidate defect not yet in the registry.

```json
{"evaluations":[{"runId":"review-001","headSha":"<same full SHA>",
  "findingsSha256":"<64-character SHA-256>","decisions":[
    {"findingIndex":0,"verdict":"confirmed","defectId":"DEFECT-1",
     "rationale":"Matches the reproduction contract","evidence":"adjudication/DEFECT-1.md"}]}]}
```

Run the opt-in scorer:

```sh
node "${SKILL_ROOT}/scripts/eval-runner.mjs" --defects \
  --manifest <manifest.json> --results <defect-runs.json> \
  --adjudication <adjudication.json>
```

## Reading the result

`available` and `coverageComplete` must both be true before treating corpus
metrics as complete. Missing, duplicate, malformed, unresolved, or mismatched
evidence keeps coverage unavailable. A newly confirmed defect remains visible
but requires corpus adjudication and is not added to the recall denominator.

- Recall is expected defect IDs detected, deduplicated once per case run.
- Precision is confirmed finding decisions divided by confirmed plus false-alarm
  finding decisions. Repeated claims count here because each finding is a
  separate decision; `uniqueConfirmedDefects` reports deduplicated IDs.
- False alarms are explicit adjudications, not inferred from severity.
- False alarms per review and clean alarm rate use fully adjudicated runs.
- `distinctCases` counts case IDs represented; it does not claim statistical
  independence between related cases.
- Empty precision or recall denominators are `null`, never zero.

## Measurement protocol

Evaluate only previously unseen cases with frozen base, buggy, and fixed commits
and a reproduced contract for each known defect. Hide arm identity and version
labels from adjudicators; provide the finding text and contract needed to judge
each claim. Randomize paired case/version order. Record cost for all agents and
retries in both arms. Report missing
coverage and unresolved judgments. This harness does not establish a benefit
claim; that requires a completed, blinded comparison over the frozen protocol.
