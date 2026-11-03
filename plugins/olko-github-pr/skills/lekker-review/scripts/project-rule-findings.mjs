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

const RECALLED_PATTERNS_HEADING = /^\s{0,3}#{1,6}\s+recalled patterns\s*$/gim

// Recalled patterns are memory, not the project's rules, so nothing below the last such heading is a valid quote source.
// SKILL.md appends that heading at the end; an earlier one inside a rules file must not drop the rules after it.
export function stripRecalledPatterns(text) {
  const source = String(text ?? '')
  const last = [...source.matchAll(RECALLED_PATTERNS_HEADING)].at(-1)
  return last ? source.slice(0, last.index) : source
}

export function quoteAppearsIn(quote, projectRules) {
  const needle = normalizeQuote(quote)
  if (!needle) return false
  const rules = stripRecalledPatterns(projectRules)
  if (needle.length >= MIN_QUOTE_LENGTH && normalizeQuote(rules).includes(needle)) return true
  return rules.split(/\r?\n/).some(line => normalizeQuote(line) === needle)
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

// Still present means the whole rule block is unchanged; any wording change in the block
// counts as possibly weakened and is left to the verifier.
const LIST_MARKER = /^\s*([-+*]|\d+[.)])\s+/

const indentOf = line => line.length - line.trimStart().length

// A deeper marker or indented text belongs to its parent bullet, even after a blank line (loose list),
// so an exception there must change the parent block.
const isHeading = line => /^\s{0,3}#{1,6}\s/.test(line)
const isListItem = line => LIST_MARKER.test(line)

function startsNewBlock(line, current) {
  if (isHeading(line)) return true
  const [first] = current
  if (first === undefined) return true
  if (current[current.length - 1] === '') return !(isListItem(first) && indentOf(line) > indentOf(first))
  if (!isListItem(line)) return false
  if (isListItem(first)) return indentOf(line) <= indentOf(first)
  return true
}

function ruleBlocks(text) {
  const groups = stripRecalledPatterns(text).split(/\r?\n/).reduce((acc, line) => {
    const current = acc[acc.length - 1]
    if (line.trim() === '') return current === undefined || current.length === 0 ? acc : [...acc.slice(0, -1), [...current, '']]
    if (current === undefined || startsNewBlock(line, current)) return [...acc, [line]]
    return [...acc.slice(0, -1), [...current, line]]
  }, [])
  return groups
    .map(lines => lines.map((line, i) => normalizeQuote(i === 0 ? line.replace(LIST_MARKER, '') : line)).filter(line => line !== '').join(' '))
    .filter(block => block !== '')
}

export function ruleLineStillPresent(quote, baseProjectRules, projectRules) {
  const needle = normalizeQuote(quote)
  const baseHits = needle ? ruleBlocks(baseProjectRules).filter(block => block.includes(needle)) : []
  if (baseHits.length === 0) return false
  const prBlocks = new Set(ruleBlocks(projectRules))
  return baseHits.some(block => prBlocks.has(block))
}

// `unavailable` marks a missing input, not a judgement on the finding: the CLI maps it to exit 2.
export function validateWeakenedProjectRuleFinding(finding, baseProjectRules, projectRules) {
  if (finding?.rule !== 'weakens-project-rule') {
    return { ok: true, reason: 'not a weakened project rule' }
  }
  if (typeof baseProjectRules !== 'string') {
    return { ok: false, unavailable: true, reason: 'baseProjectRules unavailable' }
  }
  if (typeof finding.ruleQuote !== 'string' || finding.ruleQuote.trim() === '') {
    return { ok: false, reason: 'missing ruleQuote: quote the removed project rule' }
  }
  if (!quoteAppearsIn(finding.ruleQuote, baseProjectRules)) {
    return { ok: false, reason: 'ruleQuote not found in baseProjectRules' }
  }
  if (typeof projectRules === 'string' && ruleLineStillPresent(finding.ruleQuote, baseProjectRules, projectRules)) {
    return { ok: false, reason: 'rule still present in projectRules' }
  }
  return { ok: true, reason: 'quote found in baseProjectRules' }
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
    if (finding?.rule === 'weakens-project-rule') {
      const result = validateWeakenedProjectRuleFinding(finding, context.baseProjectRules, context.projectRules)
      console.log(JSON.stringify(result))
      if (result.unavailable) return 2
      return result.ok ? 0 : 1
    }
    // Base-branch rules are authoritative; PR-tree rules only when no base was resolved.
    const authoritative = typeof context.baseProjectRules === 'string' ? context.baseProjectRules : context.projectRules
    const result = validateProjectRuleFinding(finding, authoritative)
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
