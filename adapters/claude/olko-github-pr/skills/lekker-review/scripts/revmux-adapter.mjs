#!/usr/bin/env node
// revmux-adapter.mjs -- turns a revmux report into lekker's findings JSON.
//
// Usage: node scripts/revmux-adapter.mjs <revmux.json> [--pricing FILE] [--context FILE] > findings.json
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const reportPath = args[0]
if (!reportPath) {
  console.error('usage: revmux-adapter.mjs <revmux.json> [--pricing FILE] [--context FILE]')
  process.exit(2)
}
function flagValue(name) {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const pricingPath = flagValue('--pricing')
const contextPath = flagValue('--context')

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const pricing = pricingPath ? JSON.parse(readFileSync(pricingPath, 'utf8')) : {}
let contextJson = null
if (contextPath) {
  try { contextJson = JSON.parse(readFileSync(contextPath, 'utf8')) } catch { contextJson = null }
}

const HARD_RULES = ['TS-1', 'TS-2', 'GQL-1', 'PR-1']

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
      return false
  }
}

function isHardRule(finding) {
  if (typeof finding.rule !== 'string' || HARD_RULES.indexOf(finding.rule) === -1) {
    return false
  }
  return hardRuleCorroborated(finding)
}

function extractRule(title) {
  const m = /^\[(TS-1|TS-2|GQL-1|PR-1)\]/.exec(String(title || ''))
  return m ? m[1] : undefined
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
  return dashCode ? dashCode[1] : text
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
  if (rule && hardRuleCorroborated({ rule, badCode, description: f.body, title: f.title, file: f.file })) {
    hardRuleCount++
    base.severity = 'critical'
    base.verifierReasoning = `hard rule ${rule}: corroborated by quoted code, re-promoted despite revmux verdict "${f.verdict}"`
    findings.push(base)
    continue
  }

  droppedCount++
}

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

const agentsIn = (report.sources && report.sources.agents) || []
const pricingMissing = []
let totalUsd = 0
let anyUsdKnown = false

const agents = agentsIn.map(function(a) {
  const priceEntry = pricing[a.actual_model]
  let usd = null
  if (priceEntry) {
    const rate = (typeof priceEntry.output === 'number') ? priceEntry.output : priceEntry.blended
    usd = (a.tokens / 1e6) * rate
    anyUsdKnown = true
    totalUsd += usd
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
  stats: { durationMs: (report.stats && report.stats.durationMs) || null },
}

if (pricingMissing.length > 0) {
  output.pricingMissing = Array.from(new Set(pricingMissing))
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n')
