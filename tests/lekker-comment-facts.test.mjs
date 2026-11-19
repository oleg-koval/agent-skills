import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  '**Why:** the two copies can pick different winners and charge the shared line twice.',
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
