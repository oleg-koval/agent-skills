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
  integrityErrors,
  openDefects,
  statusOf,
  PENALTIES,
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

test('penalises a verified claim found only by the critic', () => {
  assert.deepEqual(scoreLedger({ version: 1, claims: [claim('c1', true, 'verified', 'critic')], missed: [] }), {
    score: 95,
    breakdown: { only_critic_found: 5 },
  })
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

test('rejects verified and refuted claims checked only by inference', () => {
  for (const status of ['verified', 'refuted']) {
    const l = { version: 1, claims: [{ ...claim('c1', true, status), checked_by: 'inferred' }], missed: [] }
    assert.deepEqual(validateLedger(l), ['claims[0].checked_by: verified and refuted claims must be checked by command or read'])
  }
})

test('requires non-empty receipts for verified and refuted claims', () => {
  for (const status of ['verified', 'refuted']) {
    for (const receipt of [undefined, null, '', ' \n ', 42]) {
      const l = { version: 1, claims: [{ ...claim('c1', true, status), receipt }], missed: [] }
      assert.deepEqual(validateLedger(l), ['claims[0].receipt: verified and refuted claims require a non-empty receipt'])
    }
    for (const checked_by of ['command', 'read']) {
      assert.deepEqual(validateLedger({ version: 1, claims: [{ ...claim('c1', true, status), checked_by }], missed: [] }), [])
    }
  }
})

test('keeps inferred and unverifiable claims valid without receipts', () => {
  const claims = ['inferred', 'unverifiable'].map((status) => ({
    ...claim(status, true, status), checked_by: 'inferred', receipt: undefined,
  }))
  assert.deepEqual(validateLedger({ version: 1, claims, missed: [] }), [])
})

test('requires checked_by on missed items', () => {
  const l = { version: 1, claims: [], missed: [{ id: 'm1', text: 'x', load_bearing: true }, { id: 'm2', text: 'y', load_bearing: false, checked_by: 'maybe' }] }
  assert.deepEqual(validateLedger(l), ['missed[0].checked_by missing', 'missed[1].checked_by invalid: maybe'])
})

test('does not charge an inferred missed item', () => {
  const l = { version: 1, claims: [], missed: [{ id: 'm1', text: 'x', load_bearing: true, checked_by: 'inferred' }] }
  assert.deepEqual(scoreLedger(l), { score: 100, breakdown: {} })
})

// Integrity: the ledger must account for every author claim, every critic item and every earlier claim.
const entry = (id, fields) => ({ ...verified(id, true), ...fields })
const authorClaims = [{ id: 'a1', text: 'one', load_bearing: true, receipt: 'x' }, { id: 'a2', text: 'two', load_bearing: false, receipt: 'y' }]
const criticOut = { claims: [{ text: 'one' }, { text: 'three' }], missed: [{ text: 'sibling' }] }
const goodLedger = {
  version: 1,
  claims: [
    entry('c1', { author_id: 'a1', critic_ref: 'r1:claims.0' }),
    entry('c2', { author_id: 'a2', origin: 'author', load_bearing: false }),
    entry('c3', { origin: 'critic', critic_ref: 'r1:claims.1' }),
  ],
  missed: [{ id: 'm1', text: 'sibling', load_bearing: false, checked_by: 'read', critic_ref: 'r1:missed.0' }],
}
const context = { author: authorClaims, critic: { r1: criticOut } }
const without = (ledger, id) => ({ ...ledger, claims: ledger.claims.filter((c) => c.id !== id) })
const replace = (ledger, id, fields) => ({ ...ledger, claims: ledger.claims.map((c) => (c.id === id ? { ...c, ...fields } : c)) })

test('integrity passes a ledger that accounts for everything', () => {
  assert.deepEqual(integrityErrors(goodLedger, context), [])
})

test('integrity names an author claim the ledger dropped', () => {
  const errors = integrityErrors(without(goodLedger, 'c2'), context)
  assert.deepEqual(errors, ['author claim a2 has no ledger entry'])
})

test('integrity rejects a dangling author_id', () => {
  const errors = integrityErrors(replace(goodLedger, 'c2', { author_id: 'a9' }), context)
  assert.ok(errors.includes('claims[1].author_id: origin author needs an author claim id, got a9'))
  assert.ok(errors.includes('author claim a2 has no ledger entry'))
})

test('integrity rejects an origin critic claim that names an author claim', () => {
  const errors = integrityErrors(replace(goodLedger, 'c3', { author_id: 'a1' }), context)
  assert.deepEqual(errors, ['claims[2].author_id: origin critic must not name an author claim'])
})

test('integrity rejects a missing, unknown or unreferenced critic_ref', () => {
  const missing = replace(goodLedger, 'c3', { critic_ref: undefined })
  assert.ok(integrityErrors(missing, context).includes('claims[2].critic_ref: missing, name the critic item this entry came from'))
  assert.ok(integrityErrors(missing, context).includes('critic item r1:claims.1 has no ledger entry'))
  const unknown = replace(goodLedger, 'c3', { critic_ref: 'r1:claims.7' })
  assert.ok(integrityErrors(unknown, context).includes('claims[2].critic_ref: unknown r1:claims.7'))
  const loose = { ...goodLedger, missed: [] }
  assert.deepEqual(integrityErrors(loose, context), ['critic item r1:missed.0 has no ledger entry'])
})

test('integrity rejects an author-only claim that cites the critic', () => {
  const errors = integrityErrors(replace(goodLedger, 'c2', { critic_ref: 'r1:claims.0' }), context)
  assert.deepEqual(errors, ['claims[1].critic_ref: origin author must not cite the critic'])
})

test('integrity requires every previous claim id to survive', () => {
  const next = without(goodLedger, 'c3')
  assert.deepEqual(integrityErrors(next, { prev: goodLedger }), ['claim c3 from the previous ledger is missing'])
  assert.deepEqual(integrityErrors(goodLedger, { prev: next }), [])
})

test('integrity reports a duplicate id', () => {
  const dup = { ...goodLedger, claims: [...goodLedger.claims, entry('c1', { author_id: 'a1', critic_ref: 'r1:claims.0' })] }
  assert.ok(integrityErrors(dup, {}).includes('duplicate id: c1'))
})

test('a load-bearing inferred claim costs 10 and an ordinary one stays 5', () => {
  assert.equal(PENALTIES.inferred_accepted_load_bearing, 10)
  assert.deepEqual(scoreLedger({ version: 1, claims: [inferred('c1', true)], missed: [] }), {
    score: 90,
    breakdown: { inferred_accepted_load_bearing: 10 },
  })
  assert.equal(scoreLedger({ version: 1, claims: [inferred('c1', false)], missed: [] }).score, 95)
  assert.deepEqual(anchors().map((a) => a.score), [95, 72, 40])
})

test('openDefects counts load-bearing inferred and unverifiable claims, not verified ones', () => {
  const l = {
    version: 1,
    claims: [verified('c1', true), inferred('c2', true), unverifiable('c3', false), refuted('c4', true)],
    missed: [
      { id: 'm1', text: 'x', load_bearing: true, checked_by: 'read' },
      { id: 'm2', text: 'y', load_bearing: true, checked_by: 'inferred' },
      { id: 'm3', text: 'z', load_bearing: false, checked_by: 'read' },
    ],
  }
  assert.deepEqual(openDefects(l), { load_bearing: 3, other: 2 })
})

test('statusOf reports first and final score, trajectory and done', () => {
  const v1 = { version: 1, claims: [refuted('c1', true), verified('c2', false)], missed: [] }
  const v2 = { version: 1, claims: [verified('c1', true), verified('c2', false)], missed: [] }
  assert.deepEqual(statusOf([v1, v2]), {
    rounds: 2, first_score: 75, final_score: 100, kept: 2, trajectory: [75, 100], open: { load_bearing: 0, other: 0 }, done: true,
  })
  assert.equal(statusOf([v1]).done, false)
})

test('statusOf keeps the ratchet winner when a revision scores lower', () => {
  const good = { version: 1, claims: [verified('c1', true)], missed: [] }
  const worse = { version: 1, claims: [refuted('c1', true)], missed: [] }
  const s = statusOf([good, worse])
  assert.deepEqual([s.kept, s.final_score, s.done], [1, 100, true])
})

// CLI flags
const writeJson = (dir, name, value) => {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(value))
  return file
}
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

test('cli labels a score unchecked without flags and checked with them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'))
  const ledger = writeJson(dir, 'ledger-v1.json', goodLedger)
  const author = writeJson(dir, 'author-claims.json', authorClaims)
  const critic = writeJson(dir, 'critic-r1.json', criticOut)
  assert.equal(JSON.parse(cli('score', ledger).stdout).integrity, 'unchecked')
  const checked = cli('score', ledger, '--author', author, '--critic', `r1=${critic}`)
  assert.equal(checked.status, 0, checked.stderr)
  assert.deepEqual([JSON.parse(checked.stdout).integrity, JSON.parse(checked.stdout).score], ['checked', 90])
  assert.equal(JSON.parse(cli('check', ledger, '--author', author).stdout).integrity, 'checked')
})

