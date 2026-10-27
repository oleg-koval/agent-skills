import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  scoreLedger,
  ratchet,
  anchors,
  validateLedger,
  summaryMarkdown,
} from '../plugins/olko-reflection/skills/self-critique/scripts/claim-ledger.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'plugins', 'olko-reflection', 'skills', 'self-critique', 'scripts', 'claim-ledger.mjs')

const claim = (id, loadBearing, status, origin = 'both') => ({
  id,
  text: `claim ${id}`,
  load_bearing: loadBearing,
  origin,
  status,
  checked_by: status === 'inferred' ? 'inferred' : 'read',
  receipt: 'file:1',
})
const verified = (id, lb) => claim(id, lb, 'verified')
const refuted = (id, lb) => claim(id, lb, 'refuted')
const unverifiable = (id, lb) => claim(id, lb, 'unverifiable')
const inferred = (id, lb) => claim(id, lb, 'inferred')

const clean = { version: 1, claims: [verified('c1', true)], missed: [] }
const bad = { version: 1, claims: [refuted('c1', true), refuted('c2', true)], missed: [] }

test('scores 100 for a clean ledger', () => {
  assert.equal(scoreLedger({ version: 1, claims: [verified('c1', true)], missed: [] }).score, 100)
})

test('applies the penalty table', () => {
  const l = {
    version: 1,
    claims: [refuted('c1', true), unverifiable('c2', false), inferred('c3', false)],
    missed: [{ id: 'm1', text: 'x', load_bearing: true, checked_by: 'read' }],
  }
  assert.deepEqual(scoreLedger(l), {
    score: 51,
    breakdown: { refuted_load_bearing: 25, unverifiable: 4, inferred_accepted: 5, missed_load_bearing: 15 },
  })
})

test('penalises accepted inferred findings', () => {
  assert.equal(scoreLedger({ version: 1, claims: [inferred('c1', false)], missed: [] }).score, 95)
})

test('floors at 0', () => {
  const claims = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => refuted(id, true))
  assert.equal(scoreLedger({ version: 1, claims, missed: [] }).score, 0)
})

test('ratchet keeps the higher score and prefers next on a tie', () => {
  assert.deepEqual(ratchet(clean, bad), { winner: 'prev', score: 100 })
  assert.deepEqual(ratchet(clean, clean), { winner: 'next', score: 100 })
})

test('anchors are produced by the same function', () => {
  for (const a of anchors()) assert.equal(scoreLedger(a.ledger).score, a.score)
  assert.deepEqual(anchors().map((a) => a.score), [95, 72, 40])
})

test('validateLedger names every bad field', () => {
  assert.deepEqual(
    validateLedger({ version: 1, claims: [{ id: 'c1', status: 'maybe' }], missed: [] }),
    [
      'claims[0].text missing',
      'claims[0].load_bearing missing',
      'claims[0].origin missing',
      'claims[0].status invalid: maybe',
      'claims[0].checked_by missing',
    ],
  )
})

test('summaryMarkdown renders one row per claim with a status word', () => {
  const l = { version: 1, claims: [refuted('c1', true)], missed: [] }
  assert.match(summaryMarkdown(l), /\| c1 \| .* \| refuted \|/)
})

test('cli exits 2 with a JSON error on malformed input', () => {
  const badPath = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'bad.json')
  writeFileSync(badPath, JSON.stringify({ version: 1, claims: [{ id: 'c1', status: 'maybe' }], missed: [] }))
  const r = spawnSync('node', [script, 'score', badPath], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  JSON.parse(r.stderr)
})

test('rejects a refuted claim checked only by inference', () => {
  const l = { version: 1, claims: [{ ...refuted('c1', true), checked_by: 'inferred' }], missed: [] }
  assert.deepEqual(validateLedger(l), ['claims[0].checked_by: a refuted claim must be checked by command or read'])
})

test('requires checked_by on missed items', () => {
  const l = { version: 1, claims: [], missed: [{ id: 'm1', text: 'x', load_bearing: true }, { id: 'm2', text: 'y', load_bearing: false, checked_by: 'maybe' }] }
  assert.deepEqual(validateLedger(l), ['missed[0].checked_by missing', 'missed[1].checked_by invalid: maybe'])
})

test('does not charge an inferred missed item', () => {
  const l = { version: 1, claims: [], missed: [{ id: 'm1', text: 'x', load_bearing: true, checked_by: 'inferred' }] }
  assert.deepEqual(scoreLedger(l), { score: 100, breakdown: {} })
})
