const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0
const owns = (value, key) => Object.hasOwn(value, key)
const strings = (value, keys) => keys.every(key => typeof value[key] === 'string')
const optionalStrings = (value, keys) => keys.every(key => !owns(value, key) || typeof value[key] === 'string')
const instances = /^(?!\/)(?!.*\\)(?![A-Za-z]:)(?!(?:.*\/)?\.\.(?:\/|:)).+:[1-9][0-9]*$/
const ruleException = /^(PROJECT:[a-z0-9]+(-[a-z0-9]+)*|weakens-project-rule)$/
const dimensions = ['deps', 'triage-quality', 'triage-logic', 'quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'project-rules']

/** Canonicalize location objects without altering or replacing the raw document. */
export function normalizeNativeResult(dimension, document) {
  const location = value => record(value) && Object.keys(value).length === 2
    && typeof value.file === 'string' && !/[\r\n:]/.test(value.file)
    && Number.isSafeInteger(value.line) && value.line > 0
    && instances.test(`${value.file}:${value.line}`) ? `${value.file}:${value.line}` : value
  const normalized = record(document) && Array.isArray(document.findings)
    ? { ...document, findings: Array.from(document.findings, finding => record(finding) && Array.isArray(finding.otherInstances)
      ? { ...finding, otherInstances: Array.from(finding.otherInstances, location) } : finding) } : document
  const validation = validateNativeResult(dimension, normalized)
  return { ...validation, document: validation.available ? normalized : null }
}

function validBoundary(value) {
  return record(value) && text(value.entryPoint) && text(value.consumer)
    && optionalStrings(value, ['decisionPoint', 'realizationPoint', 'stateOwner', 'evidenceClass'])
    && ['identityDimensions', 'transitions'].every(key => !owns(value, key)
      || (Array.isArray(value[key]) && Array.from(value[key]).every(item => typeof item === 'string')))
}

function validFinding(value) {
  if (!record(value) || !strings(value, ['file', 'severity', 'title', 'description', 'badCode', 'fix', 'bugClass'])
      || !Number.isInteger(value.line) || !['critical', 'important', 'observation', 'idiomatic'].includes(value.severity)
      || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value.bugClass)
      || !Array.isArray(value.otherInstances) || !Array.from(value.otherInstances).every(item => typeof item === 'string' && instances.test(item))
      || !optionalStrings(value, ['precedent', 'ruleQuote'])
      || (owns(value, 'rule') && !text(value.rule))
      || (owns(value, 'boundary') && !validBoundary(value.boundary))) return false
  if (value.severity === 'idiomatic' && !text(value.precedent)) return false
  if (['critical', 'important'].includes(value.severity)) {
    return text(value.badCode) && text(value.fix)
      && (owns(value, 'boundary') || (typeof value.rule === 'string' && ruleException.test(value.rule)))
  }
  return true
}

/** Validate a parsed native reviewer document without changing its semantic output. */
export function validateNativeResult(dimension, document) {
  const unavailable = reason => ({ available: false, reason })
  if (!dimensions.includes(dimension)) return unavailable('unknown review dimension')
  if (!record(document) || !Array.isArray(document.findings)) return unavailable('result must contain a findings array')
  if (!Array.from(document.findings).every(validFinding)) return unavailable('finding violates the shared result contract')
  const required = dimension === 'implementation' ? ['acCoverage']
    : dimension === 'test-quality' ? ['coverageVerdict', 'mutationSlip'] : []
  if (!strings(document, required)) return unavailable('required reviewer metadata is missing or malformed')
  if (!optionalStrings(document, ['acCoverage', 'coverageVerdict', 'mutationSlip'])) return unavailable('reviewer metadata must be strings')
  if ((dimension === 'test-quality' || owns(document, 'mockSmells'))
      && (!Array.isArray(document.mockSmells) || !Array.from(document.mockSmells).every(value => record(value)
        && strings(value, ['file', 'description', 'fix']) && Number.isInteger(value.line)))) {
    return unavailable('mockSmells must contain valid file, line, description and fix records')
  }
  return { available: true, reason: null }
}
