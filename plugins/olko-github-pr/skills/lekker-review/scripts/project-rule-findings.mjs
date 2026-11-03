#!/usr/bin/env node
// Validates findings tagged `rule: "PROJECT:<slug>"`.
//
// A project's own prohibitions and obligations (CLAUDE.md, AGENTS.md, REVIEW.md)
// are collected into `projectRules`. A lens that raises one as a hard rule must
// quote the rule it enforces. A quote that is not in `projectRules` means the
// model invented the rule, so the finding is rejected instead of being allowed
// to ride the hard-rule path past the runtime challenges.
//
//   node project-rule-findings.mjs <finding.json> <context.json>
//
// Exit 0 when valid or when the finding is not a PROJECT rule, 1 when rejected,
// 2 when the validator itself could not run (usage error, unreadable or malformed input).
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TAG_PATTERN = /^PROJECT:[a-z0-9]+(-[a-z0-9]+)*$/
const MIN_QUOTE_LENGTH = 12

export function isProjectRuleTag(tag) {
  return typeof tag === 'string' && TAG_PATTERN.test(tag)
}

// Case, runs of whitespace and markdown emphasis or list markers vary between a
// rules file and a model's copy of it; the words must not.
export function normalizeQuote(text) {
  return String(text ?? '')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/(^|\n)\s{0,3}>\s?/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(^|[\s([{])(\*{1,2}|_{1,2})(\S(?:.*?\S)?)\2(?=$|[\s.,;:!?)}\]])/g, '$1$3')
    .replace(/^\s*[-+]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function quoteAppearsIn(quote, projectRules) {
  const needle = normalizeQuote(quote)
  if (!needle) return false
  if (needle.length >= MIN_QUOTE_LENGTH && normalizeQuote(projectRules).includes(needle)) return true
  return String(projectRules ?? '').split(/\r?\n/).some(line => normalizeQuote(line) === needle)
}

export function validateProjectRuleFinding(finding, projectRules) {
  const tag = finding?.rule
  if (typeof tag !== 'string' || !tag.startsWith('PROJECT:')) {
    return { ok: true, reason: 'not a PROJECT rule' }
  }
  if (!isProjectRuleTag(tag)) {
    return { ok: false, reason: `malformed tag "${tag}": expected PROJECT:<kebab-case-slug>` }
  }
  if (typeof finding.ruleQuote !== 'string' || finding.ruleQuote.trim() === '') {
    return { ok: false, reason: 'missing ruleQuote: quote the project rule verbatim' }
  }
  if (!quoteAppearsIn(finding.ruleQuote, projectRules)) {
    return { ok: false, reason: 'ruleQuote not found in projectRules' }
  }
  return { ok: true, reason: 'quote found in projectRules' }
}

function main(argv) {
  const [findingPath, contextPath] = argv
  if (!findingPath || !contextPath) {
    console.error('usage: project-rule-findings.mjs <finding.json> <context.json>')
    return 2
  }
  try {
    const finding = JSON.parse(readFileSync(findingPath, 'utf8'))
    const context = JSON.parse(readFileSync(contextPath, 'utf8'))
    const result = validateProjectRuleFinding(finding, context.projectRules)
    console.log(JSON.stringify(result))
    return result.ok ? 0 : 1
  } catch (error) {
    // Exit 1 is reserved for "rejected"; a tooling failure must not read as one.
    console.error(`project-rule-findings: unavailable: ${error.message}`)
    return 2
  }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isMain()) {
  process.exit(main(process.argv.slice(2)))
}
