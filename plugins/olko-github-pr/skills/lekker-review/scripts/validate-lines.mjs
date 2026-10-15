#!/usr/bin/env node
// Checks every finding's `line` against the file at HEAD before synthesis.
// Reviewers sometimes cite a line number of pr.diff instead of the file (a
// 2026-10-15 finding said package.json:398 for code at line 70), and an
// inline GitHub comment on the wrong line is worse than none.
//
//   node validate-lines.mjs <findings.json> <worktreePath>
//
// <findings.json> is an array or { findings: [...] }; it is rewritten in
// place, same shape. For each finding whose file exists in the worktree:
//   - badCode's first non-blank line within +-3 of `line` -> kept
//   - otherwise one unique match in the file -> re-anchored, lineRemapped: true
//   - no match -> line: null (the finding becomes PR-level, not inline)
//   - several matches -> kept, lineAmbiguous: true
// Then dedup (lifted from workflow.js) merges findings that now share an anchor.
// Prints a one-line JSON summary on stdout.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'

const WINDOW = 3
const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))

function candidates(badCode) {
  const first = String(badCode || '').split('\n').map(l => l.trim()).find(l => l.length > 0)
  if (!first) return []
  // Agents copy from the diff and sometimes keep its "+" marker.
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

// Same source-lift selftest.mjs uses: workflow.js runs inside the Workflow
// harness and cannot be imported, so its dedup is extracted by brace matching.
export function loadDedup(workflowPath = join(SKILL, 'workflow.js')) {
  const src = readFileSync(workflowPath, 'utf8')
  const lift = name => {
    const i = src.indexOf(`function ${name}`)
    if (i === -1) throw new Error(`function ${name} not found in workflow.js`)
    let d = 0, j = i
    for (;; j++) {
      if (src[j] === '{') d++
      else if (src[j] === '}') { d--; if (d === 0) break }
    }
    return src.slice(i, j + 1)
  }
  const liftConst = (name, fallback) => {
    const m = new RegExp(`^const ${name} = .*$`, 'm').exec(src)
    return m ? m[0] : fallback
  }
  const preamble = [
    liftConst('HARD_RULES', 'const HARD_RULES = new Set()'),
    liftConst('SAME_ISSUE_LINE_WINDOW', 'const SAME_ISSUE_LINE_WINDOW = 30'),
    liftConst('SEVERITY_RANK', 'const SEVERITY_RANK = { critical: 3, important: 2, observation: 1, idiomatic: 0 }'),
    ...['titleTokens', 'sameIssue', 'nearbyLines', 'spanWithinWindow',
        'isHardRule', 'longest', 'mergeFindings', 'dedup'].map(lift),
  ].join('\n')
  return new Function(preamble + '\nreturn dedup')()
}

export function validate(findings, worktree, dedup) {
  const root = resolve(worktree)
  const summary = { kept: 0, remapped: 0, nulled: 0, ambiguous: 0, unchecked: 0, merged: 0 }
  const cache = new Map()
  const out = findings.map(f => {
    const path = resolve(root, String(f.file || ''))
    if (!f.file || !path.startsWith(root + sep) || !existsSync(path)) {
      summary.unchecked++
      return f
    }
    if (!cache.has(path)) cache.set(path, readFileSync(path, 'utf8').split('\n'))
    const { finding, outcome } = anchor(f, cache.get(path))
    summary[outcome]++
    return finding
  })
  // dedup compares line distances, so only anchored findings go through it.
  const anchored = out.filter(f => Number.isInteger(f.line))
  const rest = out.filter(f => !Number.isInteger(f.line))
  const merged = summary.remapped > 0 && dedup ? dedup(anchored) : anchored
  summary.merged = anchored.length - merged.length
  return { findings: merged.concat(rest), summary }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isMain()) {
  const [file, worktree] = process.argv.slice(2)
  if (!file || !worktree) {
    console.error('usage: validate-lines.mjs <findings.json> <worktreePath>')
    process.exit(2)
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw.findings || [])
  const { findings, summary } = validate(list, worktree, loadDedup())
  writeFileSync(file, JSON.stringify(Array.isArray(raw) ? findings : { ...raw, findings }, null, 2))
  console.log(JSON.stringify(summary))
}
