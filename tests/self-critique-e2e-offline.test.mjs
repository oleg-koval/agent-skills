import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  extractCriticTemplate,
  parseCriticJson,
  toLedger,
  assertExpectations,
  authorClaims,
} from './self-critique-e2e.mjs'
import { scoreLedger } from '../plugins/olko-reflection/skills/self-critique/scripts/claim-ledger.mjs'

const skillText = readFileSync(
  new URL('../plugins/olko-reflection/skills/self-critique/SKILL.md', import.meta.url),
  'utf8',
)
const fixtures = new URL('./fixtures/self-critique/', import.meta.url)
const expected = JSON.parse(readFileSync(new URL('expected.json', fixtures), 'utf8'))
const seededAnswer = readFileSync(new URL('answer-seeded.md', fixtures), 'utf8')

const cannedSeeded = {
  claims: [
    { text: 'Retries are 5 in config.json', load_bearing: true, status: 'refuted', checked_by: 'read', receipt: 'config.json:1 says retries 3' },
    { text: 'The timeout is 30 seconds', load_bearing: true, status: 'refuted', checked_by: 'read', receipt: 'config.json:1 says timeout_ms 5000' },
    { text: 'The loop stops on the first success', load_bearing: true, status: 'verified', checked_by: 'read', receipt: 'handler.js:9 returns' },
    { text: 'The production dashboard shows zero errors', load_bearing: true, status: 'unverifiable', checked_by: 'inferred', receipt: 'no dashboard access' },
  ],
  missed: [
    { text: 'The empty catch block swallows every error', load_bearing: true, checked_by: 'read', receipt: 'handler.js:10' },
  ],
}

test('extractCriticTemplate returns only the blockquoted template', () => {
  const t = extractCriticTemplate(skillText)
  assert.ok(t.includes('{{TASK}}') && t.includes('{{ANSWER}}'))
  assert.ok(!t.includes('Score anchors'))
  assert.ok(!t.includes('PENALTIES'))
  assert.ok(!t.split('\n').some((l) => l.trimStart().startsWith('|')))
  assert.ok(!t.split('\n').some((l) => l.startsWith('>')))
})

test('parseCriticJson picks the last fenced json block', () => {
  const text = 'a\n```json\n{"n":1}\n```\nb\n```json\n{"n":2}\n```\n'
  assert.deepEqual(parseCriticJson(text), { n: 2 })
})

test('seeded canned output scores at most 70 and passes the assertions', () => {
  const ledger = toLedger(cannedSeeded, authorClaims(seededAnswer))
  const { score } = scoreLedger(ledger)
  assert.ok(score <= 70, `score ${score}`)
  assert.deepEqual(
    assertExpectations({ correctScore: 95, seededScore: score, seededLedger: ledger, expected }),
    [],
  )
})

test('assertExpectations reports A and C', () => {
  const ledger = toLedger(cannedSeeded, authorClaims(seededAnswer))
  const { score } = scoreLedger(ledger)
  assert.deepEqual(
    assertExpectations({ correctScore: 80, seededScore: score, seededLedger: ledger, expected }),
    ['A'],
  )
  const noMiss = { ...ledger, missed: [] }
  assert.deepEqual(
    assertExpectations({ correctScore: 95, seededScore: score, seededLedger: noMiss, expected }),
    ['C'],
  )
})

test('downgrades an inferred refutation to inferred', () => {
  const critic = {
    claims: [{ text: 'Retries are 5 in config.json', load_bearing: true, status: 'refuted', checked_by: 'inferred', receipt: 'guess' }],
    missed: [{ text: 'something', load_bearing: false }],
  }
  const ledger = toLedger(critic, [])
  assert.equal(ledger.claims[0].status, 'inferred')
  assert.equal(ledger.claims[0].checked_by, 'inferred')
  assert.equal(ledger.missed[0].checked_by, 'inferred')
})