test('cli exits 2 with the integrity errors when the ledger drops an author claim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'))
  const ledger = writeJson(dir, 'ledger-v1.json', without(goodLedger, 'c2'))
  const author = writeJson(dir, 'author-claims.json', authorClaims)
  const r = cli('score', ledger, '--author', author)
  assert.equal(r.status, 2)
  assert.match(JSON.parse(r.stderr).error, /author claim a2 has no ledger entry/)
})

test('cli rejects a malformed --critic spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'))
  const ledger = writeJson(dir, 'ledger-v1.json', goodLedger)
  const r = cli('score', ledger, '--critic', 'no-equals-sign')
  assert.equal(r.status, 2)
  assert.match(JSON.parse(r.stderr).error, /--critic needs <label>=<path>/)
})

test('cli ratchet checks the next ledger against the previous one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'))
  const v1 = writeJson(dir, 'ledger-v1.json', goodLedger)
  const v2 = writeJson(dir, 'ledger-v2.json', replace(goodLedger, 'c1', { status: 'verified' }))
  const dropped = writeJson(dir, 'ledger-v3.json', without(goodLedger, 'c3'))
  const ok = cli('ratchet', v1, v2, '--author', writeJson(dir, 'a.json', authorClaims))
  assert.equal(ok.status, 0, ok.stderr)
  assert.deepEqual(JSON.parse(ok.stdout), { winner: 'next', score: 90, integrity: 'checked' })
  const bad = cli('ratchet', v1, dropped, '--author', writeJson(dir, 'a.json', authorClaims))
  assert.equal(bad.status, 2)
  assert.match(JSON.parse(bad.stderr).error, /claim c3 from the previous ledger is missing/)
})

test('cli status prints rounds, trajectory and done', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'))
  const v1 = writeJson(dir, 'ledger-v1.json', { version: 1, claims: [refuted('c1', true)], missed: [] })
  const v2 = writeJson(dir, 'ledger-v2.json', { version: 1, claims: [verified('c1', true)], missed: [] })
  const r = cli('status', v1, v2)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), {
    rounds: 2, first_score: 75, final_score: 100, kept: 2, trajectory: [75, 100], open: { load_bearing: 0, other: 0 }, done: true,
  })
})
