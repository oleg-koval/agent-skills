// Score already-validated defect evidence without reading files or observing time.
import { validateDefectEvaluation, validateDefectManifest } from './defect-policy.mjs'

const requireEvaluations = value => {
  if (!Array.isArray(value)) throw new Error('evaluations must be an array')
}

function scoreEvaluation(manifest, registry, evaluations, evaluation, index) {
  const previousRunIds = evaluations.slice(0, index).map(item => item?.run?.runId)
  const checked = validateDefectEvaluation(manifest, evaluation, evaluation?.findingsSha256, previousRunIds)
  if (!checked.valid) return { available: false, reason: checked.reason, caseId: checked.caseId, index }
  const { runId, caseId, testCase, decisions } = checked
  const confirmed = decisions.filter(item => item.verdict === 'confirmed').map(item => item.defectId)
  const unique = confirmed.filter((id, itemIndex, all) => all.indexOf(id) === itemIndex)
  const known = unique.filter(id => registry.defectIds.includes(id))
  const unknown = unique.filter(id => !registry.defectIds.includes(id))
  const unexpected = unique.filter(id => !testCase.expectedDefects.includes(id))
  const unresolved = decisions.filter(item => item.verdict === 'unresolved').length
  const needsAdjudication = unexpected.length > 0
  return { available: unresolved === 0 && !needsAdjudication,
    reason: unresolved ? 'unresolved adjudication' : needsAdjudication ? 'confirmed defect outside case contract needs corpus adjudication' : null,
    caseId, runId, expected: testCase.expectedDefects, knownConfirmed: known, unknownConfirmed: unknown,
    unexpectedConfirmed: unexpected, confirmedClaims: confirmed.length,
    falseAlarms: decisions.filter(item => item.verdict === 'false-alarm').length,
    unresolved, judged: unresolved === 0, clean: testCase.expectedDefects.length === 0, needsAdjudication }
}

function summarize(manifest, rows) {
  const ready = rows.filter(row => row.available)
  const judged = rows.filter(row => row.judged)
  const coverageComplete = manifest.cases.every(testCase => rows.filter(row => row.available && row.caseId === testCase.id).length === testCase.expectedRuns)
    && rows.every(row => row.available)
  const expected = ready.reduce((count, row) => count + row.expected.length, 0)
  const detected = ready.reduce((count, row) => count + row.knownConfirmed.filter(id => row.expected.includes(id)).length, 0)
  const confirmedClaims = judged.reduce((count, row) => count + row.confirmedClaims, 0)
  const uniqueConfirmed = judged.reduce((count, row) => count + row.knownConfirmed.length + row.unknownConfirmed.length, 0)
  const falseAlarms = judged.reduce((count, row) => count + row.falseAlarms, 0)
  const cleanRows = ready.filter(row => row.clean)
  return { available: coverageComplete, coverageComplete, recall: coverageComplete && expected ? detected / expected : null,
    precision: confirmedClaims + falseAlarms ? confirmedClaims / (confirmedClaims + falseAlarms) : null,
    falseAlarms, falseAlarmsPerReview: judged.length ? falseAlarms / judged.length : null,
    cleanAlarmRate: cleanRows.length ? cleanRows.filter(row => row.falseAlarms > 0).length / cleanRows.length : null,
    unresolved: rows.reduce((count, row) => count + (row.unresolved || 0), 0), expectedDefects: expected,
    confirmedExpected: judged.reduce((count, row) => count + row.knownConfirmed.filter(id => row.expected.includes(id)).length, 0),
    confirmedUnexpected: rows.reduce((count, row) => count + (row.unexpectedConfirmed || []).length, 0),
    confirmedUnknown: rows.reduce((count, row) => count + (row.unknownConfirmed || []).length, 0),
    confirmedClaims, uniqueConfirmedDefects: uniqueConfirmed, scoredRuns: ready.length,
    distinctCases: rows.filter((row, index) => row.caseId && rows.findIndex(prior => prior.caseId === row.caseId) === index).length,
    needsAdjudication: rows.some(row => row.needsAdjudication), rows }
}

export function scoreDefectCorpus(manifest, evaluations) {
  const registry = validateDefectManifest(manifest)
  requireEvaluations(evaluations)
  return summarize(manifest, evaluations.map((item, index) => scoreEvaluation(manifest, registry, evaluations, item, index)))
}
