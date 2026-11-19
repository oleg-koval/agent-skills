import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  extractFacts, factDrift, mergePayload,
} from '../plugins/olko-github-pr/skills/lekker-review/scripts/comment-facts.mjs'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/comment-facts.mjs'
const marker = '<!-- lekker:quality -->'

const draft = [
  'Please extract one shared winner-picker used by both files, keyed on FO value.',
  'This ranks value → units → id; `x.ts:104` ranks shipped-qty → id, so FO-A',
  '(qty 1, one $100 item) vs FO-B (qty 3, three $10 items) gives A here and B there.',
  'Idempotency is keyed per `fulfillmentOrderGid`, so a retry writes the same charge twice.',
  marker,
].join('\n')

const polished = [
  'Please use one shared function to pick the winning fulfillment order, here and in `x.ts:104`.',
  '',
  '**Why:** the two copies pick different winners and charge the shared line twice.',
  'With FO-A (qty 1, one $100 item) and FO-B (qty 3, three $10 items) this file picks A and the other picks B.',
  'The duplicate check is keyed per `fulfillmentOrderGid`, so a retry writes the same charge twice.',
  marker,
].join('\n')

const withSuggestion = body => `${body}\n\`\`\`suggestion\nreturn early\n\`\`\`\n${marker}`
const comment = body => ({ path: 'a.ts', line: 10, side: 'RIGHT', body })
const payload = (...bodies) => ({ body: 'summary', comments: bodies.map(comment) })

test('a readability rewrite that keeps every fact passes', () => {
  assert.deepEqual(factDrift(draft, polished), [])
})

test('facts ignore code, links and marker when collecting prose numbers', () => {
  const facts = extractFacts('Raise to 250 in `retry(3)` see https://x.io/a/9 ' + marker)
  assert.deepEqual(facts.numbers, ['250'])
  assert.deepEqual(facts.codes, ['`retry(3)`'])
  assert.deepEqual(facts.urls, ['https://x.io/a/9'])
})

test('drift is caught: changed number, dropped identifier, edited suggestion, moved marker', () => {
  assert.match(factDrift(draft, polished.replace('$100', '$90')).join(), /numbers lost \[100\] added \[90\]/)
  assert.match(factDrift(draft, polished.replace('`fulfillmentOrderGid`', 'the order id')).join(), /inline code changed/)
  assert.match(factDrift(withSuggestion('Return early.'), withSuggestion('Return early.').replace('return early', 'return null')).join(), /suggestion or code block changed/)
  assert.match(factDrift(draft, `${marker}\n${polished.replace(marker, '')}`).join(), /marker not on the last line/)
  assert.match(factDrift(draft, polished.replace('twice.', 'twice — always.')).join(), /em dash added/)
  assert.match(factDrift(draft, '').join(), /polished body missing/)
})

test('a changed sign, bare file reference or code name in prose reverts', () => {
  const base = 'Use -1 as the sentinel in src/cache.js:42 before loadCache runs.\n' + marker
  assert.deepEqual(factDrift(base, base.replace('in src', 'here, in src')), [])
  assert.match(factDrift(base, base.replace('-1', '1')).join(), /numbers lost \[-1\] added \[1\]/)
  assert.match(factDrift(base, base.replace('src/cache.js:42', 'src/auth.js:42')).join(), /file reference or code name/)
  assert.match(factDrift(base, base.replace('loadCache', 'loadAuth')).join(), /file reference or code name/)
  assert.match(factDrift(base, base.replace('loadCache', 'load_cache')).join(), /file reference or code name/)
})

test('a backtick inside code cannot end a fence or code span early', () => {
  const fence = (tail) => 'Return early.\n```suggestion\nconst s = "```";\nreturn ' + tail + '\n```\n' + marker
  assert.match(factDrift(fence('true'), fence('false')).join(), /suggestion or code block changed/)
  const span = (v) => 'Rename ``cache`' + v + '`` here.\n' + marker
  assert.match(factDrift(span('old'), span('new')).join(), /inline code changed/)
  assert.deepEqual(extractFacts('Use `a` and ``b`c`` now.').codes, ['``b`c``', '`a`'])
})

test('a flipped negation or changed claim strength reverts', () => {
  const base = 'This retry will write the charge twice when the lock is not held.\n' + marker
  assert.deepEqual(factDrift(base, base.replace('This retry', 'The retry')), [])
  assert.match(factDrift(base, base.replace(' is not held', ' is held')).join(), /negation added or dropped/)
  assert.match(factDrift(base, base.replace('will write', "won't write")).join(), /negation added or dropped/)
  assert.match(factDrift(base, base.replace('will write', 'may write')).join(), /claim strength changed/)
  assert.deepEqual(factDrift(base, base.replace('is not held', "isn't held")), [])
  assert.deepEqual(extractFacts('Range 2-4 for FO-1 and -3 here.').numbers, ['-3', '1', '2', '4'])
})

test('merge keeps polished bodies that pass and reverts the ones that drift', () => {
  const { payload: out, summary } = mergePayload(
    payload(draft, draft),
    { body: 'rewritten summary', comments: [comment(polished), comment(polished.replace('qty 3', 'qty 4'))] },
  )
  assert.equal(out.body, 'summary')
  assert.equal(out.comments[0].body, polished)
  assert.equal(out.comments[1].body, draft)
  assert.equal(summary.polished, 1)
  assert.equal(summary.reverted, 1)
  assert.equal(summary.details[0].index, 1)
})

test('a moved anchor or a changed comment count reverts to the draft', () => {
  const moved = mergePayload(payload(draft), { comments: [{ ...comment(polished), line: 11 }] })
  assert.equal(moved.payload.comments[0].body, draft)
  assert.match(moved.summary.details[0].reasons.join(), /anchor/)
  const dropped = mergePayload(payload(draft, draft), { comments: [comment(polished)] })
  assert.deepEqual(dropped.payload, payload(draft, draft))
  assert.equal(dropped.summary.reason, 'comment count changed')
})

test('cli runs when invoked through a symlinked skill directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-facts-link-'))
  try {
    const link = join(dir, 'scripts')
    symlinkSync(resolve('plugins/olko-github-pr/skills/lekker-review/scripts'), link)
    const d = join(dir, 'draft.json'), p = join(dir, 'polished.json'), o = join(dir, 'final.json')
    writeFileSync(d, JSON.stringify(payload(draft)))
    writeFileSync(p, JSON.stringify(payload(polished)))
    const out = JSON.parse(execFileSync('node', [join(link, 'comment-facts.mjs'), d, p, '--out', o], { encoding: 'utf8' }))
    assert.equal(out.polished, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cli writes the merged payload and falls back to the draft on unreadable input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-facts-'))
  try {
    const d = join(dir, 'draft.json'), p = join(dir, 'polished.json'), o = join(dir, 'final.json')
    writeFileSync(d, JSON.stringify(payload(draft)))
    writeFileSync(p, JSON.stringify(payload(polished)))
    const ok = JSON.parse(execFileSync('node', [script, d, p, '--out', o], { encoding: 'utf8' }))
    assert.equal(ok.polished, 1)
    assert.equal(JSON.parse(readFileSync(o, 'utf8')).comments[0].body, polished)
    writeFileSync(p, 'not json')
    const bad = JSON.parse(execFileSync('node', [script, d, p, '--out', o], { encoding: 'utf8' }))
    assert.equal(bad.reason, 'polished payload unreadable')
    assert.equal(JSON.parse(readFileSync(o, 'utf8')).comments[0].body, draft)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
