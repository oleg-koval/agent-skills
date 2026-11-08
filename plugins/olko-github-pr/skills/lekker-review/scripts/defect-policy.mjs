// Pure validation for frozen defect cases and adjudication records.
const FULL_SHA = /^[a-f0-9]{40}$/i
const SHA256 = /^[a-f0-9]{64}$/i
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const VERDICTS = new Set(['confirmed', 'false-alarm', 'suggestion', 'unresolved'])
const SEVERITIES = new Set(['critical', 'important', 'observation', 'idiomatic'])

const requireValue = (condition, message) => {
  if (!condition) throw new Error(message)
}

export function validateDefectManifest(manifest) {
  requireValue(manifest?.schema === 1 && Array.isArray(manifest.cases) && manifest.cases.length > 0
    && Array.isArray(manifest.defects), 'defect manifest needs schema 1, cases, and defects')
  requireValue(manifest.defects.every(defect => defect && typeof defect === 'object'), 'defects must be objects')
  const defectIds = manifest.defects.map(defect => defect.id)
  requireValue(defectIds.every(id => typeof id === 'string' && id) && new Set(defectIds).size === defectIds.length,
    'defect ids must be unique non-empty strings')
  requireValue(manifest.defects.every(defect => typeof defect.contract === 'string' && defect.contract.trim()
    && typeof defect.reproductionEvidence === 'string' && defect.reproductionEvidence.trim()),
  'every defect needs a reproduction contract and evidence')
  requireValue(manifest.cases.every(item => item && typeof item === 'object'), 'cases must be objects')
  const caseIds = manifest.cases.map(item => item.id)
  requireValue(caseIds.every(id => typeof id === 'string' && id) && new Set(caseIds).size === caseIds.length,
    'case ids must be unique non-empty strings')
  requireValue(manifest.cases.every(item => typeof item.headSha === 'string' && FULL_SHA.test(item.headSha)
    && Number.isInteger(item.expectedRuns) && item.expectedRuns > 0 && Array.isArray(item.expectedDefects)
    && item.expectedDefects.every(id => defectIds.includes(id))
    && new Set(item.expectedDefects).size === item.expectedDefects.length), 'case identity or expected defects are malformed')
  return { caseIds, defectIds }
}

export function validateDefectEvaluation(manifest, evaluation, findingsSha256, previousRunIds = []) {
  const registry = validateDefectManifest(manifest)
  const run = evaluation?.run
  const adjudication = evaluation?.adjudication
  const unavailable = reason => ({ valid: false, reason, caseId: run?.caseId })
  if (!run || !adjudication || !registry.caseIds.includes(run.caseId)) return unavailable('run or registered case unavailable')
  const testCase = manifest.cases.find(item => item.id === run.caseId)
  if (run.status !== 'completed') return unavailable('run is not completed')
  if (typeof run.runId !== 'string' || !RUN_ID.test(run.runId) || previousRunIds.includes(run.runId)) return unavailable('unsafe or duplicate runId')
  if (run.headSha !== testCase.headSha || adjudication.headSha !== run.headSha || adjudication.runId !== run.runId) return unavailable('run identity mismatch')
  // The edge hashes exact findings bytes; this pure check only binds that supplied hash.
  if (!SHA256.test(findingsSha256 || '') || adjudication.findingsSha256 !== findingsSha256) return unavailable('finding bytes hash mismatch')
  if (!Array.isArray(run.findings) || run.findings.some(finding => !finding || typeof finding.file !== 'string' || !finding.file.trim()
    || !(finding.line === null || (Number.isInteger(finding.line) && finding.line > 0)) || !SEVERITIES.has(finding.severity))) return unavailable('malformed findings')
  const decisions = adjudication.decisions
  if (!Array.isArray(decisions) || decisions.length !== run.findings.length || decisions.some(item => !item || typeof item !== 'object')) {
    return unavailable('adjudication coverage incomplete or malformed')
  }
  const indexes = decisions.map(item => item.findingIndex)
  const valid = decisions.every((item, index) => Number.isInteger(item.findingIndex) && item.findingIndex >= 0
    && item.findingIndex < run.findings.length && indexes.indexOf(item.findingIndex) === index && VERDICTS.has(item.verdict)
    && typeof item.rationale === 'string' && item.rationale.trim() && typeof item.evidence === 'string' && item.evidence.trim()
    && (item.verdict !== 'confirmed' || (typeof item.defectId === 'string' && item.defectId)))
  if (!valid) return unavailable('finding decisions are malformed or duplicated')
  return { valid: true, caseId: run.caseId, runId: run.runId, testCase, decisions }
}
