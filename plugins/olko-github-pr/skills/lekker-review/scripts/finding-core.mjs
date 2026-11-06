// Pure finding checks shared by the validation edge and focused tests.
const WINDOW = 3

function candidates(badCode) {
  const first = String(badCode || '').split('\n').map(l => l.trim()).find(l => l.length > 0)
  if (!first) return []
  // Agents can copy a diff line with its leading "+" marker.
  const unmarked = first.replace(/^\+\s?/, '').trim()
  return [...new Set([first, unmarked])].filter(Boolean)
}

function matches(fileLine, cands) {
  const t = fileLine.trim()
  return cands.some(c => t === c || (c.length >= 12 && t.includes(c)))
}

export function anchor(finding, fileLines) {
  const cands = candidates(finding.badCode)
  if (cands.length === 0 || !Number.isInteger(finding.line)) return { finding, outcome: 'unchecked' }
  const near = []
  for (let n = Math.max(1, finding.line - WINDOW); n <= Math.min(fileLines.length, finding.line + WINDOW); n++) {
    if (matches(fileLines[n - 1], cands)) near.push(n)
  }
  if (near.length > 0) return { finding, outcome: 'kept' }
  const hits = []
  fileLines.forEach((l, i) => { if (matches(l, cands)) hits.push(i + 1) })
  if (hits.length === 1) {
    return { finding: { ...finding, line: hits[0], originalLine: finding.line, lineRemapped: true }, outcome: 'remapped' }
  }
  if (hits.length === 0) {
    return { finding: { ...finding, line: null, originalLine: finding.line }, outcome: 'nulled' }
  }
  return { finding: { ...finding, lineAmbiguous: true }, outcome: 'ambiguous' }
}
