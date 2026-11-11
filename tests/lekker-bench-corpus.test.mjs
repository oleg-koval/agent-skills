import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { caseDepths, toLegacyManifest, validateCorpus } from '../plugins/olko-github-pr/skills/lekker-review/scripts/bench-corpus.mjs'
import { caseKey, validateManifest } from '../plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs'

const corpusPath = 'plugins/olko-github-pr/skills/lekker-review/evals/bench/corpus.json'
const base = { repo: 'project', baseRef: 'HEAD', patch: 'a.patch' }
const buggy = { ...base, id: 'b1', expect: 'buggy', knownBug: 'src/a.js:3 drops the last item' }
const clean = { ...base, id: 'c1', expect: 'clean' }

test('the shipped corpus is valid: three planted bugs and one clean control', () => {
  const cases = validateCorpus(JSON.parse(readFileSync(corpusPath, 'utf8')))
  assert.equal(cases.filter((c) => c.expect === 'buggy').length, 3)
  assert.equal(cases.filter((c) => c.expect === 'clean').length, 1)
})

test('a valid corpus returns its cases and defaults depths to medium', () => {
  const cases = validateCorpus({ cases: [buggy, { ...clean, depths: ['scan', 'medium'] }] })
  assert.equal(cases.length, 2)
  assert.deepEqual(caseDepths(buggy), ['medium'])
  assert.deepEqual(caseDepths(cases[1]), ['scan', 'medium'])
})

test('violations throw with the case index', () => {
  const bad = (c, pattern) => assert.throws(() => validateCorpus({ cases: [clean, c] }), pattern)
  bad({ ...buggy, knownBug: 'no location' }, /cases\[1\].*knownBug/)
  bad({ ...buggy, knownBug: undefined }, /cases\[1\].*knownBug/)
  bad({ ...clean, id: 'c2', expect: 'maybe' }, /cases\[1\].*expect/)
  bad({ ...clean, id: 'a/b' }, /cases\[1\].*id/)
  bad({ ...clean, id: 'c2', patch: '' }, /cases\[1\].*patch/)
  bad({ ...clean, id: 'c2', repo: 3 }, /cases\[1\].*repo/)
  bad({ ...clean, id: 'c2', depths: ['huge'] }, /cases\[1\].*depths/)
  bad({ ...clean, id: 'c2', depths: [] }, /cases\[1\].*depths/)
  bad(null, /cases\[1\]/)
  assert.throws(() => validateCorpus({ cases: [clean, clean] }), /cases\[1\].*duplicate id c1/)
  assert.throws(() => validateCorpus({}), /cases/)
})

test('toLegacyManifest passes validateManifest and keeps the id as the case key', () => {
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
  const manifest = toLegacyManifest(corpus)
  const prs = validateManifest(manifest)
  assert.deepEqual(prs.map(caseKey), corpus.cases.map((c) => c.id))
  assert.deepEqual(prs.map((p) => p.pr), [1, 2, 3, 4])
  assert.ok(prs.every((p) => p.repo === 'project'))
  assert.equal(prs[0].knownBug, corpus.cases[0].knownBug)
  assert.equal('knownBug' in prs[3], false)
})
