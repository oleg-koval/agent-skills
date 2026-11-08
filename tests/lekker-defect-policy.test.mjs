import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDefectEvaluation, validateDefectManifest } from '../plugins/olko-github-pr/skills/lekker-review/scripts/defect-policy.mjs'

const manifest = { schema: 1, defects: [{ id: 'D1', contract: 'operation succeeds', reproductionEvidence: 'fixture.md' }],
  cases: [{ id: 'buggy', headSha: 'a'.repeat(40), expectedDefects: ['D1'], expectedRuns: 1 }] }
const sha256 = 'b'.repeat(64)
const evaluation = { run: { caseId: 'buggy', runId: 'review-1', headSha: 'a'.repeat(40), status: 'completed',
  findings: [{ file: 'src/a.js', line: 8, severity: 'important' }] },
adjudication: { runId: 'review-1', headSha: 'a'.repeat(40), findingsSha256: sha256,
  decisions: [{ findingIndex: 0, verdict: 'confirmed', defectId: 'D1', rationale: 'matches contract', evidence: 'fixture.md' }] } }

test('manifest validation requires frozen cases and reproduced defect contracts', () => {
  assert.deepEqual(validateDefectManifest(manifest).caseIds, ['buggy'])
  assert.throws(() => validateDefectManifest({ ...manifest, cases: [] }), /cases/)
  assert.throws(() => validateDefectManifest({ ...manifest, defects: [{ id: 'D1', contract: 'claim' }] }), /reproduction contract/)
  assert.throws(() => validateDefectManifest({ ...manifest, cases: [{ ...manifest.cases[0], headSha: 'main' }] }), /case identity/)
  assert.throws(() => validateDefectManifest({ ...manifest, cases: [{ ...manifest.cases[0], headSha: ['a'.repeat(40)] }] }), /case identity/)
  assert.throws(() => validateDefectManifest({ ...manifest, cases: [{ ...manifest.cases[0], expectedDefects: ['UNKNOWN'] }] }), /expected defects/)
})

test('run validation binds status, case SHA, exact finding hash, and one evidence-backed decision per finding', () => {
  assert.equal(validateDefectEvaluation(manifest, evaluation, sha256).valid, true)
  assert.match(validateDefectEvaluation(manifest, evaluation, 'c'.repeat(64)).reason, /hash mismatch/)
  assert.match(validateDefectEvaluation(manifest, { ...evaluation, run: { ...evaluation.run, status: 'failed' } }, sha256).reason, /not completed/)
  assert.match(validateDefectEvaluation(manifest, { ...evaluation, run: { ...evaluation.run, runId: 123 },
    adjudication: { ...evaluation.adjudication, runId: 123 } }, sha256).reason, /unsafe or duplicate runId/)
  assert.match(validateDefectEvaluation(manifest, { ...evaluation, adjudication: { ...evaluation.adjudication,
    decisions: [{ ...evaluation.adjudication.decisions[0], findingIndex: 1 }] } }, sha256).reason, /malformed or duplicated/)
  assert.match(validateDefectEvaluation(manifest, evaluation, sha256, ['review-1']).reason, /duplicate runId/)
})

test('rejects mismatched identities and incomplete or duplicate adjudication', () => {
  const invalid = [
    { ...evaluation, run: { ...evaluation.run, headSha: 'c'.repeat(40) } },
    { ...evaluation, adjudication: { ...evaluation.adjudication, headSha: 'c'.repeat(40) } },
    { ...evaluation, adjudication: { ...evaluation.adjudication, runId: 'other' } },
    { ...evaluation, run: { ...evaluation.run, findings: [...evaluation.run.findings, ...evaluation.run.findings] },
      adjudication: { ...evaluation.adjudication, decisions: [evaluation.adjudication.decisions[0], evaluation.adjudication.decisions[0]] } },
  ]
  for (const candidate of invalid) assert.equal(validateDefectEvaluation(manifest, candidate, sha256).valid, false)
  for (const field of ['rationale', 'evidence']) {
    for (const value of [undefined, '', ' ']) {
      const decision = { ...evaluation.adjudication.decisions[0] }
      if (value === undefined) delete decision[field]
      else decision[field] = value
      const candidate = { ...evaluation, adjudication: { ...evaluation.adjudication, decisions: [decision] } }
      assert.equal(validateDefectEvaluation(manifest, candidate, sha256).valid, false, `${field} must be non-blank`)
    }
  }
})

test('preserves confirmed unknown IDs for later corpus adjudication', () => {
  const candidate = { ...evaluation, adjudication: { ...evaluation.adjudication,
    decisions: [{ ...evaluation.adjudication.decisions[0], defectId: 'NEW-DEFECT' }] } }
  const result = validateDefectEvaluation(manifest, candidate, sha256)
  assert.equal(result.valid, true)
  assert.equal(result.decisions[0].defectId, 'NEW-DEFECT')
})
