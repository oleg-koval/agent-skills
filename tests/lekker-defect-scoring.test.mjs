import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreDefectCorpus } from '../plugins/olko-github-pr/skills/lekker-review/scripts/defect-scoring.mjs'

const digest = 'b'.repeat(64)
const manifest = { schema: 1, defects: [{ id: 'D1', contract: 'operation succeeds', reproductionEvidence: 'fixture.md' }], cases: [
  { id: 'buggy', headSha: 'a'.repeat(40), expectedDefects: ['D1'], expectedRuns: 2 },
  { id: 'clean', headSha: 'c'.repeat(40), expectedDefects: [], expectedRuns: 1 },
] }
function evaluation(caseId, runId, headSha, decisions) {
  const findings = decisions.map((decision, index) => ({ file: 'src/a.js', line: index + 1, severity: 'important' }))
  return { findingsSha256: digest, run: { caseId, runId, headSha, status: 'completed', findings },
    adjudication: { runId, headSha, findingsSha256: digest, decisions: decisions.map((decision, findingIndex) => ({
      findingIndex, rationale: 'adjudicator checked contract', evidence: 'fixture.md', ...decision,
    })) } }
}

test('scores recall once per defect per run and precision per finding decision', () => {
  const out = scoreDefectCorpus(manifest, [
    evaluation('buggy', 'buggy-1', 'a'.repeat(40), [
      { verdict: 'confirmed', defectId: 'D1' }, { verdict: 'confirmed', defectId: 'D1' }, { verdict: 'false-alarm' },
    ]),
    evaluation('buggy', 'buggy-2', 'a'.repeat(40), []),
    evaluation('clean', 'clean-1', 'c'.repeat(40), []),
  ])
  assert.equal(out.available, true)
  assert.equal(out.recall, 0.5)
  assert.equal(out.precision, 2 / 3)
  assert.equal(out.uniqueConfirmedDefects, 1)
  assert.equal(out.falseAlarms, 1)
  assert.equal(out.falseAlarmsPerReview, 1 / 3)
  assert.equal(out.cleanAlarmRate, 0)
  assert.equal(out.distinctCases, 2)
})

test('new confirmed defects stay visible and make incomplete corpus coverage unavailable', () => {
  const oneRun = { ...manifest, cases: [{ ...manifest.cases[0], expectedRuns: 1 }] }
  const out = scoreDefectCorpus(oneRun, [evaluation('buggy', 'new-1', 'a'.repeat(40), [
    { verdict: 'confirmed', defectId: 'new-defect' },
  ])])
  assert.equal(out.available, false)
  assert.equal(out.needsAdjudication, true)
  assert.equal(out.confirmedUnknown, 1)
  assert.equal(out.recall, null)
  assert.equal(scoreDefectCorpus(manifest, []).precision, null)
})
