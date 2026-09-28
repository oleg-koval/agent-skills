#!/usr/bin/env node
// revmux-adapter.mjs -- turns a revmux report into lekker's findings JSON.
//
// Usage: node scripts/revmux-adapter.mjs <revmux.json> [--pricing FILE] [--context FILE] > findings.json
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const reportPath = args[0]
if (!reportPath) {
  console.error('usage: revmux-adapter.mjs <revmux.json> [--pricing FILE] [--context FILE]')
  process.exit(2)
}
function flagValue(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  const value = args[i + 1]
  if (!value || value.startsWith('--')) {
    console.error(`revmux-adapter: ${name} requires a file path`)
    process.exit(2)
  }
  return value
}
const pricingPath = flagValue('--pricing')
const contextPath = flagValue('--context')

function loadJson(label, path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`revmux-adapter: cannot read or parse ${label} JSON at ${path}: ${error.message}`)
    process.exit(2)
  }
}

const report = loadJson('report', reportPath)
const pricing = pricingPath ? loadJson('pricing', pricingPath) : {}
const contextJson = contextPath ? loadJson('context', contextPath) : null

function configuredHardRules() {
  const defaultPath = fileURLToPath(new URL('../references/house-rules.md', import.meta.url))
  const configuredPath = (contextJson && typeof contextJson.houseRulesFile === 'string')
    ? contextJson.houseRulesFile
    : defaultPath
  const houseRulesPath = contextPath && !configuredPath.startsWith('/')
    ? resolve(dirname(contextPath), configuredPath)
    : configuredPath

  let text
  try {
    text = readFileSync(houseRulesPath, 'utf8')
  } catch (error) {
    console.error(`revmux-adapter: cannot read configured house rules at ${houseRulesPath}: ${error.message}`)
    process.exit(2)
  }

  const tags = new Set()
  for (const match of text.matchAll(/^#{2,6}\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/gm)) {
    if (!match[1].startsWith('EXAMPLE-')) tags.add(match[1])
  }
  return tags
}

const HARD_RULES = configuredHardRules()

function hardRuleCorroborated(finding) {
  const evidence = [finding.badCode, finding.description, finding.title]
    .map(function(x) { return String(x || '') }).join('\n')
  const file = String(finding.file || '')
  const code = String(finding.badCode || '')

  switch (finding.rule) {
    case 'TS-1':
      return /\bas\s+(?:[A-Z_$][\w$]*|string|number|boolean|bigint|symbol|object|unknown|never|any|const)\b/.test(code)
        || /:\s*any\b|<\s*any[\s,>]|\bany\[\]/.test(code)
    case 'TS-2':
      return /\.js$/.test(file)
    case 'GQL-1':
      return /\bnodes\b|\bpageInfo\b|\bedges\b/.test(evidence)
    case 'PR-1':
      return /pr\s*(title|description)/i.test(file + '\n' + evidence)
    default:
      return code.trim().length > 0
  }
}

function isHardRule(finding) {
  if (typeof finding.rule !== 'string' || !HARD_RULES.has(finding.rule)) {
    return false
  }
  return hardRuleCorroborated(finding)
}

function extractRule(title) {
  const m = /^\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\]/.exec(String(title || ''))
  return m && HARD_RULES.has(m[1]) ? m[1] : undefined
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

const findings = []
let droppedCount = 0
let hardRuleCount = 0

for (const f of report.findings || []) {
  const rule = extractRule(f.title)
  const badCode = extractBadCode(f.body)
  const base = {
    file: f.file,
    line: f.line,
    severity: mapSeverity(f),
    title: f.title,
    description: f.body,
    badCode,
    fix: f.fix,
    confidence: f.confidence,
    rule,
    dimension: f.lenses || [],
  }
  if ((f.sources || []).length >= 2) {
    base.agreedBy = f.sources
  }

  const rejectedOrImmaterial = f.verdict === 'rejected' || f.verdict === 'immaterial'

  if (!rejectedOrImmaterial) {
    base.verifierReasoning = `revmux verify: ${f.verdict}`
    findings.push(base)
    continue
  }

  // A hard-rule tag whose own quoted code corroborates it is Critical
  // regardless of revmux's verdict.
  if (isHardRule({ rule, badCode, description: f.body, title: f.title, file: f.file })) {
    hardRuleCount++
    base.severity = 'critical'
    base.verifierReasoning = `hard rule ${rule}: corroborated by quoted code, re-promoted despite revmux verdict "${f.verdict}"`
    findings.push(base)
    continue
  }

  droppedCount++
}

const reportFindings = findings.slice()

for (const pe of report.pre_existing || []) {
  findings.push({
    file: pe.file,
    line: pe.line,
    severity: 'observation',
    title: pe.title,
    description: `Pre-existing: ${pe.body}`,
    badCode: extractBadCode(pe.body),
    fix: '',
    dimension: pe.lenses || [],
  })
}

const questions = report.open_questions || []

const implementationFindings = reportFindings.filter(function(f) {
  return f.dimension.includes('lekker-implementation')
})
const testQualityFindings = reportFindings.filter(function(f) {
  return f.dimension.includes('lekker-test-quality')
})
const mutationFindings = testQualityFindings.filter(function(f) {
  return /mutation|operator flip|off-by-one/i.test(`${f.title}\n${f.description}`)
})
const mockFindings = testQualityFindings.filter(function(f) {
  return /\bmock(?:ing|ed|s)?\b|\bspy(?:ing)?\b|toHaveBeenCalled/i.test(`${f.title}\n${f.description}`)
})

const acCoverage = implementationFindings.length > 0
  ? implementationFindings.map(function(f) { return `${f.title}: ${f.description}` }).join('\n')
  : 'No acceptance-criteria gaps were reported by the revmux implementation lens.'
const coverageVerdict = testQualityFindings.length > 0
  ? `${testQualityFindings.length} test-quality finding(s): ${testQualityFindings.map(function(f) { return f.title }).join('; ')}`
  : 'No test-quality gaps were reported by the revmux test-quality lens.'
const mutationSlip = mutationFindings.length > 0
  ? mutationFindings.map(function(f) { return f.description }).join('\n')
  : 'No mutation-slip gap was reported by the revmux test-quality lens.'
const mockSmells = mockFindings.map(function(f) {
  return { file: f.file, line: f.line, description: f.description, fix: f.fix }
})

const agentsIn = (report.sources && report.sources.agents) || []
const pricingMissing = []
let totalUsd = 0
let anyUsdKnown = false

const agents = agentsIn.map(function(a) {
  const priceEntry = pricing[a.actual_model]
  let usd = null
  if (priceEntry) {
    const rate = (typeof priceEntry.output === 'number') ? priceEntry.output : priceEntry.blended
    if (typeof a.tokens === 'number' && Number.isFinite(a.tokens) && typeof rate === 'number' && Number.isFinite(rate)) {
      usd = (a.tokens / 1e6) * rate
      anyUsdKnown = true
      totalUsd += usd
    }
  } else {
    pricingMissing.push(a.actual_model)
  }
  return {
    name: a.name,
    model: a.actual_model,
    effort: a.effort,
    tokens: a.tokens,
    usd,
    raised: a.raised,
    degraded: Boolean(a.degraded),
  }
})

const degraded = agents.filter(function(a) { return a.degraded }).map(function(a) { return a.name })
const totalTokens = (report.stats && report.stats.tokens) || agentsIn.reduce(function(s, a) { return s + (a.tokens || 0) }, 0)

const output = {
  engine: 'revmux',
  findings,
  questions,
  droppedCount,
  downgradedCount: 0,
  hardRuleCount,
  agentCount: agentsIn.length,
  degraded,
  agents,
  totalTokens,
  totalUsd: anyUsdKnown ? totalUsd : null,
  acCoverage,
  coverageVerdict,
  mutationSlip,
  mockSmells,
  stats: { durationMs: (report.stats && report.stats.durationMs) || null },
}

if (pricingMissing.length > 0) {
  output.pricingMissing = Array.from(new Set(pricingMissing))
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
