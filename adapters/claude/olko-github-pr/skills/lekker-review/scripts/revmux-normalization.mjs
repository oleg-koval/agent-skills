// revmux reports one location per finding and no class, so the class is derived
// from the rule tag or title and no other instances are claimed.
function bugClassOf(rule, title) {
  const words = String(rule || title || '').toLowerCase().match(/[a-z0-9]+/g) || []
  return words.slice(0, 6).join('-') || 'unclassified'
}

function mapSeverity(f) {
  if (f.severity === 'critical') return 'critical'
  if (f.severity === 'major') return 'important'
  if (f.severity === 'minor') {
    return (f.lenses || []).includes('lekker-conventions') ? 'idiomatic' : 'observation'
  }
  return 'observation'
}

// Pull an inline code snippet out of the body so hardRuleCorroborated has
// something to check against; revmux findings carry no separate badCode field.
function extractBadCode(body) {
  const text = String(body || '')
  const backtick = /`([^`]+)`/.exec(text)
  if (backtick) return backtick[1]
  const dashCode = /--\s*(.+)$/.exec(text.split('\n')[0])
  return dashCode ? dashCode[1] : ''
}

export { bugClassOf, extractBadCode, mapSeverity }
