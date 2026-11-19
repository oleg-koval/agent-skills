#!/usr/bin/env node
// Fact lock for the comment polish pass (references/github-post.md Step 2b).
// A rewrite for readability must not change what a comment claims: a dropped
// line number or a softened "will" sends the author to the wrong fix. The
// polish agent is asked to keep facts; this script checks it did, and falls
// back to the draft comment for every one that drifted.
//
//   node comment-facts.mjs <draft.json> <polished.json> --out <final.json>
//
// Both inputs are review payloads ({ body, comments: [{ path, line, side, body }] }).
// The final payload is the draft with each comment body replaced by its
// polished version when the facts match. The review body is never taken from
// the polished payload. Prints a one-line JSON summary on stdout.
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MAX_PROSE_CHARS = 1200

const FENCE = /```[^\n]*\n[\s\S]*?```/g
const INLINE_CODE = /`[^`\n]+`/g
const URL = /https?:\/\/[^\s)>\]]+/g
const MARKER = /<!--\s*lekker:[\w-]+\s*-->/g
const MARKER_LINE = /^<!--\s*lekker:[\w-]+\s*-->$/
// A leading minus counts as part of the number only when it is not a joiner
// ("2-4", "FO-1"), so "-1" and "1" are different facts.
const NUMBER = /(?:(?<![\w)])-)?\d+(?:[.,]\d+)*/g
// Code named in plain prose, outside backticks: file references
// (`src/cache.js:42`) and camelCase, PascalCase-with-inner-capital or
// snake_case names.
const FILE_REF = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|rb|go|rs|java|kt|swift|sql|graphql|ya?ml|sh|css|scss|html|liquid|toml)(?::\d+(?:-\d+)?)?\b/g
const IDENTIFIER = /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/g
// Claim polarity and strength: a rewrite that drops a "not" or turns "will"
// into "may" changes the finding even when every token above survives.
const NEGATION = /\b(?:not|no|never|none|nothing|cannot|without)\b|n't\b/gi
const MODAL = /\b(?:will|would|may|might|can|could|must|should|always|sometimes|often|only)\b/gi

const matches = (text, re) => text.match(re) ?? []
const sorted = values => [...values].sort()
const unique = values => sorted(new Set(values))
const stripAll = (text, patterns) => patterns.reduce((acc, re) => acc.replace(re, ' '), text)

// What a rewrite may not change. Code blocks must match one for one; inline
// code, links and prose numbers as sets, so a rewrite may repeat an identifier
// to make a sentence readable but may not drop or introduce one.
export function extractFacts(text) {
  const fences = matches(text, FENCE)
  const withoutFences = stripAll(text, [FENCE])
  const codes = matches(withoutFences, INLINE_CODE)
  const urls = matches(withoutFences, URL)
  const markers = matches(text, MARKER)
  const prose = stripAll(withoutFences, [INLINE_CODE, URL, MARKER])
  return {
    fences: sorted(fences),
    codes: unique(codes),
    urls: unique(urls),
    markers,
    numbers: unique(matches(prose, NUMBER)),
    names: unique([...matches(prose, FILE_REF), ...matches(stripAll(prose, [FILE_REF]), IDENTIFIER)]),
    negations: matches(prose, NEGATION).length,
    modals: unique(matches(prose, MODAL).map(m => m.toLowerCase())),
    proseChars: prose.trim().length,
    lastLine: text.trimEnd().split('\n').at(-1).trim(),
  }
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const missingFrom = (a, b) => a.filter(v => !b.includes(v))

const FACT_CHECKS = [
  ['suggestion or code block changed', (d, p) => sameList(d.fences, p.fences)],
  ['inline code changed', (d, p) => sameList(d.codes, p.codes)],
  ['link changed', (d, p) => sameList(d.urls, p.urls)],
  ['file reference or code name in prose changed', (d, p) => sameList(d.names, p.names)],
  ['negation added or dropped', (d, p) => d.negations === p.negations],
  ['claim strength changed (will, may, must, ...)', (d, p) => sameList(d.modals, p.modals)],
  ['lekker marker changed', (d, p) => sameList(d.markers, p.markers)],
  ['lekker marker not on the last line', (d, p) => d.markers.length === 0 || MARKER_LINE.test(p.lastLine)],
  [`longer than ${MAX_PROSE_CHARS} characters of prose`, (_d, p) => p.proseChars <= MAX_PROSE_CHARS],
]

export function factDrift(draftText, polishedText) {
  if (typeof polishedText !== 'string' || polishedText.trim() === '') return ['polished body missing']
  const d = extractFacts(draftText)
  const p = extractFacts(polishedText)
  const failed = FACT_CHECKS.filter(([, ok]) => !ok(d, p)).map(([reason]) => reason)
  const emDash = polishedText.includes('—') && !draftText.includes('—') ? ['em dash added'] : []
  const lost = missingFrom(d.numbers, p.numbers)
  const added = missingFrom(p.numbers, d.numbers)
  const numbers = lost.length || added.length ? [`numbers lost [${lost}] added [${added}]`] : []
  return [...failed, ...emDash, ...numbers]
}

const sameAnchor = (a, b) => b && a.path === b.path && a.line === b.line && (a.side ?? 'RIGHT') === (b.side ?? 'RIGHT')

export function mergeComment(draft, polished) {
  if (!sameAnchor(draft, polished)) return { comment: draft, reasons: ['anchor (path, line or side) changed'] }
  const reasons = factDrift(draft.body, polished.body)
  return reasons.length ? { comment: draft, reasons } : { comment: { ...draft, body: polished.body }, reasons }
}

export function mergePayload(draft, polished) {
  const drafts = draft.comments ?? []
  const polishedComments = polished?.comments ?? []
  if (polishedComments.length !== drafts.length) {
    return {
      payload: draft,
      summary: { comments: drafts.length, polished: 0, reverted: drafts.length, reason: 'comment count changed', details: [] },
    }
  }
  const results = drafts.map((c, i) => ({ ...mergeComment(c, polishedComments[i]), index: i }))
  const details = results
    .filter(r => r.reasons.length)
    .map(r => ({ index: r.index, path: r.comment.path, line: r.comment.line, reasons: r.reasons }))
  return {
    payload: { ...draft, comments: results.map(r => r.comment) },
    summary: { comments: drafts.length, polished: drafts.length - details.length, reverted: details.length, details },
  }
}

function main(argv) {
  const outAt = argv.indexOf('--out')
  const [draftPath, polishedPath] = argv.filter((_, i) => i !== outAt && i !== outAt + 1)
  const outPath = outAt === -1 ? undefined : argv[outAt + 1]
  if (!draftPath || !polishedPath || !outPath) {
    console.error('usage: comment-facts.mjs <draft.json> <polished.json> --out <final.json>')
    process.exit(2)
  }
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'))
  const polished = (() => {
    try { return JSON.parse(readFileSync(polishedPath, 'utf8')) } catch { return null }
  })()
  const { payload, summary } = polished
    ? mergePayload(draft, polished)
    : { payload: draft, summary: { comments: (draft.comments ?? []).length, polished: 0, reverted: (draft.comments ?? []).length, reason: 'polished payload unreadable', details: [] } }
  // Write then rename: a failed write must not leave a truncated payload in
  // place of the one Step 3 posts.
  const tmpPath = `${outPath}.tmp-${process.pid}`
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`)
  renameSync(tmpPath, outPath)
  console.log(JSON.stringify(summary))
}

// Compare real paths: a skill installed through a symlinked directory runs
// with argv[1] on the link while import.meta.url holds the resolved file.
const isEntrypoint = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}
if (isEntrypoint()) main(process.argv.slice(2))
